import { assertAdminKey, fail, handle, ok, readJson } from "@/lib/api";
import { logger } from "@/lib/logger";
import { listProviderRows, setProviderOrder, toSummary } from "@/lib/providers/service";
import { providerOrderSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Persists the fallback chain order the user arranged in the dashboard. */
export async function POST(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("providers.order", async () => {
    const parsed = providerOrderSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail("Expected an array of provider ids", 422);

    const known = new Set((await listProviderRows(true)).map((p) => p.id));
    const ids = parsed.data.ids.filter((id) => known.has(id));
    if (ids.length === 0) return fail("No known providers in that order", 422);

    await setProviderOrder(ids);
    await logger.info({
      category: "API",
      event: "provider.reordered",
      message: `Fallback chain order updated (${ids.length} providers)`,
    });

    const rows = await listProviderRows(true);
    return ok({ providers: rows.map(toSummary) });
  });
}
