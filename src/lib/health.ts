import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { HealthState } from "./health-types";
import { listProviderRows } from "./providers/service";
import { getTelegramConfig } from "./settings";

export { HEALTH_LABEL, type HealthState } from "./health-types";

export const APP_VERSION = "1.0.0";

export type SystemHealth = {
  database: { state: HealthState; detail: string; latencyMs: number | null };
  telegram: {
    state: HealthState;
    detail: string;
    botConfigured: boolean;
    chatSlotsConfigured: number;
    webhookUrl: string | null;
    pendingUpdates: number | null;
  };
  providers: {
    state: HealthState;
    detail: string;
    enabled: number;
    total: number;
    primary: string | null;
    failing: number;
  };
  appVersion: string;
};

/**
 * A single round trip to the database plus a read of the config tables.
 * Cheap enough to run on every page render; never throws.
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const startedAt = Date.now();
  let database: SystemHealth["database"] = {
    state: "error",
    detail: "Not reachable",
    latencyMs: null,
  };

  try {
    const db = getDb();
    await db.select({ n: sql<number>`1` }).from(schema.settings).limit(1);
    database = {
      state: "ok",
      detail: "Turso reachable",
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    database = { state: "error", detail: "Not reachable", latencyMs: null };
  }

  let telegram: SystemHealth["telegram"] = {
    state: "unknown",
    detail: "Not configured",
    botConfigured: false,
    chatSlotsConfigured: 0,
    webhookUrl: null,
    pendingUpdates: null,
  };
  try {
    const config = await getTelegramConfig();
    const slots = [config.chatId1, config.chatId2, config.chatId3].filter(
      (v) => v && v.trim().length > 0,
    ).length;
    const botConfigured = Boolean(config.botTokenEncrypted);
    let state: HealthState = "ok";
    let detail = "Bot connected";
    if (!botConfigured) {
      state = "warn";
      detail = "No bot token saved";
    } else if (slots === 0) {
      state = "warn";
      detail = "No chat id allowlisted";
    } else if (slots < 3) {
      state = "warn";
      detail = `${slots} of 3 chat slots filled`;
    }
    if (config.webhookLastError) {
      state = "error";
      detail = config.webhookLastError;
    }
    telegram = {
      state,
      detail,
      botConfigured,
      chatSlotsConfigured: slots,
      webhookUrl: config.webhookUrl,
      pendingUpdates: config.webhookPendingCount,
    };
  } catch {
    /* leave unknown */
  }

  let providers: SystemHealth["providers"] = {
    state: "unknown",
    detail: "Not configured",
    enabled: 0,
    total: 0,
    primary: null,
    failing: 0,
  };
  try {
    const rows = await listProviderRows(true);
    const enabled = rows.filter((r) => r.enabled);
    const primary = rows.find((r) => r.isPrimary && r.enabled) ?? null;
    const failing = rows.filter((r) => r.lastTestedAt && !r.lastTestOk).length;
    let state: HealthState = "ok";
    let detail = `${enabled.length} provider${enabled.length === 1 ? "" : "s"} enabled`;
    if (rows.length === 0) {
      state = "warn";
      detail = "No providers configured";
    } else if (enabled.length === 0) {
      state = "error";
      detail = "Every provider is disabled";
    } else if (!primary) {
      state = "warn";
      detail = "No primary provider selected";
    } else if (failing > 0) {
      state = "warn";
      detail = `${failing} provider test failing`;
    }
    providers = {
      state,
      detail,
      enabled: enabled.length,
      total: rows.length,
      primary: primary?.name ?? null,
      failing,
    };
  } catch {
    /* leave unknown */
  }

  return { database, telegram, providers, appVersion: APP_VERSION };
}

/** Most recent webhook activity, used by the top bar's live indicator. */
export async function getLastUpdateAt(): Promise<Date | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ receivedAt: schema.telegramUpdates.receivedAt })
      .from(schema.telegramUpdates)
      .orderBy(desc(schema.telegramUpdates.receivedAt))
      .limit(1);
    return row?.receivedAt ?? null;
  } catch {
    return null;
  }
}

export async function getRequestByCorrelationId(correlationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.aiRequests)
    .where(eq(schema.aiRequests.correlationId, correlationId))
    .limit(1);
  return row ?? null;
}
