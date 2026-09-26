import { assertAdminKey, fail, handle, ok } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { getTelegramConfig, updateTelegramConfig } from "@/lib/settings";
import { getMe } from "@/lib/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Calls getMe to prove the stored token works, and caches the bot identity. */
export async function POST(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("telegram.test", async () => {
    const config = await getTelegramConfig();
    const token = decryptSecret(config.botTokenEncrypted);
    if (!token) return fail("Save a bot token first.", 400);

    const startedAt = Date.now();
    try {
      const bot = await getMe(token);
      await updateTelegramConfig({
        botUsername: bot.username,
        botDisplayName: bot.first_name,
        lastCheckedAt: new Date(),
        webhookLastError: null,
      });
      await logger.info({
        category: "TELEGRAM",
        event: "telegram.test_ok",
        message: `Connected as @${bot.username}`,
        durationMs: Date.now() - startedAt,
      });
      return ok({
        ok: true,
        username: bot.username,
        firstName: bot.first_name,
        id: bot.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram rejected the token";
      await updateTelegramConfig({ lastCheckedAt: new Date(), webhookLastError: message });
      await logger.warn({
        category: "TELEGRAM",
        event: "telegram.test_failed",
        message,
        durationMs: Date.now() - startedAt,
      });
      return fail(`Telegram rejected the token: ${message}`, 200);
    }
  });
}
