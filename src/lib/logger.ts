import "server-only";

import { getDb, schema } from "./db";
import type { LogCategory, LogLevel } from "./db/schema";
import { newId } from "./ids";
import { safeErrorMessage, sanitizeMeta, sanitizeText } from "./sanitize";

export type LogInput = {
  level?: LogLevel;
  category?: LogCategory;
  event: string;
  message?: string;
  correlationId?: string | null;
  requestId?: string | null;
  providerId?: string | null;
  chatId?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  meta?: unknown;
};

/**
 * Structured application log.
 *
 * Never throws: a logging failure must not take down the request that logged.
 * The `console` mirror is for Vercel function logs; both paths are sanitised.
 */
export async function log(input: LogInput): Promise<void> {
  const level = input.level ?? "INFO";
  const category = input.category ?? "SYSTEM";
  const message = input.message ? sanitizeText(input.message, 1000) : null;
  const meta = input.meta === undefined ? null : JSON.stringify(sanitizeMeta(input.meta));

  const line = {
    level,
    category,
    event: input.event,
    ...(message ? { message } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.httpStatus ? { httpStatus: input.httpStatus } : {}),
    ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
  };

  const consoleLine = JSON.stringify(line);
  if (level === "ERROR") console.error(consoleLine);
  else if (level === "WARNING") console.warn(consoleLine);
  else console.log(consoleLine);

  try {
    const db = getDb();
    await db.insert(schema.logs).values({
      id: newId(),
      level,
      category,
      event: input.event,
      message,
      correlationId: input.correlationId ?? null,
      requestId: input.requestId ?? null,
      providerId: input.providerId ?? null,
      chatId: input.chatId ?? null,
      httpStatus: input.httpStatus ?? null,
      durationMs: input.durationMs ?? null,
      meta,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        category: "DATABASE",
        event: "log.persist_failed",
        message: safeErrorMessage(error),
      }),
    );
  }
}

export const logger = {
  debug: (input: Omit<LogInput, "level">) => log({ ...input, level: "DEBUG" }),
  info: (input: Omit<LogInput, "level">) => log({ ...input, level: "INFO" }),
  warn: (input: Omit<LogInput, "level">) => log({ ...input, level: "WARNING" }),
  error: (input: Omit<LogInput, "level">) => log({ ...input, level: "ERROR" }),
};
