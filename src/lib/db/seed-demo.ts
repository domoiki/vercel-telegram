/**
 * Fills the local database with realistic sample traffic so the dashboard can
 * be reviewed in its data-rich state. Never run this against production.
 *
 *   npm run db:seed:demo
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { randomUUID } from "node:crypto";

import { loadEnvFiles } from "../load-env";
import * as schema from "./schema";
import { SETTING_DEFAULTS } from "../settings-defaults";

const CHATS = [
  { chatId: "1842003311", username: "dana", firstName: "Dana", lastName: "Okafor" },
  { chatId: "-1001887442109", username: "opsroom", firstName: "Ops Room", lastName: null },
  { chatId: "559002338", username: null, firstName: "Mika", lastName: "Sørensen" },
];

const QUESTIONS = [
  "What did the deploy pipeline report overnight?",
  "Summarise yesterday's incidents in three bullets.",
  "Remind me what the retry budget is for the primary provider.",
  "Can you draft a short status note for the team channel?",
  "Which provider is currently set as primary?",
  "Explain the difference between a 429 and a 503 here.",
  "/start",
  "How many messages did the gateway handle this week?",
  "Draft a reply to a customer asking for a refund.",
  "What is our p95 latency across providers?",
];

const ANSWERS = [
  "The pipeline finished at 03:12 UTC. All four services deployed; the canary held at 10% for 20 minutes before promoting.",
  "Three incidents: a 429 burst from the primary provider that fell back cleanly, a slow query on the logs page, and one webhook that arrived twice. The duplicate was dropped by the update-id guard.",
  "Two retries per provider by default. After that the router moves to the next one in the chain rather than burning more time on a provider that is already struggling.",
  "Here's a draft: 'Both deploys are green, one customer-reported latency blip is resolved, and the fallback chain is back to its normal shape. Nothing needs your attention today.'",
  "OpenRouter is primary right now, with two fallbacks behind it. You can change the order on the AI Providers page without touching the environment.",
  "A 429 means the provider asked us to slow down — retryable, and worth falling back from. A 503 means the provider itself is unhealthy. Both trigger fallback; a 400 does not.",
  "Gateway online. Send a message and it will be answered by the configured AI provider.",
  "Across the allowlisted chats the gateway handled just over a thousand messages this week, with a success rate in the high nineties.",
  "Draft: 'Thanks for flagging this. I've issued the refund to the original payment method — it should appear within five business days. Sorry for the inconvenience.'",
  "Roughly 1.4 seconds at p95 end to end, dominated by the provider call rather than Telegram delivery.",
];

const PROVIDERS = [
  { name: "OpenRouter", model: "anthropic/claude-3.5-sonnet", adapter: "openai-compatible", ok: true, primary: true },
  { name: "Groq", model: "llama-3.3-70b-versatile", adapter: "openai-compatible", ok: true, primary: false },
  { name: "Anthropic direct", model: "claude-3-5-haiku-latest", adapter: "anthropic", ok: true, primary: false },
  { name: "Local Ollama", model: "qwen2.5:7b", adapter: "openai-compatible", ok: false, primary: false },
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(items: T[]): T {
  const value = items[Math.floor(Math.random() * items.length)];
  return value as T;
}
function daysAgo(days: number, hour?: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour ?? Math.floor(rand(8, 22)), Math.floor(rand(0, 59)), Math.floor(rand(0, 59)), 0);
  return d;
}
function hex(len = 6) {
  return randomUUID().replace(/-/g, "").slice(0, len).toUpperCase();
}

/** Partial rows; id/requestId/seq are filled in at insert time. */
type DraftEvent = { event: string; detail: string; level: schema.EventLevel; durationMs?: number | null };
type DraftAttempt = Omit<
  typeof schema.requestAttempts.$inferInsert,
  "id" | "requestId"
>;

