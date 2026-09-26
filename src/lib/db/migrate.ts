/**
 * Applies pending SQL migrations to the configured database.
 * Run with: npm run db:migrate
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { loadEnvFiles } from "../load-env";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../../drizzle");

async function main() {
  loadEnvFiles();
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "Missing database URL.\n" +
        "Set TURSO_DATABASE_URL (production) or DATABASE_URL (local, e.g. file:./data/gateway.db)\n" +
        "in your .env file, then run: npm run db:migrate",
    );
    process.exit(1);
  }

  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = dirname(resolve(process.cwd(), filePath));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    console.log(`▸ Using local SQLite database at ${resolve(process.cwd(), filePath)}`);
  } else {
    console.log("▸ Using Turso database");
  }

  if (!existsSync(migrationsFolder)) {
    console.error(
      `No migrations folder at ${migrationsFolder}.\nRun: npm run db:generate`,
    );
    process.exit(1);
  }

  const client = createClient({
    url,
    ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}),
  });
  const db = drizzle(client);

  console.log("▸ Applying migrations…");
  await migrate(db, { migrationsFolder });
  console.log("✓ Migrations applied.");
  client.close();
}

main().catch((error) => {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
