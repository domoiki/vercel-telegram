/**
 * Writes the default settings row set and creates the single Telegram config row.
 * Safe to run repeatedly. Run with: npm run db:seed
 */
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { loadEnvFiles } from "../load-env";
import * as schema from "./schema";
import { SETTING_DEFAULTS } from "../settings-defaults";

async function main() {
  loadEnvFiles();
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set TURSO_DATABASE_URL or DATABASE_URL before seeding.");
    process.exit(1);
  }
  if (url.startsWith("file:")) {
    const dir = dirname(resolve(process.cwd(), url.slice("file:".length)));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const client = createClient({
    url,
    ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}),
  });
  const db = drizzle(client, { schema });
  const now = new Date();

  const settingsRows = Object.entries(SETTING_DEFAULTS).map(([key, value]) => ({
    key,
    value,
    updatedAt: now,
  }));
  await db.insert(schema.settings).values(settingsRows).onConflictDoNothing();
  console.log(`✓ Seeded ${settingsRows.length} settings.`);

  await db
    .insert(schema.telegramConfig)
    .values({ id: 1, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  console.log("✓ Telegram config row ready (bot token and chat ids are set in the dashboard).");

  const existing = await db.select().from(schema.aiProviders);
  if (existing.length === 0) {
    console.log("· No providers seeded — add your first one in Settings → AI Providers.");
  } else {
    console.log(`· ${existing.length} provider(s) already present.`);
  }

  client.close();
}

main().catch((error) => {
  console.error("✗ Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
