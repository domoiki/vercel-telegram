import "server-only";

import { and, count, desc, eq, gte, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { LogCategory, LogLevel, MessageStatus } from "./db/schema";

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export type OverviewStats = {
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  totalRequests: number;
  failedRequests: number;
  fallbackRequests: number;
  avgLatencyMs: number | null;
  deliveryFailures: number;
  totalTokens: number | null;
  totalCost: number | null;
  successRate: number;
  fallbackRate: number;
  activeConversations: number;
};

function dayStart(offsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const db = getDb();
  const since30 = dayStart(29);

  const [messageTotals] = await db
    .select({
      total: count(),
      delivered: sql<number>`sum(case when ${schema.messages.status} = 'delivered' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${schema.messages.status} = 'failed' then 1 else 0 end)`,
    })
    .from(schema.messages)
    .where(gte(schema.messages.createdAt, since30));

  const [requestTotals] = await db
    .select({
      total: count(),
      failed: sql<number>`sum(case when ${schema.aiRequests.status} = 'failed' then 1 else 0 end)`,
      fallbacks: sql<number>`sum(case when ${schema.aiRequests.fallbackCount} > 0 then 1 else 0 end)`,
      avgLatency: sql<number>`avg(${schema.aiRequests.totalLatencyMs})`,
      tokens: sql<number>`sum(${schema.aiRequests.totalTokens})`,
      cost: sql<number>`sum(${schema.aiRequests.estimatedCost})`,
      deliveryFailed: sql<number>`sum(case when ${schema.aiRequests.telegramDelivered} = 0 then 1 else 0 end)`,
    })
    .from(schema.aiRequests)
    .where(gte(schema.aiRequests.startedAt, since30));

  const [conversationTotals] = await db
    .select({ total: count() })
    .from(schema.conversations)
    .where(gte(schema.conversations.lastMessageAt, since30));

  const total = Number(messageTotals?.total ?? 0);
  const delivered = Number(messageTotals?.delivered ?? 0);
  const failed = Number(messageTotals?.failed ?? 0);
  const requestTotal = Number(requestTotals?.total ?? 0);
  const requestFailed = Number(requestTotals?.failed ?? 0);
  const fallbacks = Number(requestTotals?.fallbacks ?? 0);
  const avgRaw = requestTotals?.avgLatency;

  return {
    totalMessages: total,
    successfulMessages: delivered,
    failedMessages: failed,
    totalRequests: requestTotal,
    failedRequests: requestFailed,
    fallbackRequests: fallbacks,
    avgLatencyMs: avgRaw === null || avgRaw === undefined ? null : Math.round(Number(avgRaw)),
    deliveryFailures: Number(requestTotals?.deliveryFailed ?? 0),
    totalTokens: requestTotals?.tokens == null ? null : Number(requestTotals.tokens),
    totalCost: requestTotals?.cost == null ? null : Number(requestTotals.cost),
    successRate: requestTotal === 0 ? 0 : ((requestTotal - requestFailed) / requestTotal) * 100,
    fallbackRate: requestTotal === 0 ? 0 : (fallbacks / requestTotal) * 100,
    activeConversations: Number(conversationTotals?.total ?? 0),
  };
}

export type DailyBucket = {
  day: string;
  label: string;
  inbound: number;
  outbound: number;
  failed: number;
  avgLatencyMs: number | null;
};

/** One row per day for the last `days` days, zero-filled so the chart never lies. */
export async function getMessageActivity(days = 14): Promise<DailyBucket[]> {
  const db = getDb();
  const since = dayStart(days - 1);

  const rows = await db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${schema.messages.createdAt}, 'unixepoch')`,
      direction: schema.messages.direction,
      status: schema.messages.status,
      total: count(),
    })
    .from(schema.messages)
    .where(gte(schema.messages.createdAt, since))
    .groupBy(sql`strftime('%Y-%m-%d', ${schema.messages.createdAt}, 'unixepoch')`, schema.messages.direction, schema.messages.status);

  const buckets = new Map<string, DailyBucket>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = dayStart(i);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, {
      day: key,
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      inbound: 0,
      outbound: 0,
      failed: 0,
      avgLatencyMs: null,
    });
  }

  for (const row of rows) {
    const key = row.day;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.direction === "inbound") bucket.inbound += row.total;
    else bucket.outbound += row.total;
    if (row.status === "failed") bucket.failed += row.total;
  }

  return [...buckets.values()];
}

export type LatencyRow = {
  providerName: string;
  providerId: string;
  requests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
};

/** Average and p95 end-to-end latency per provider, for the health table. */
export async function getProviderLatency(days = 7): Promise<LatencyRow[]> {
  const db = getDb();
  const since = dayStart(days - 1);

  const rows = await db
    .select({
      providerId: schema.aiRequests.providerId,
      providerName: schema.aiRequests.providerName,
      samples: sql<number>`${schema.aiRequests.totalLatencyMs}`,
    })
    .from(schema.aiRequests)
    .where(
      and(
        gte(schema.aiRequests.startedAt, since),
        eq(schema.aiRequests.status, "succeeded"),
        sql`${schema.aiRequests.totalLatencyMs} is not null`,
      ),
    );

  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.providerId || row.samples === null) continue;
    const list = grouped.get(row.providerId) ?? [];
    list.push(Number(row.samples));
    grouped.set(row.providerId, list);
  }

  return [...grouped.entries()]
    .map(([providerId, samples]) => {
      samples.sort((a, b) => a - b);
      const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
      const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? avg;
      const nameRow = rows.find((r) => r.providerId === providerId);
      return {
        providerId,
        providerName: nameRow?.providerName ?? "Unknown",
        requests: samples.length,
        avgLatencyMs: Math.round(avg),
        p95LatencyMs: Math.round(p95 ?? 0),
      };
    })
    .sort((a, b) => b.requests - a.requests);
}

export async function getRecentRequests(limit = 8) {
  const db = getDb();
  return db
    .select()
    .from(schema.aiRequests)
    .orderBy(desc(schema.aiRequests.startedAt))
    .limit(limit);
}

export async function getRecentErrors(limit = 6) {
  const db = getDb();
  return db
    .select()
    .from(schema.logs)
    .where(inArray(schema.logs.level, ["ERROR", "WARNING"]))
    .orderBy(desc(schema.logs.createdAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type MessageFilters = {
  search?: string;
  status?: MessageStatus | "all";
  direction?: "inbound" | "outbound" | "all";
  providerId?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
};

export function buildMessageWhere(filters: MessageFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (filters.search && filters.search.trim().length > 0) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(schema.messages.text, term),
        like(schema.messages.chatId, term),
        like(schema.messages.providerName, term),
        like(schema.messages.model, term),
      ),
    );
  }
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(schema.messages.status, filters.status));
  }
  if (filters.direction && filters.direction !== "all") {
    conditions.push(eq(schema.messages.direction, filters.direction));
  }
  if (filters.providerId && filters.providerId !== "all") {
    conditions.push(eq(schema.messages.providerId, filters.providerId));
  }
  if (filters.from) {
    const from = new Date(filters.from);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(schema.messages.createdAt, from));
  }
  if (filters.to) {
    const to = new Date(filters.to);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      conditions.push(sql`${schema.messages.createdAt} <= ${to}`);
    }
  }

  const active = conditions.filter((c): c is SQL => Boolean(c));
  return active.length ? and(...active) : undefined;
}

export async function getMessages(filters: MessageFilters) {
  const db = getDb();
  const where = buildMessageWhere(filters);
  const perPage = Math.min(100, Math.max(10, filters.perPage ?? 25));
  const page = Math.max(1, filters.page ?? 1);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(schema.messages)
      .where(where)
      .orderBy(desc(schema.messages.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(schema.messages).where(where),
  ]);

  return { rows, total: Number(totalRow?.total ?? 0), page, perPage };
}

export async function getMessageById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(schema.messages).where(eq(schema.messages.id, id)).limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export async function getConversations(limit = 50) {
  const db = getDb();
  return db
    .select({
      id: schema.conversations.id,
      chatId: schema.conversations.chatId,
      username: schema.conversations.username,
      firstName: schema.conversations.firstName,
      lastName: schema.conversations.lastName,
      messageCount: schema.conversations.messageCount,
      lastMessageAt: schema.conversations.lastMessageAt,
      createdAt: schema.conversations.createdAt,
      failedCount: sql<number>`(
        select count(*) from ${schema.messages}
        where ${schema.messages.conversationId} = ${schema.conversations.id}
          and ${schema.messages.status} = 'failed'
      )`,
    })
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(limit);
}

export async function getConversationDetail(id: string) {
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .limit(1);
  if (!conversation) return null;

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  return { conversation, messages };
}

/* ------------------------------------------------------------------ */
/* Request traces                                                      */
/* ------------------------------------------------------------------ */

export async function getRequestTrace(requestId: string) {
  const db = getDb();
  const [request] = await db
    .select()
    .from(schema.aiRequests)
    .where(eq(schema.aiRequests.id, requestId))
    .limit(1);
  if (!request) return null;

  const [events, attempts] = await Promise.all([
    db
      .select()
      .from(schema.requestEvents)
      .where(eq(schema.requestEvents.requestId, requestId))
      .orderBy(schema.requestEvents.seq),
    db
      .select()
      .from(schema.requestAttempts)
      .where(eq(schema.requestAttempts.requestId, requestId))
      .orderBy(schema.requestAttempts.attemptNumber),
  ]);

  return { request, events, attempts };
}

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

export type LogFilters = {
  search?: string;
  level?: LogLevel | "all";
  category?: string;
  correlationId?: string;
  page?: number;
  perPage?: number;
};

export async function getLogs(filters: LogFilters) {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];

  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(schema.logs.event, term),
        like(schema.logs.message, term),
        like(schema.logs.correlationId, term),
      ),
    );
  }
  if (filters.level && filters.level !== "all") {
    conditions.push(eq(schema.logs.level, filters.level));
  }
  if (filters.category && filters.category !== "all") {
    conditions.push(eq(schema.logs.category, filters.category as LogCategory));
  }
  if (filters.correlationId) {
    conditions.push(like(schema.logs.correlationId, `%${filters.correlationId}%`));
  }

  const where = conditions.filter((c): c is SQL => Boolean(c));
  const clause = where.length ? and(...where) : undefined;
  const perPage = Math.min(200, Math.max(20, filters.perPage ?? 50));
  const page = Math.max(1, filters.page ?? 1);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(schema.logs)
      .where(clause)
      .orderBy(desc(schema.logs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(schema.logs).where(clause),
  ]);

  return { rows, total: Number(totalRow?.total ?? 0), page, perPage };
}
