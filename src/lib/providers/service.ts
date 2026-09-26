import "server-only";

import { and, asc, eq, isNull, not, or, sql } from "drizzle-orm";
import { decryptSecret, maskSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import type { AiProviderRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { getAdapter, isAdapterId } from "./registry";
import { type ProviderSummary } from "./shared";
import type { ProviderConfig } from "./types";

export type { ProviderSummary };

function parseHeaders(encrypted: string | null): Record<string, string> {
  const raw = decryptSecret(encrypted);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function parseBodyTemplate(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toSummary(row: AiProviderRow): ProviderSummary {
  const headers = parseHeaders(row.customHeadersEncrypted);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    model: row.model,
    adapter: row.adapter,
    hasApiKey: Boolean(row.apiKeyEncrypted),
    apiKeyMask: maskSecret(decryptSecret(row.apiKeyEncrypted)),
    hasCustomHeaders: Object.keys(headers).length > 0,
    customHeaderNames: Object.keys(headers),
    customBodyTemplate: row.customBodyTemplate,
    customResponsePath: row.customResponsePath,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    enabled: row.enabled,
    isPrimary: row.isPrimary,
    priority: row.priority,
    inputCostPerMillion: row.inputCostPerMillion,
    outputCostPerMillion: row.outputCostPerMillion,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    lastTestHttpStatus: row.lastTestHttpStatus,
    lastTestLatencyMs: row.lastTestLatencyMs,
    lastTestError: row.lastTestError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Full server-side config with the secret decrypted. Never leaves the server. */
export function toProviderConfig(row: AiProviderRow): ProviderConfig {
  const base = {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: decryptSecret(row.apiKeyEncrypted),
    model: row.model,
    // Rows written before an adapter was renamed still resolve through the
    // registry default rather than crashing the router.
    adapter: isAdapterId(row.adapter) ? row.adapter : "openai-compatible",
    customHeaders: parseHeaders(row.customHeadersEncrypted),
    timeoutMs: row.timeoutMs,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
  if (row.adapter === "custom-http") {
    return {
      ...base,
      bodyTemplate: parseBodyTemplate(row.customBodyTemplate),
      responsePath: row.customResponsePath,
    } as ProviderConfig;
  }
  return base;
}

export async function listProviderRows(includeDisabled = true): Promise<AiProviderRow[]> {
  const db = getDb();
  const condition = includeDisabled ? undefined : eq(schema.aiProviders.enabled, true);
  return db
    .select()
    .from(schema.aiProviders)
    .where(condition)
    .orderBy(asc(schema.aiProviders.priority), asc(schema.aiProviders.createdAt));
}

export async function getProviderRow(id: string): Promise<AiProviderRow | null> {
  const db = getDb();
  const [row] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, id)).limit(1);
  return row ?? null;
}

/**
 * The live fallback chain: primary first, then remaining providers by priority.
 * Purely id/flag driven — never positional array indexing.
 */
export async function getProviderChain(): Promise<AiProviderRow[]> {
  const rows = await listProviderRows(true);
  const enabled = rows.filter((r) => r.enabled);
  const primary = enabled.filter((r) => r.isPrimary).sort((a, b) => a.priority - b.priority);
  const rest = enabled
    .filter((r) => !r.isPrimary)
    .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
  return [...primary, ...rest];
}

/** Guarantees exactly one primary when at least one enabled provider exists. */
export async function ensureSinglePrimary(preferredId?: string): Promise<void> {
  const db = getDb();
  const rows = await listProviderRows(true);
  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length === 0) {
    await db.update(schema.aiProviders).set({ isPrimary: false });
    return;
  }
  const primaries = enabled.filter((r) => r.isPrimary);
  const preferred = preferredId ? enabled.find((r) => r.id === preferredId) : undefined;

  if (preferred) {
    await db.update(schema.aiProviders).set({ isPrimary: false });
    await db.update(schema.aiProviders).set({ isPrimary: true }).where(eq(schema.aiProviders.id, preferred.id));
    return;
  }
  if (primaries.length === 1) {
    // A primary exists but is disabled — promote the first enabled provider.
    if (primaries[0]) {
      await db
        .update(schema.aiProviders)
        .set({ isPrimary: true })
        .where(eq(schema.aiProviders.id, (enabled[0] as AiProviderRow).id));
    }
    return;
  }
  await db.update(schema.aiProviders).set({ isPrimary: false });
  await db
    .update(schema.aiProviders)
    .set({ isPrimary: true })
    .where(eq(schema.aiProviders.id, (enabled[0] as AiProviderRow).id));
}

/** Persists the fallback order the user dragged into place. */
export async function setProviderOrder(orderedIds: string[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(schema.aiProviders)
        .set({ priority: index + 1, updatedAt: new Date() })
        .where(eq(schema.aiProviders.id, id));
    }
  });
}

export async function nextPriority(): Promise<number> {
  const rows = await listProviderRows(true);
  return rows.reduce((max, r) => Math.max(max, r.priority), 0) + 1;
}

export function buildProviderId(): string {
  return newId();
}

/** Persists the outcome of a Test Connection run against a provider row. */
export async function recordProviderTest(
  id: string,
  result: {
    ok: boolean;
    httpStatus: number | null;
    durationMs: number;
    errorMessage: string | null;
  },
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.aiProviders)
    .set({
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestHttpStatus: result.httpStatus,
      lastTestLatencyMs: result.durationMs,
      lastTestError: result.errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(schema.aiProviders.id, id));
}

export async function runProviderTest(row: AiProviderRow) {
  const adapter = getAdapter(row.adapter);
  const result = await adapter.test(toProviderConfig(row));
  await recordProviderTest(row.id, {
    ok: result.ok,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    errorMessage: result.errorMessage,
  });
  return result;
}

/** Marks providers that have never passed a test — used for the health column. */
export async function providerHealth(row: AiProviderRow): Promise<"healthy" | "unverified" | "failing"> {
  if (!row.enabled) return "unverified";
  if (row.lastTestedAt === null) return "unverified";
  return row.lastTestOk ? "healthy" : "failing";
}

export const providerFilterHelpers = { and, or, isNull, not, sql };
