import { handle, ok } from "@/lib/api";
import { getMessages } from "@/lib/queries";
import type { MessageStatus } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle("messages.list", async () => {
    const params = new URL(request.url).searchParams;
    const result = await getMessages({
      search: params.get("q") ?? undefined,
      status: (params.get("status") as MessageStatus | "all" | null) ?? "all",
      direction: (params.get("direction") as "inbound" | "outbound" | "all" | null) ?? "all",
      providerId: params.get("provider") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      page: Number(params.get("page") ?? 1) || 1,
      perPage: Number(params.get("perPage") ?? 25) || 25,
    });
    return ok({
      messages: result.rows,
      total: result.total,
      page: result.page,
      perPage: result.perPage,
    });
  });
}
