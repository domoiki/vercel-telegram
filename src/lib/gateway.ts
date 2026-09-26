import "server-only";

import { eq } from "drizzle-orm";
import {
  bumpConversationCount,
  getOrCreateConversation,
  loadHistory,
  recordMessage,
  systemPrompt,
} from "@/lib/conversation";
import { decryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newCorrelationId, newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { executeWithFallback, finalizeRequest } from "@/lib/providers/router";
import { getSettings, getTelegramConfig } from "@/lib/settings";
import { safeErrorMessage, sanitizeText } from "@/lib/sanitize";
import { sendMessage, TelegramApiError } from "@/lib/telegram/client";
import { isChatAllowed, parseTelegramUpdate } from "@/lib/telegram/validate";
import type { ParsedTelegramMessage } from "@/lib/telegram/types";
import { trace } from "@/lib/trace";

export type ProcessOutcome = {
  status: "processed" | "duplicate" | "ignored" | "unauthorized" | "invalid" | "failed";
  reason?: string;
  requestId?: string;
};

const UNAUTHORIZED_REPLY =
  "This chat is not on the gateway allowlist. Add the chat id in the dashboard to grant access.";

/** Locally handled commands, answered without spending a provider call. */
async function handleCommand(message: ParsedTelegramMessage): Promise<string | null> {
  const name = (message.commandName ?? "").toLowerCase();
  if (name === "start" || name === "help") {
    return "Gateway online. Send a message and it will be answered by the configured AI provider.";
  }
  if (name === "reset") {
    const db = getDb();
    const conversation = await getOrCreateConversation({
      chatId: message.chatId,
      userId: message.userId,
      username: message.username,
      firstName: message.firstName,
      lastName: message.lastName,
    });
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
    await db
      .update(schema.conversations)
      .set({ messageCount: 0 })
      .where(eq(schema.conversations.id, conversation.id));
    return "Conversation history cleared. Next message starts fresh.";
  }
  return null;
}

export async function processTelegramUpdate(body: unknown): Promise<ProcessOutcome> {
  const db = getDb();

  // --- 1. validate ---------------------------------------------------------
  const parsed = parseTelegramUpdate(body);
  if (!parsed.ok) {
    await logger.warn({
      category: "WEBHOOK",
      event: "telegram.update_invalid",
      message: parsed.reason,
    });
    return { status: "invalid", reason: parsed.reason };
  }
  const message = parsed.message;

  // --- 2. claim the update id (idempotency) --------------------------------
  // The primary key on update_id is the duplicate guard: a Telegram retry that
  // inserts nothing here is a no-op for the rest of the pipeline.
  const claimed = await db
    .insert(schema.telegramUpdates)
    .values({
      updateId: message.updateId,
      chatId: message.chatId,
      telegramUserId: message.userId,
      status: "received",
    })
    .onConflictDoNothing()
    .returning({ updateId: schema.telegramUpdates.updateId });

  if (claimed.length === 0) {
    await logger.info({
      category: "WEBHOOK",
      event: "telegram.update_duplicate",
      message: `update_id ${message.updateId} was already processed`,
      chatId: message.chatId,
    });
    return { status: "duplicate", reason: "Duplicate update" };
  }

  // --- 3. authorization ----------------------------------------------------
  const config = await getTelegramConfig();
  const auth = isChatAllowed(message.chatId, {
    chatId1: config.chatId1,
    chatId2: config.chatId2,
    chatId3: config.chatId3,
  });

  if (!auth.allowed) {
    await db
      .update(schema.telegramUpdates)
      .set({ status: "unauthorized", reason: auth.reason, processedAt: new Date() })
      .where(eq(schema.telegramUpdates.updateId, message.updateId));

    await logger.warn({
      category: "TELEGRAM",
      event: "telegram.chat_unauthorized",
      message: `Rejected update from chat ${message.chatId}: ${auth.reason}`,
      chatId: message.chatId,
    });

    const token = decryptSecret(config.botTokenEncrypted);
    if (config.replyToUnauthorized && token) {
      try {
        await sendMessage(token, message.chatId, UNAUTHORIZED_REPLY);
      } catch (error) {
        await logger.warn({
          category: "TELEGRAM",
          event: "telegram.unauthorized_reply_failed",
          message: safeErrorMessage(error),
        });
      }
    }
    return { status: "unauthorized", reason: auth.reason };
  }

  const token = decryptSecret(config.botTokenEncrypted);
  if (!token) {
    await db
      .update(schema.telegramUpdates)
      .set({ status: "ignored", reason: "Bot token not configured", processedAt: new Date() })
      .where(eq(schema.telegramUpdates.updateId, message.updateId));
    await logger.error({
      category: "TELEGRAM",
      event: "telegram.bot_token_missing",
      message: "A message arrived but no bot token is configured in the dashboard.",
    });
    return { status: "ignored", reason: "Bot token not configured" };
  }

  // --- 4. conversation + inbound record ------------------------------------
  const conversation = await getOrCreateConversation({
    chatId: message.chatId,
    userId: message.userId,
    username: message.username,
    firstName: message.firstName,
    lastName: message.lastName,
  });

  const text = message.text.trim();
  if (text.length === 0) {
    await db
      .update(schema.telegramUpdates)
      .set({ status: "ignored", reason: "No text content", processedAt: new Date() })
      .where(eq(schema.telegramUpdates.updateId, message.updateId));
    await recordMessage({
      conversationId: conversation.id,
      chatId: message.chatId,
      userId: message.userId,
      direction: "inbound",
      text: "[non-text message]",
      status: "skipped",
    });
    return { status: "ignored", reason: "No text content" };
  }

  const settings = await getSettings();

  // Local commands never reach a provider.
  const commandReply = await handleCommand(message);
  if (commandReply !== null) {
    const sent = await sendMessage(token, message.chatId, commandReply);
    await recordMessage({
      conversationId: conversation.id,
      chatId: message.chatId,
      userId: message.userId,
      direction: "inbound",
      text,
      status: "received",
    });
    await recordMessage({
      conversationId: conversation.id,
      chatId: message.chatId,
      userId: message.userId,
      direction: "outbound",
      text: commandReply,
      status: "delivered",
      telegramMessageId: sent[0]?.messageId ?? null,
    });
    await bumpConversationCount(conversation.id);
    await db
      .update(schema.telegramUpdates)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(schema.telegramUpdates.updateId, message.updateId));
    return { status: "processed", reason: "local command" };
  }

  const inbound = await recordMessage({
    conversationId: conversation.id,
    chatId: message.chatId,
    userId: message.userId,
    direction: "inbound",
    text,
    status: "received",
  });

  // --- 5. request + trace --------------------------------------------------
  const requestId = newId();
  const correlationId = await allocateCorrelationId();
  await db.insert(schema.aiRequests).values({
    id: requestId,
    conversationId: conversation.id,
    chatId: message.chatId,
    triggerMessageId: inbound.id,
    correlationId,
    triggerText: text.slice(0, 500),
    status: "running",
    startedAt: new Date(),
  });
  await db
    .update(schema.telegramUpdates)
    .set({ requestId, status: "processing" })
    .where(eq(schema.telegramUpdates.updateId, message.updateId));

  const startedAt = Date.now();
  await trace(requestId, { event: "Webhook received", detail: `update_id ${message.updateId}` });
  await trace(requestId, {
    event: "Telegram update validated",
    detail: `chat ${message.chatId}${message.username ? ` · @${message.username}` : ""} · message ${message.messageId}`,
  });
  await trace(requestId, {
    event: "Chat authorized",
    detail: "Chat id matched an allowlist slot",
    level: "success",
  });

  const history = await loadHistory(conversation.id, settings.maxHistoryMessages);
  await trace(requestId, {
    event: "Conversation loaded",
    detail: `${history.length} message${history.length === 1 ? "" : "s"} of history (limit ${settings.maxHistoryMessages})`,
  });

  // --- 6. route through the provider chain ---------------------------------
  const result = await executeWithFallback({
    requestId,
    messages: [
      { role: "system", content: systemPrompt(message.chatId, message.username) },
      ...history,
    ],
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    retryAttempts: settings.retryAttempts,
    timeoutMs: settings.providerTimeoutMs,
  });

  if (!result.ok) {
    const totalLatencyMs = Date.now() - startedAt;
    const userText = "The gateway could not get a reply from any configured provider. Check the request trace for details.";

    await trace(requestId, {
      event: "AI request failed",
      detail: result.errorMessage,
      level: "error",
    });

    const outbound = await recordMessage({
      conversationId: conversation.id,
      chatId: message.chatId,
      userId: message.userId,
      direction: "outbound",
      text: userText,
      status: "failed",
      requestId,
      errorCategory: result.errorCategory,
      errorMessage: sanitizeText(result.errorMessage, 300),
    });

    let delivered = false;
    try {
      const sent = await sendMessage(token, message.chatId, userText);
      delivered = true;
      await db
        .update(schema.messages)
        .set({ status: "delivered", telegramMessageId: sent[0]?.messageId ?? null })
        .where(eq(schema.messages.id, outbound.id));
    } catch (error) {
      await logger.error({
        category: "TELEGRAM",
        event: "telegram.send_failed",
        message: safeErrorMessage(error),
        requestId,
        correlationId,
      });
    }

    await finalizeRequest(requestId, {
      status: "failed",
      attemptCount: result.attempts.length,
      fallbackCount: result.fallbackCount,
      totalLatencyMs,
      errorCategory: result.errorCategory,
      errorMessage: sanitizeText(result.errorMessage, 300),
      telegramDelivered: delivered,
      completedAt: new Date(),
    });
    await db
      .update(schema.telegramUpdates)
      .set({ status: "failed", reason: result.errorCategory, processedAt: new Date() })
      .where(eq(schema.telegramUpdates.updateId, message.updateId));
    await trace(requestId, {
      event: "Request completed",
      detail: `failed after ${result.attempts.length} attempt${result.attempts.length === 1 ? "" : "s"}`,
      level: "error",
      durationMs: totalLatencyMs,
    });

    return { status: "failed", requestId, reason: result.errorMessage };
  }

  // --- 7. deliver ----------------------------------------------------------
  await trace(requestId, { event: "Telegram sendMessage started" });
  const outbound = await recordMessage({
    conversationId: conversation.id,
    chatId: message.chatId,
    userId: message.userId,
    direction: "outbound",
    text: result.text,
    status: "processing",
    providerId: result.providerId,
    providerName: result.providerName,
    model: result.model,
    latencyMs: result.durationMs,
    requestId,
  });

  let delivered = false;
  let telegramError: string | null = null;
  try {
    const sent = await sendMessage(token, message.chatId, result.text);
    delivered = true;
    await db
      .update(schema.messages)
      .set({ status: "delivered", telegramMessageId: sent[0]?.messageId ?? null })
      .where(eq(schema.messages.id, outbound.id));
    await trace(requestId, {
      event: "Telegram delivery successful",
      detail: `message_id ${sent[0]?.messageId ?? "?"}`,
      level: "success",
    });
  } catch (error) {
    telegramError =
      error instanceof TelegramApiError
        ? error.message
        : safeErrorMessage(error, "Telegram delivery failed");
    await db
      .update(schema.messages)
      .set({ status: "failed", errorCategory: "telegram", errorMessage: telegramError })
      .where(eq(schema.messages.id, outbound.id));
    await trace(requestId, {
      event: "Telegram delivery failed",
      detail: telegramError,
      level: "error",
    });
    await logger.error({
      category: "TELEGRAM",
      event: "telegram.send_failed",
      message: telegramError,
      requestId,
      correlationId,
    });
  }

  // --- 8. close out --------------------------------------------------------
  const totalLatencyMs = Date.now() - startedAt;
  await finalizeRequest(requestId, {
    status: "succeeded",
    providerId: result.providerId,
    providerName: result.providerName,
    model: result.model,
    attemptCount: result.attempts.length,
    fallbackCount: result.fallbackCount,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.totalTokens,
    estimatedCost: result.estimatedCost,
    totalLatencyMs,
    telegramDelivered: delivered,
    telegramError,
    completedAt: new Date(),
  });

  await db
    .update(schema.telegramUpdates)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(schema.telegramUpdates.updateId, message.updateId));

  await bumpConversationCount(conversation.id);

  await trace(requestId, {
    event: "Request completed",
    detail: `${result.providerName} · ${totalLatencyMs}ms total${
      result.fallbackCount > 0 ? ` · ${result.fallbackCount} fallback(s)` : ""
    }`,
    level: "success",
    durationMs: totalLatencyMs,
  });

  return { status: "processed", requestId };
}

/** Short, human-quotable trace id. Retries until unique. */
async function allocateCorrelationId(): Promise<string> {
  const db = getDb();
  for (let i = 0; i < 5; i += 1) {
    const candidate = newCorrelationId(6);
    const [existing] = await db
      .select({ id: schema.aiRequests.id })
      .from(schema.aiRequests)
      .where(eq(schema.aiRequests.correlationId, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return newCorrelationId(10);
}

export const gatewayInternals = { handleCommand, allocateCorrelationId };
