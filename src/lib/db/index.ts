import "server-only";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

type DbGlobal = typeof globalThis & {
  __gatewayDb?: Database;
  __gatewayClient?: Client;
};

const globalForDb = globalThis as DbGlobal;

function resolveConfig(): { url: string; authToken: string | undefined } {
  const configured = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  // A local SQLite file is a development convenience only. The Vercel
  // filesystem is read-only, so falling back to one in production would fail
  // much later with an opaque driver error. Fail here, with the fix attached.
  const url = configured ?? (process.env.NODE_ENV === "production" ? null : "file:./data/gateway.db");
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "No database is configured. Set TURSO_DATABASE_URL in this deployment's environment — " +
        "a local SQLite file cannot be used on Vercel, because the serverless filesystem is read-only.",
    );
  }
  // A remote libSQL database without a token fails on the first query with a
  // message about authentication, which is a long way from the real cause.
  if (!url.startsWith("file:") && !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL points at a remote database but TURSO_AUTH_TOKEN is not set. " +
        "Create a read-write token with `turso db tokens create` and add it to the environment.",
    );
  }

  return { url, authToken };
}

/**
 * Serverless-safe connection: one libSQL client per warm instance, created lazily.
 * Turso is the source of truth — no in-memory caching of application state.
 */
export function getDb(): Database {
  if (globalForDb.__gatewayDb) return globalForDb.__gatewayDb;

  const { url, authToken } = resolveConfig();
  const client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });
  const db = drizzle(client, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__gatewayClient = client;
    globalForDb.__gatewayDb = db;
  }
  return db;
}

/** Used by migrations/seed scripts that need the raw driver. */
export function getRawClient(): Client {
  if (globalForDb.__gatewayClient) return globalForDb.__gatewayClient;
  const { url, authToken } = resolveConfig();
  return createClient({ url, ...(authToken ? { authToken } : {}) });
}

export { schema };