async function main() {
  loadEnvFiles();
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set TURSO_DATABASE_URL or DATABASE_URL first.");
    process.exit(1);
  }
  if (!url.startsWith("file:")) {
    console.error("Refusing to seed demo data into a remote database.");
    process.exit(1);
  }

  const client = createClient({ url });
  const db = drizzle(client, { schema });

  console.log("▸ Clearing existing gateway data…");
  await db.delete(schema.requestEvents);
  await db.delete(schema.requestAttempts);
  await db.delete(schema.aiRequests);
  await db.delete(schema.messages);
  await db.delete(schema.conversations);
  await db.delete(schema.telegramUpdates);
  await db.delete(schema.logs);
  await db.delete(schema.aiProviders);

  const now = new Date();
  await db
    .insert(schema.settings)
    .values(Object.entries(SETTING_DEFAULTS).map(([key, value]) => ({ key, value, updatedAt: now })))
    .onConflictDoNothing();
  await db
    .insert(schema.telegramConfig)
    .values({ id: 1, createdAt: now, updatedAt: now })
    .onConflictDoNothing();

  // ---- providers --------------------------------------------------------
  const providerRows = PROVIDERS.map((p, index) => ({
    id: randomUUID(),
    name: p.name,
    description: index === 0 ? "Main route for day-to-day chat" : null,
    baseUrl:
      p.name === "Local Ollama"
        ? "http://127.0.0.1:11434/v1"
        : p.adapter === "anthropic"
          ? "https://api.anthropic.com/v1"
          : p.name === "Groq"
            ? "https://api.groq.com/openai/v1"
            : "https://openrouter.ai/api/v1",
    apiKeyEncrypted: p.name === "Local Ollama" ? null : "enc:preview-key",
    model: p.model,
    adapter: p.adapter,
    timeoutMs: 30_000,
    enabled: true,
    isPrimary: p.primary,
    priority: index + 1,
    lastTestedAt: daysAgo(0, 9),
    lastTestOk: p.ok,
    lastTestHttpStatus: p.ok ? 200 : 401,
    lastTestLatencyMs: Math.round(rand(320, 2400)),
    lastTestError: p.ok ? null : "HTTP 401: invalid api key",
    createdAt: daysAgo(30),
    updatedAt: now,
  }));
  await db.insert(schema.aiProviders).values(providerRows);

  // ---- conversations, messages, requests --------------------------------
  let requestCount = 0;
  let messageCount = 0;
  const traceLabels: Array<[string, string, schema.EventLevel]> = [
    ["Webhook received", "update_id {id}", "info"],
    ["Telegram update validated", "chat {chat} · message {mid}", "info"],
    ["Chat authorized", "Chat id matched an allowlist slot", "success"],
    ["Conversation loaded", "{n} messages of history", "info"],
    ["Provider selected", "{provider} · {model}", "info"],
    ["AI response received", "HTTP 200 · {ms}ms", "success"],
    ["Telegram sendMessage started", "", "info"],
    ["Telegram delivery successful", "message_id {mid}", "success"],
    ["Request completed", "{provider} · {ms}ms total", "success"],
  ];

  for (const chat of CHATS) {
    const conversationId = randomUUID();
    const createdAt = daysAgo(21, 10);
    const messages: (typeof schema.messages.$inferInsert)[] = [];
    const requests: Array<{
      row: typeof schema.aiRequests.$inferInsert;
      events: DraftEvent[];
      attempts: DraftAttempt[];
      replyText: string;
      createdAt: Date;
    }> = [];

    for (let i = 0; i < 22; i += 1) {
      const at = daysAgo(Math.floor(rand(0, 20)), Math.floor(rand(7, 23)));
      const question = pick(QUESTIONS);
      const shouldFail = Math.random() < 0.12;
      const useFallback = Math.random() < 0.18;

      const requestId = randomUUID();
      const provider = useFallback
        ? providerRows[1]!
        : shouldFail && Math.random() < 0.5
          ? providerRows[3]!
          : providerRows[0]!;
      const latency = Math.round(rand(420, 3800));

      messages.push({
        id: randomUUID(),
        conversationId,
        chatId: chat.chatId,
        telegramUserId: "100200300",
        direction: "inbound",
        text: question,
        status: "received",
        createdAt: at,
      });

      if (shouldFail) {
        requests.push({
          row: {
            id: requestId,
            conversationId,
            chatId: chat.chatId,
            correlationId: hex(),
            triggerText: question,
            status: "failed",
            providerId: null,
            attemptCount: 2,
            fallbackCount: 1,
            totalLatencyMs: latency + 1800,
            telegramDelivered: true,
            errorCategory: "auth",
            errorMessage: "HTTP 401: invalid api key",
            startedAt: at,
            completedAt: new Date(at.getTime() + latency + 1800),
          },
          events: [
            { event: "Webhook received", detail: "update_id processed", level: "info" },
            { event: "Provider selected", detail: `${provider.name} · ${provider.model}`, level: "info" },
            { event: "Provider returned 401", detail: "invalid api key", level: "error" },
            { event: "Fallback triggered", detail: `Trying ${providerRows[1]?.name}.`, level: "warning" },
            { event: "AI response received", detail: `HTTP 200 · ${latency}ms`, level: "success" },
            { event: "Telegram delivery successful", detail: "message_id recorded", level: "success" },
            { event: "Request completed", detail: "succeeded after 2 attempts", level: "success" },
          ],
          attempts: [
            {
              providerId: provider.id,
              providerName: provider.name,
              model: provider.model,
              attemptNumber: 1,
              outcome: "error",
              httpStatus: 401,
              durationMs: 640,
              errorCategory: "auth",
              errorMessage: "HTTP 401: invalid api key",
              startedAt: at,
            },
            {
              providerId: providerRows[1]!.id,
              providerName: providerRows[1]!.name,
              model: providerRows[1]!.model,
              attemptNumber: 2,
              outcome: "success",
              httpStatus: 200,
              durationMs: latency,
              promptTokens: Math.round(rand(400, 1800)),
              completionTokens: Math.round(rand(80, 500)),
              startedAt: new Date(at.getTime() + 700),
            },
          ],
          replyText: pick(ANSWERS),
          createdAt: at,
        });
      } else {
        requests.push({
          row: {
            id: requestId,
            conversationId,
            chatId: chat.chatId,
            correlationId: hex(),
            triggerText: question,
            status: "succeeded",
            providerId: provider.id,
            providerName: provider.name,
            model: provider.model,
            attemptCount: useFallback ? 2 : 1,
            fallbackCount: useFallback ? 1 : 0,
            promptTokens: Math.round(rand(400, 1800)),
            completionTokens: Math.round(rand(80, 500)),
            totalTokens: Math.round(rand(600, 2400)),
            estimatedCost: Number(rand(0.0002, 0.02).toFixed(6)),
            totalLatencyMs: latency,
            telegramDelivered: true,
            startedAt: at,
            completedAt: new Date(at.getTime() + latency),
          },
          events: traceLabels.map(([event, detail, level], index) => ({
            event,
            detail: detail
              .replace("{id}", String(100000 + i * 37))
              .replace("{chat}", chat.chatId)
              .replace("{mid}", String(4000 + i * 13))
              .replace("{n}", String(rand(4, 20)))
              .replace("{provider}", provider.name)
              .replace("{model}", provider.model)
              .replace("{ms}", String(latency)),
            level,
            durationMs: index === 5 ? latency : null,
          })),
          attempts: [
            {
              providerId: provider.id,
              providerName: provider.name,
              model: provider.model,
              attemptNumber: 1,
              outcome: "success",
              httpStatus: 200,
              durationMs: latency,
              promptTokens: Math.round(rand(400, 1800)),
              completionTokens: Math.round(rand(80, 500)),
              startedAt: at,
            },
          ],
          replyText: pick(ANSWERS),
          createdAt: at,
        });
      }

      const reply = requests[requests.length - 1]!;
      messages.push({
        id: randomUUID(),
        conversationId,
        chatId: chat.chatId,
        direction: "outbound",
        text: reply.replyText,
        status: "delivered",
        providerId: provider.id,
        providerName: provider.name,
        model: provider.model,
        latencyMs: latency,
        telegramMessageId: 5000 + i * 11,
        requestId,
        createdAt: new Date(at.getTime() + latency + 200),
      });
      requestCount += 1;
      messageCount += 2;
    }

    await db.insert(schema.conversations).values({
      id: conversationId,
      chatId: chat.chatId,
      telegramUserId: "100200300",
      username: chat.username,
      firstName: chat.firstName,
      lastName: chat.lastName,
      messageCount: messages.length,
      lastMessageAt: new Date(),
      createdAt,
    });
    await db.insert(schema.messages).values(messages);

    for (const entry of requests) {
      await db.insert(schema.aiRequests).values(entry.row);
      await db.insert(schema.requestAttempts).values(
        entry.attempts.map((a) => ({ ...a, id: randomUUID(), requestId: entry.row.id })),
      );
      await db.insert(schema.requestEvents).values(
        entry.events.map((e, index) => ({
          ...e,
          id: randomUUID(),
          requestId: entry.row.id,
          seq: index + 1,
        })),
      );
    }

    await db.insert(schema.telegramUpdates).values({
      updateId: Math.floor(rand(800000, 999999)),
      chatId: chat.chatId,
      telegramUserId: "100200300",
      status: "processed",
    });
  }

  // A couple of rejections from outside the allowlist.
  await db.insert(schema.telegramUpdates).values([
    {
      updateId: 900001,
      chatId: "777000999",
      telegramUserId: "555000111",
      status: "unauthorized",
      reason: "Chat id is not in the allowlist",
    },
    {
      updateId: 900002,
      chatId: "777000999",
      telegramUserId: "555000111",
      status: "duplicate",
      reason: "Duplicate update",
    },
  ]);

  // ---- logs -------------------------------------------------------------
  const logRows: (typeof schema.logs.$inferInsert)[] = [];
  const events: Array<[string, "INFO" | "WARNING" | "ERROR", schema.LogCategory, string | null]> = [
    ["telegram.webhook_received", "INFO", "WEBHOOK", "Received update from the bot API"],
    ["provider.tested", "INFO", "API", "Test passed in 812ms"],
    ["telegram.chat_unauthorized", "WARNING", "TELEGRAM", "Rejected update from chat 777000999"],
    ["telegram.update_duplicate", "INFO", "WEBHOOK", "update_id 900002 was already processed"],
    ["provider.failed", "ERROR", "AI", "HTTP 401: invalid api key"],
    ["telegram.send_failed", "ERROR", "TELEGRAM", "Bad Request: chat not found"],
    ["provider.test_failed", "WARNING", "API", "Test failed: connection refused"],
    ["settings.updated", "INFO", "API", "Updated retryAttempts, temperature"],
  ];
  for (let i = 0; i < 90; i += 1) {
    const [event, level, category, message] = pick(events);
    const at = daysAgo(Math.floor(rand(0, 13)), Math.floor(rand(6, 23)));
    logRows.push({
      id: randomUUID(),
      level,
      category,
      event,
      message,
      correlationId: level === "ERROR" && Math.random() < 0.5 ? hex() : null,
      httpStatus: message?.includes("401") ? 401 : message?.includes("Bad Request") ? 400 : null,
      durationMs: level === "ERROR" ? Math.round(rand(300, 4200)) : null,
      createdAt: at,
    });
  }
  await db.insert(schema.logs).values(logRows);

  console.log(
    `✓ Seeded ${PROVIDERS.length} providers, ${CHATS.length} conversations, ${messageCount} messages, ${requestCount} requests.`,
  );
  client.close();
}

main().catch((error) => {
  console.error("✗ Demo seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
