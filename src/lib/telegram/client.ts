import "server-only";

import { safeErrorMessage, sanitizeText } from "../sanitize";
import type { BotInfo, WebhookInfo } from "./types";

const API_BASE = "https://api.telegram.org";

export class TelegramApiError extends Error {
  readonly httpStatus: number;
  readonly telegramError: string | null;
  readonly retryAfter: number | null;

  constructor(message: string, httpStatus: number, telegramError: string | null, retryAfter: number | null) {
    super(message);
    this.name = "TelegramApiError";
    this.httpStatus = httpStatus;
    this.telegramError = telegramError;
    this.retryAfter = retryAfter;
  }
}

type TelegramEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

async function call<T>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const url = `${API_BASE}/bot${token}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new TelegramApiError(
      `Could not reach the Telegram API: ${safeErrorMessage(error, "network error")}`,
      0,
      null,
      null,
    );
  }

  let body: TelegramEnvelope<T> | null = null;
  try {
    body = (await response.json()) as TelegramEnvelope<T>;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    const description = sanitizeText(
      body?.description ?? response.statusText ?? "Telegram API request failed",
      300,
    );
    throw new TelegramApiError(
      description,
      response.status,
      description,
      body?.parameters?.retry_after ?? null,
    );
  }

  return body.result as T;
}

export type SendResult = { messageId: number };

/** Telegram rejects messages over 4096 characters; split on paragraph breaks. */
export function splitMessage(text: string, limit = 4096): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  const paragraphs = trimmed.split(/\n{2,}/);

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 <= limit) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    // A single oversized paragraph: hard-wrap it.
    let rest = paragraph;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(" ", limit);
      if (cut < limit * 0.6) cut = limit;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length > 0);
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  signal?: AbortSignal,
): Promise<SendResult[]> {
  const parts = splitMessage(text);
  const sent: SendResult[] = [];
  for (const part of parts) {
    const result = await call<{ message_id: number }>(
      token,
      "sendMessage",
      {
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true,
        disable_notification: false,
      },
      signal,
    );
    sent.push({ messageId: result.message_id });
  }
  return sent;
}

export async function getMe(token: string): Promise<BotInfo> {
  return call<BotInfo>(token, "getMe");
}

export async function getWebhookInfo(token: string): Promise<WebhookInfo> {
  return call<WebhookInfo>(token, "getWebhookInfo");
}

export async function setWebhook(
  token: string,
  url: string,
  options: { secretToken?: string | null; allowedUpdates?: string[] } = {},
): Promise<boolean> {
  await call<boolean>(token, "setWebhook", {
    url,
    drop_pending_updates: false,
    ...(options.secretToken ? { secret_token: options.secretToken } : {}),
    allowed_updates: options.allowedUpdates ?? ["message", "edited_message", "channel_post"],
  });
  return true;
}

export async function deleteWebhook(token: string, dropPending = false): Promise<boolean> {
  await call<boolean>(token, "deleteWebhook", { drop_pending_updates: dropPending });
  return true;
}
