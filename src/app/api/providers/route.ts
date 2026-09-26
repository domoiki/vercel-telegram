import { eq } from "drizzle-orm";

import { assertAdminKey, fail, handle, ok, readJson } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  ensureSinglePrimary,
  listProviderRows,
  nextPriority,
  toSummary,
} from "@/lib/providers/service";
import { providerInputSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle("providers.list", async () => {
    const rows = await listProviderRows(true);
    return ok({ providers: rows.map(toSummary) });
  });
}

export async function POST(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("providers.create", async () => {
    const body = await readJson(request);
    const parsed = providerInputSchema.safeParse(body);
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
    const priority = await nextPriority();
    const id = newId();
    const now = new Date();

    const apiKeyEncrypted = input.clearApiKey
      ? null
      : input.apiKey
        ? encryptSecret(input.apiKey)
        : null;

    const row = {
      id,
      name: input.name,
      description: input.description ?? null,
      baseUrl: input.baseUrl,
      apiKeyEncrypted,
      model: input.model,
      adapter: input.adapter,
      customHeadersEncrypted: input.customHeaders
        ? encryptSecret(JSON.stringify(input.customHeaders))
        : null,
      customBodyTemplate: input.customBodyTemplate || null,
      customResponsePath: input.customResponsePath || null,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      timeoutMs: input.timeoutMs ?? 30_000,
      enabled: input.enabled ?? true,
      isPrimary: input.isPrimary ?? false,
      priority,
      inputCostPerMillion: input.inputCostPerMillion ?? null,
      outputCostPerMillion: input.outputCostPerMillion ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.aiProviders).values(row);
    await ensureSinglePrimary(input.isPrimary ? id : undefined);

    await logger.info({
      category: "API",
      event: "provider.created",
      message: `Created provider "${input.name}"`,
      providerId: id,
    });

    const [created] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, id));
    return ok({ provider: created ? toSummary(created) : null }, { status: 201 });
  });
}
