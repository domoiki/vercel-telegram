import { assertAdminKey, fail, handle, ok, readJson } from "@/lib/api";
import { logger } from "@/lib/logger";
import { getSettings, setSetting } from "@/lib/settings";
import { settingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle("settings.get", async () => {
    return ok({ settings: await getSettings() });
  });
}

export async function PATCH(request: Request) {
  const denied = assertAdminKey(request);
  if (denied) return denied;

  return handle("settings.update", async () => {
    const parsed = settingsSchema.partial().safeParse(await readJson(request));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(
        first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid settings",
        422,
      );
    }

    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      await setSetting(key as Parameters<typeof setSetting>[0], String(value));
    }

    await logger.info({
      category: "API",
      event: "settings.updated",
      message: `Updated ${Object.keys(parsed.data).join(", ")}`,
    });

    return ok({ settings: await getSettings() });
  });
}
