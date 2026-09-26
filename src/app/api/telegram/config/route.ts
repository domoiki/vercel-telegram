import { assertAdminKey, fail, handle, ok, readJson } from "@/lib/api";
import { encryptSecret, maskSecret, decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { getTelegramConfig, updateTelegramConfig } from "@/lib/settings";
import { telegramConfigSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only ever returns masked values — the token itself never leaves the server. */
export async function GET() {
  return handle("telegram.config.get", async () => {
    const config = await getTelegramConfig();
    return ok({
      config: {
        hasBotToken: Boolean(config.botTokenEncrypted),
        botTokenMask: maskSecret(decryptSecret(config.botTokenEncrypted)),
        chatId1: config.chatId1 ?? "",
        chatId2: config.chatId2 ?? "",
        chatId3: config.chatId3 ?? "",
        replyToUnauthorized: config.replyToUnauthorized,
        botUsername: config.botUsername,
        botDisplayName: config.botDisplayName,
        webhookUrl: config.webhookUrl,
        webhookPendingCount: config.webhookPendingCount,
        webhookLastError: config.webhookLastError,
        lastCheckedAt: config.lastCheckedAt,
        updatedAt: config.updatedAt,
      },
    });
  });
}

export async function PATCH(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("telegram.config.update", async () => {
    const parsed = telegramConfigSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(
        first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid Telegram settings",
        422,
      );
    }
    const input = parsed.data;

    const patch: Parameters<typeof updateTelegramConfig>[0] = {};
    if (input.clearBotToken) patch.botTokenEncrypted = null;
    else if (input.botToken) patch.botTokenEncrypted = encryptSecret(input.botToken);
    if (input.chatId1 !== undefined) patch.chatId1 = input.chatId1 || null;
    if (input.chatId2 !== undefined) patch.chatId2 = input.chatId2 || null;
    if (input.chatId3 !== undefined) patch.chatId3 = input.chatId3 || null;
    if (input.replyToUnauthorized !== undefined) {
      patch.replyToUnauthorized = input.replyToUnauthorized;
    }

    await updateTelegramConfig(patch);
    await logger.info({
      category: "API",
      event: "telegram.config.updated",
      message: "Telegram configuration saved",
    });

    return ok({ saved: true });
  });
}
