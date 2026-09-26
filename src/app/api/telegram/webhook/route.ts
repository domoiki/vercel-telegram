import { ok } from "@/lib/api";
import { processTelegramUpdate } from "@/lib/gateway";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/sanitize";

/**
 * The public endpoint Telegram posts updates to.
 *
 * This route is a thin transport: it hands the body to the gateway and answers.
 * Webhook *management* (register / status / remove) lives in
 * /api/telegram/webhook/manage so this path stays reserved for Telegram.
 *
 * Status codes are chosen to stop Telegram's retry storm without ever dropping
 * work we could still have handled:
 *   • malformed body / unusable update → 200, a retry will not help
 *   • duplicate update                  → 200, already handled
 *   • rejected chat                     → 200, deliberate
 *   • handled (answered or not)         → 200
 *   • unexpected failure                → 500, so Telegram retries; the
 *                                         persisted update_id ledger makes
 *                                         that replay safe
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ok({ accepted: false, status: "invalid", reason: "malformed_body" });
  }

  const outcome = await processTelegramUpdate(body).catch((error: unknown) => {
    // A bug past this point must not become an unhandled rejection: Telegram
    // gets a 500 and retries, which is safe thanks to the update_id ledger.
    return {
      status: "failed" as const,
      reason: safeErrorMessage(error, "Unhandled gateway error"),
    };
  });

  if (outcome.status === "failed") {
    // Tell Telegram to try again. The update_id ledger means a replay is a
    // no-op if the first attempt actually got far enough to claim it.
    await logger.error({
      category: "WEBHOOK",
      event: "telegram.webhook_failed",
      message: outcome.reason ?? "Unhandled gateway error",
    });
    return ok({ accepted: false, status: "failed", reason: outcome.reason }, { status: 500 });
  }

  return ok({
    accepted: outcome.status === "processed",
    status: outcome.status,
    reason: outcome.reason,
    requestId: outcome.requestId,
  });
}

/**
 * Liveness probe. Telegram only ever uses POST, so GET is free to answer.
 * Reports readiness without touching the bot token.
 */
export async function GET() {
  return ok({
    service: "telegram-ai-gateway",
    status: "ready",
    manage: "/api/telegram/webhook/manage",
  });
}
