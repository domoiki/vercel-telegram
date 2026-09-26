import { handle, ok } from "@/lib/api";
import { getConversations } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle("conversations.list", async () => {
    return ok({ conversations: await getConversations(200) });
  });
}
