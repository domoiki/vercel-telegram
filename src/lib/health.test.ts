import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: () => {
    throw new Error("not used in these tests");
  },
  schema: {},
}));

vi.mock("./providers/service", () => ({
  listProviderRows: async () => [],
}));

const rows: Array<Record<string, unknown>> = [];

vi.mock("./settings", () => ({
  getTelegramConfig: async () => rows[0],
}));

const { getSystemHealth } = await import("./health");

async function telegramHealthFor(webhookLastError: string | null, overrides: Record<string, unknown> = {}) {
  rows.length = 0;
  rows.push({
    botTokenEncrypted: "enc:token",
    chatId1: "555000111",
    chatId2: "",
    chatId3: "",
    webhookUrl: "https://example.com/api/telegram/webhook",
    webhookPendingCount: 0,
    webhookLastError,
    ...overrides,
  });
  return (await getSystemHealth()).telegram;
}

describe("Telegram health", () => {
  it("is healthy with a token and all three slots filled", async () => {
    const t = await telegramHealthFor(null, { chatId2: "2", chatId3: "3" });
    expect(t.state).toBe("ok");
    expect(t.detail).toBe("Bot connected");
  });

  it("warns when no chat id is allowlisted", async () => {
    const t = await telegramHealthFor(null, { chatId1: "" });
    expect(t.state).toBe("warn");
    expect(t.detail).toBe("No chat id allowlisted");
  });

  it("warns when only some slots are filled", async () => {
    const t = await telegramHealthFor(null);
    expect(t.state).toBe("warn");
    expect(t.detail).toBe("1 of 3 chat slots filled");
  });

  it("warns when no bot token is saved", async () => {
    const t = await telegramHealthFor(null, { botTokenEncrypted: null });
    expect(t.state).toBe("warn");
    expect(t.detail).toBe("No bot token saved");
  });
});

describe("webhook error classification", () => {
  it("downgrades a 5xx to a warning, because Telegram reached us", async () => {
    const t = await telegramHealthFor("Wrong response from the webhook: 500 Internal Server Error", {
      chatId2: "2",
      chatId3: "3",
    });
    expect(t.state).toBe("warn");
    expect(t.detail).toContain("HTTP 500");
    expect(t.detail).toContain("provider chain");
  });

  it("treats a 4xx as a real problem", async () => {
    const t = await telegramHealthFor("Wrong response from the webhook: 404 Not Found");
    expect(t.state).toBe("error");
  });

  it("treats a delivery-layer failure as a real problem", async () => {
    for (const message of [
      "TLS error",
      "Connection refused",
      "Web host is not valid",
      "Failed to resolve host",
    ]) {
      const t = await telegramHealthFor(message);
      expect(t.state, message).toBe("error");
      expect(t.detail).toBe(message);
    }
  });

  it("keeps a configuration problem visible even when the webhook reported a 5xx", async () => {
    const t = await telegramHealthFor("Wrong response from the webhook: 500 Internal Server Error", {
      chatId1: "",
    });
    // The 500 must not erase the fact that no chat is allowlisted.
    expect(t.detail).not.toBe("Bot connected");
    expect(t.state).not.toBe("ok");
  });
});
