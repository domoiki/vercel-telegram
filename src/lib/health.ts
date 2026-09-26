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
 * Telegram's own `last_error_message` is the ground truth, but it conflates two
 * very different situations:
 *
 *   - The delivery itself failed — TLS, DNS, connection refused, a 4xx from a
 *     proxy. The integration is broken and no update can get through.
 *   - Telegram reached us and we answered 5xx. Delivery worked; something
 *     downstream failed — almost always the provider chain.
 *
 * Only the first is a Telegram problem. Reporting the second as "Problem" here
 * sends people to debug the wrong card, so it is downgraded to a warning that
 * points at where the failure actually lives.
 */
function classifyWebhookError(message: string): { state: HealthState; detail: string } {
  // Telegram reports a non-2xx from the endpoint as "Wrong response from the
  // webhook: <status>". That phrasing only ever appears once it has reached us.
  const reachedUs = /wrong response from the webhook/i.test(message);
  const status = /wrong response from the webhook:\s*(\d{3})/i.exec(message)?.[1];

  if (reachedUs) {
    const code = status ? Number(status) : 0;
    if (code >= 500) {
      return {
        state: "warn",
        detail: `Webhook reached Telegram but returned HTTP ${code} — check the provider chain`,
      };
    }
    if (code >= 400) {
      return {
        state: "error",
        detail: `Webhook rejected with HTTP ${code}`,
      };
    }
    return { state: "warn", detail: message };
  }

  // Everything else is a delivery-layer problem: the webhook is unusable.
  return { state: "error", detail: message };
}

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
      const classified = classifyWebhookError(config.webhookLastError);
      // A delivery failure always wins. A downstream 5xx is only allowed to
      // speak up when nothing more specific has been noticed, so it cannot
      // hide a configuration problem.
      if (classified.state === "error" || state === "ok") {
        state = classified.state;
        detail = classified.detail;
      }
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
