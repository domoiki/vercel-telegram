import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { EventLevel } from "./db/schema";
import { newId } from "./ids";
import { logger } from "./logger";
import { sanitizeText } from "./sanitize";

export type TraceEvent = {
  event: string;
  detail?: string | null;
  level?: EventLevel;
  durationMs?: number | null;
};

/**
 * Appends an event to a request's execution timeline.
 *
 * `seq` continues from the current max for the request, which keeps ordering
 * stable and matches the unique index on (request_id, seq).
 */
export async function trace(requestId: string, entry: TraceEvent): Promise<void> {
  const level = entry.level ?? "info";
  const detail = entry.detail ? sanitizeText(entry.detail, 500) : null;

  try {
    const db = getDb();
    const existing = await db
      .select({ seq: schema.requestEvents.seq })
      .from(schema.requestEvents)
      .where(eq(schema.requestEvents.requestId, requestId))
      .orderBy(desc(schema.requestEvents.seq))
      .limit(1);

    const seq = (existing[0]?.seq ?? 0) + 1;

    await db.insert(schema.requestEvents).values({
      id: newId(),
      requestId,
      seq,
      event: entry.event,
      detail,
      level,
      durationMs: entry.durationMs ?? null,
    });

    if (level === "error") {
      await logger.error({
        category: "AI",
        event: entry.event,
        ...(detail ? { message: detail } : {}),
        requestId,
      });
    } else if (level === "warning") {
      await logger.warn({
        category: "AI",
        event: entry.event,
        ...(detail ? { message: detail } : {}),
        requestId,
      });
    }
  } catch {
    // Tracing must never break the pipeline.
  }
}
