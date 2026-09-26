import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { settings as settingsTable } from "./db/schema";
import { SETTING_DEFAULTS, type SettingKey, type ThemePreference } from "./settings-defaults";

export { SETTING_DEFAULTS };
export type { SettingKey };

export type AppSettings = {
  maxHistoryMessages: number;
  temperature: number;
  maxTokens: number;
  retryAttempts: number;
  providerTimeoutMs: number;
  defaultTheme: ThemePreference;
};

function toNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Reads all settings, falling back to the shipped default for anything
 * missing or unparseable.
 *
 * `SETTING_DEFAULTS` doubles as the key list: `stored.get(key)` is what carries
 * the user's saved value, and `SETTING_DEFAULTS[key]` is what to use when
 * there is no row. Reading the map with the default *value* as a key would
 * silently ignore everything the Settings page saves.
 */
export async function getSettings(): Promise<AppSettings> {
  const db = getDb();
  const rows = await db.select().from(settingsTable);
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const read = (key: SettingKey) => stored.get(key) ?? SETTING_DEFAULTS[key];

  const theme = read("defaultTheme");
  return {
    maxHistoryMessages: toNumber(read("maxHistoryMessages"), 20, 1, 200),
    temperature: toNumber(read("temperature"), 0.7, 0, 2),
    maxTokens: toNumber(read("maxTokens"), 4096, 16, 200_000),
    retryAttempts: toNumber(read("retryAttempts"), 2, 0, 10),
    providerTimeoutMs: toNumber(read("providerTimeoutMs"), 30_000, 1000, 120_000),
    defaultTheme:
      theme === "light" || theme === "dark" || theme === "system" ? theme : "system",
  };
}

export async function setSetting(key: SettingKey, value: string) {
  const db = getDb();
  const nowSeconds = Math.floor(Date.now() / 1000);
  await db
    .insert(settingsTable)
    .values({ key, value, updatedAt: new Date(nowSeconds * 1000) })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date(nowSeconds * 1000) },
    });
}

export async function ensureSettingsSeeded() {
  const db = getDb();
  const existing = await db.select({ key: settingsTable.key }).from(settingsTable);
  const have = new Set(existing.map((r) => r.key));
  const missing = Object.entries(SETTING_DEFAULTS)
    .filter(([key]) => !have.has(key))
    .map(([key, value]) => ({ key, value }));
  if (missing.length === 0) return;
  const nowSeconds = Math.floor(Date.now() / 1000);
  await db
    .insert(settingsTable)
    .values(missing.map((m) => ({ ...m, updatedAt: new Date(nowSeconds * 1000) })))
    .onConflictDoNothing();
}

/** Lazily creates the single telegram_config row. */
export async function ensureTelegramConfig() {
  const db = getDb();
  const [existing] = await db.select().from(schema.telegramConfig).limit(1);
  if (existing) return existing;
  const now = new Date();
  await db.insert(schema.telegramConfig).values({ id: 1, createdAt: now, updatedAt: now });
  const [created] = await db.select().from(schema.telegramConfig).limit(1);
  if (!created) throw new Error("Failed to create telegram_config row");
  return created;
}

export async function updateTelegramConfig(patch: Partial<typeof schema.telegramConfig.$inferInsert>) {
  const db = getDb();
  await ensureTelegramConfig();
  await db
    .update(schema.telegramConfig)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.telegramConfig.id, 1));
}

export async function getTelegramConfig() {
  return ensureTelegramConfig();
}
