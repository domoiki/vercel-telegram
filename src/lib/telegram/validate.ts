import "server-only";

import type { ParsedTelegramMessage, TelegramUpdate } from "./types";

export type ParseResult =
  | { ok: true; message: ParsedTelegramMessage; source: "message" | "edited_message" | "channel_post" }
  | { ok: false; reason: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  return null;
}

/**
 * Turns a raw webhook body into a normalised inbound message.
 *
 * Deliberately strict: a malformed update is dropped with a reason rather than
 * partially processed, so a bad payload can never reach the AI provider.
 */
export function parseTelegramUpdate(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "Body is not an object" };
  }
  const update = body as TelegramUpdate;
  if (typeof update.update_id !== "number" || !Number.isFinite(update.update_id)) {
    return { ok: false, reason: "Missing or invalid update_id" };
  }

  const source: "message" | "edited_message" | "channel_post" = update.message
    ? "message"
    : update.edited_message
      ? "edited_message"
      : update.channel_post
        ? "channel_post"
        : "message";

  const raw = update.message ?? update.edited_message ?? update.channel_post;
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "Update contains no message" };
  }

  const chatId = safeId(raw.chat?.id);
  if (!chatId) {
    return { ok: false, reason: "Message has no usable chat id" };
  }

  if (typeof raw.message_id !== "number" || !Number.isFinite(raw.message_id)) {
    return { ok: false, reason: "Message has no usable message_id" };
  }

  const text = asString(raw.text) || asString(raw.caption);
  const userId = safeId(raw.from?.id);

  // A media-only message has no text to reason about; accept it and let the
  // conversation engine reply with a short capability note.
  const isCommand = text.startsWith("/");

  return {
    ok: true,
    source,
    message: {
      updateId: update.update_id,
      messageId: raw.message_id,
      chatId,
      chatType: asString(raw.chat?.type) || "private",
      userId,
      username: asString(raw.from?.username) || null,
      firstName: asString(raw.from?.first_name) || null,
      lastName: asString(raw.from?.last_name) || null,
      text,
      date: typeof raw.date === "number" ? new Date(raw.date * 1000) : null,
      isCommand,
      commandName: isCommand ? (text.split(/\s+/)[0] ?? "").replace(/^\//, "").split("@")[0] ?? null : null,
    },
  };
}

export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Only the three configured chat slots may drive the AI provider.
 * Slot membership is exact string comparison on the chat id.
 */
export function isChatAllowed(
  chatId: string,
  slots: { chatId1: string | null; chatId2: string | null; chatId3: string | null },
): AuthorizationResult {
  const configured = [slots.chatId1, slots.chatId2, slots.chatId3]
    .map((v) => (v ?? "").trim())
    .filter((v) => v.length > 0);

  if (configured.length === 0) {
    return { allowed: false, reason: "No chat ids configured" };
  }
  if (configured.includes(chatId)) return { allowed: true };
  return { allowed: false, reason: "Chat id is not in the allowlist" };
}

/** Telegram's own optional secret header. When set, a mismatched value is rejected. */
export function verifySecretToken(
  provided: string | null,
  expected: string | null | undefined,
): boolean {
  if (!expected) return true;
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
