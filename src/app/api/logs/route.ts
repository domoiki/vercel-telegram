import { handle, ok } from "@/lib/api";
import { getLogs } from "@/lib/queries";
import type { LogLevel } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle("logs.list", async () => {
    const params = new URL(request.url).searchParams;
    const result = await getLogs({
      search: params.get("q") ?? undefined,
      level: (params.get("level") as LogLevel | "all" | null) ?? "all",
      category: params.get("category") ?? "all",
      correlationId: params.get("correlationId") ?? undefined,
      page: Number(params.get("page") ?? 1) || 1,
      perPage: Number(params.get("perPage") ?? 50) || 50,
    });
    return ok({ logs: result.rows, total: result.total, page: result.page, perPage: result.perPage });
  });
}
