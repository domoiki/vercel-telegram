import { assertAdminKey, fail, handle, ok } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/sanitize";
import { getTelegramConfig, updateTelegramConfig } from "@/lib/settings";
import { deleteWebhook, getWebhookInfo, setWebhook } from "@/lib/telegram/client";

/**
 * Webhook management, kept off /api/telegram/webhook so that path can stay
 * reserved for the updates Telegram delivers.
 *
 *   GET     current webhook status, refreshed from Telegram
 *   POST    register this deployment as the webhook target
 *   DELETE  remove the webhook and drop anything still pending
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return handle("telegram.webhook.info", async () => {
    const config = await getTelegramConfig();
    const token = decryptSecret(config.botTokenEncrypted);
    if (!token) return fail("No bot token is saved yet.", 400);

    try {
      const info = await getWebhookInfo(token);
      await updateTelegramConfig({
        webhookUrl: info.url || null,
        webhookPendingCount: info.pending_update_count,
        webhookLastError: info.last_error_message ?? null,
        lastCheckedAt: new Date(),
      });
      return ok({
        url: info.url,
        pendingUpdateCount: info.pending_update_count,
        lastError: info.last_error_message ?? null,
        lastErrorDate: info.last_error_date ?? null,
        ipAddress: info.ip_address ?? null,
      });
    } catch (error) {
      // Report the Telegram-side problem in the payload, not as a transport
      // failure: the dashboard renders this as an inline warning.
      const message = safeErrorMessage(error, "Could not read webhook status");
      await updateTelegramConfig({ webhookLastError: message, lastCheckedAt: new Date() });
      return ok({ url: null, pendingUpdateCount: null, lastError: message });
    }
  });
}

export async function POST(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("telegram.webhook.register", async () => {
    const config = await getTelegramConfig();
    const token = decryptSecret(config.botTokenEncrypted);
    if (!token) return fail("Save a bot token first.", 400);

    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : null);

    if (!base) {
      return fail(
        "Could not work out this deployment's public URL. Set NEXT_PUBLIC_APP_URL and try again.",
        400,
      );
    }

    const url = `${base}/api/telegram/webhook`;
    try {
      await setWebhook(token, url, {
        allowedUpdates: ["message", "edited_message", "channel_post"],
      });
      await updateTelegramConfig({
        webhookUrl: url,
        webhookLastError: null,
        lastCheckedAt: new Date(),
      });
      await logger.info({
        category: "TELEGRAM",
        event: "telegram.webhook_registered",
        message: `Webhook registered at ${url}`,
      });
      return ok({ registered: true, url });
    } catch (error) {
      const message = safeErrorMessage(error, "Telegram refused to register the webhook");
      await updateTelegramConfig({ webhookLastError: message, lastCheckedAt: new Date() });
      return ok({ registered: false, error: message });
    }
  });
}

export async function DELETE(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("telegram.webhook.remove", async () => {
    const config = await getTelegramConfig();
    const token = decryptSecret(config.botTokenEncrypted);
    if (!token) return fail("No bot token is saved yet.", 400);

    try {
      await deleteWebhook(token, true);
      await updateTelegramConfig({ webhookUrl: null, lastCheckedAt: new Date() });
      await logger.warn({
        category: "TELEGRAM",
        event: "telegram.webhook_removed",
        message: "Webhook removed and pending updates dropped",
      });
      return ok({ removed: true });
    } catch (error) {
      return ok({ removed: false, error: safeErrorMessage(error, "Telegram refused to remove the webhook") });
    }
  });
}
