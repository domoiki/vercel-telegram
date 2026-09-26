import { assertAdminKey, fail, handle, ok } from "@/lib/api";
import { logger } from "@/lib/logger";
import { getProviderRow, runProviderTest } from "@/lib/providers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

/**
 * Real server-side round trip against the provider.
 * The response carries status, latency, model and a safe error string only —
 * never the key or the raw request headers.
 */
export async function POST(request: Request, context: Context) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("providers.test", async () => {
    const { id } = await context.params;
    const row = await getProviderRow(id);
    if (!row) return fail("Provider not found", 404);

    const startedAt = Date.now();
    const result = await runProviderTest(row);

    await logger.info({
      category: "API",
      event: "provider.tested",
      message: result.ok
        ? `Test passed in ${result.durationMs}ms`
        : `Test failed: ${result.errorMessage ?? "unknown error"}`,
      providerId: id,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
    });

    return ok({
      result: {
        ok: result.ok,
        httpStatus: result.httpStatus,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        errorMessage: result.errorMessage,
        errorCategory: result.errorCategory,
        model: result.model,
        sample: result.ok ? (result.sample ?? "").slice(0, 160) : null,
      },
    });
  });
}
