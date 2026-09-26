import { eq } from "drizzle-orm";

import { assertAdminKey, fail, handle, ok, readJson } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ensureSinglePrimary, getProviderRow, toSummary } from "@/lib/providers/service";
import { providerInputSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handle("providers.get", async () => {
    const { id } = await context.params;
    const row = await getProviderRow(id);
    if (!row) return fail("Provider not found", 404);
    return ok({ provider: toSummary(row) });
  });
}

export async function PATCH(request: Request, context: Context) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("providers.update", async () => {
    const { id } = await context.params;
    const existing = await getProviderRow(id);
    if (!existing) return fail("Provider not found", 404);

    const body = await readJson(request);
    const parsed = providerInputSchema.partial().safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(
        first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid provider",
        422,
      );
    }
    const input = parsed.data;

    if (input.customBodyTemplate) {
      try {
        JSON.parse(input.customBodyTemplate);
      } catch {
        return fail("Request body template must be valid JSON", 422);
      }
    }

    const db = getDb();
    const patch: Partial<typeof schema.aiProviders.$inferInsert> = { updatedAt: new Date() };

    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.model !== undefined) patch.model = input.model;
    if (input.adapter !== undefined) patch.adapter = input.adapter;
    if (input.temperature !== undefined) patch.temperature = input.temperature ?? null;
    if (input.maxTokens !== undefined) patch.maxTokens = input.maxTokens ?? null;
    if (input.timeoutMs !== undefined) patch.timeoutMs = input.timeoutMs;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary;
    if (input.inputCostPerMillion !== undefined) patch.inputCostPerMillion = input.inputCostPerMillion ?? null;
    if (input.outputCostPerMillion !== undefined) patch.outputCostPerMillion = input.outputCostPerMillion ?? null;
    if (input.customResponsePath !== undefined) patch.customResponsePath = input.customResponsePath || null;
    if (input.customBodyTemplate !== undefined) patch.customBodyTemplate = input.customBodyTemplate || null;

    // Secrets: blank means "leave as is"; clearApiKey removes it.
    if (input.clearApiKey) {
      patch.apiKeyEncrypted = null;
    } else if (input.apiKey) {
      patch.apiKeyEncrypted = encryptSecret(input.apiKey);
    }
    if (input.customHeaders !== undefined) {
      patch.customHeadersEncrypted =
        input.customHeaders && Object.keys(input.customHeaders).length > 0
          ? encryptSecret(JSON.stringify(input.customHeaders))
          : null;
    }

    // Any config change invalidates the previous test verdict.
    patch.lastTestedAt = null;
    patch.lastTestOk = null;
    patch.lastTestError = null;
    patch.lastTestHttpStatus = null;
    patch.lastTestLatencyMs = null;

    await db.update(schema.aiProviders).set(patch).where(eq(schema.aiProviders.id, id));
    await ensureSinglePrimary(input.isPrimary ? id : undefined);

    await logger.info({
      category: "API",
      event: "provider.updated",
      message: `Updated provider "${input.name ?? existing.name}"`,
      providerId: id,
    });

    const [updated] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, id));
    return ok({ provider: updated ? toSummary(updated) : null });
  });
}

export async function DELETE(request: Request, context: Context) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("providers.delete", async () => {
    const { id } = await context.params;
    const existing = await getProviderRow(id);
    if (!existing) return fail("Provider not found", 404);

    const db = getDb();
    // Message history keeps the provider name as a snapshot, so deleting a
    // provider never orphans or rewrites past records.
    await db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, id));
    await ensureSinglePrimary();

    await logger.warn({
      category: "API",
      event: "provider.deleted",
      message: `Deleted provider "${existing.name}"`,
      providerId: id,
    });

    return ok({ deleted: true, id });
  });
}
