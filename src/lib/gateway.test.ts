import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end behaviour of the webhook pipeline, with every I/O boundary
 * replaced by an in-memory fake. The point is to pin the contract the dashboard
 * and the fallback engine both depend on: idempotency, the allowlist, what gets
 * persisted, and what Telegram is told.
 */

// --- state the fakes share ---------------------------------------------------
const state = {
  updates: new Map<number, Record<string, unknown>>(),
  messages: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ chatId: string; text: string }>,
  trace: [] as Array<{ event: string; level: string }>,
  logged: [] as Array<{ event: string }>,
};

const config: {
  botTokenEncrypted: string | null;
  chatId1: string | null;
  chatId2: string | null;
  chatId3: string | null;
  replyToUnauthorized: boolean;
} = {
  botTokenEncrypted: "encrypted-token",
  chatId1: "555000111",
  chatId2: null,
  chatId3: null,
  replyToUnauthorized: false,
};

let routeResult: unknown = {
  ok: true,
  text: "the answer",
  providerId: "p1",
  providerName: "Primary",
  model: "test-model",
  httpStatus: 200,
  durationMs: 120,
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
  estimatedCost: null,
  attempts: [
    {
      attemptNumber: 1,
      providerId: "p1",
      providerName: "Primary",
      model: "test-model",
      outcome: "success",
      httpStatus: 200,
      durationMs: 120,
      errorCategory: null,
      errorMessage: null,
      promptTokens: 10,
      completionTokens: 20,
      startedAt: new Date(),
    },
  ],
  fallbackCount: 0,
};

let sendError: Error | null = null;

vi.mock("@/lib/db", async () => {
  // The real schema is safe to load — it only describes tables and never opens
  // a connection. Only `getDb` is faked.
  const schema = await import("./db/schema");
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        // The claim insert: inserting the same update_id twice must return
        // nothing the second time, which is what makes retries safe.
        onConflictDoNothing: () => ({
          returning: async () => {
            const id = row.updateId as number;
            if (state.updates.has(id)) return [];
            state.updates.set(id, { ...row });
            return [{ updateId: id }];
          },
        }),
        then: async (resolve: (v: unknown) => void) => resolve([row]),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          // The gateway always updates the row it just recorded, so applying
          // the patch to the most recent message of that table matches on id.
          if (table !== schema.messages) return;
          const last = state.messages[state.messages.length - 1];
          if (last) Object.assign(last, patch);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    delete: () => ({ where: async () => undefined }),
  };
  return { getDb: () => db, schema };
});

vi.mock("@/lib/settings", () => ({
  getTelegramConfig: async () => config,
  getSettings: async () => ({
    maxHistoryMessages: 20,
    temperature: 0.7,
    maxTokens: 4096,
    retryAttempts: 2,
    providerTimeoutMs: 30_000,
    defaultTheme: "system",
  }),
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: (value: string | null) => (value ? "123456:decrypted-token" : null),
  encryptSecret: (value: string) => value,
  maskSecret: (value: string | null) => (value ? "1234••••••pass" : null),
}));

vi.mock("@/lib/ids", () => {
  let n = 0;
  return {
    newId: () => `id-${(n += 1)}`,
    newCorrelationId: () => `CORR${n}`,
  };
});

vi.mock("@/lib/trace", () => ({
  trace: async (_id: string, entry: { event: string; level?: string }) => {
    state.trace.push({ event: entry.event, level: entry.level ?? "info" });
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: async (e: { event: string }) => state.logged.push(e),
    warn: async (e: { event: string }) => state.logged.push(e),
    error: async (e: { event: string }) => state.logged.push(e),
    debug: async () => undefined,
  },
}));

vi.mock("@/lib/providers/router", () => ({
  executeWithFallback: async () => routeResult,
  finalizeRequest: async (id: string, patch: Record<string, unknown>) => {
    const row = state.requests.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
  },
}));

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: async (_token: string, chatId: string, text: string) => {
    if (sendError) throw sendError;
    state.sent.push({ chatId, text });
    return [{ messageId: 777 }];
  },
  TelegramApiError: class TelegramApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TelegramApiError";
    }
  },
}));

vi.mock("@/lib/conversation", () => ({
  systemPrompt: () => "you are a helpful assistant",
  getOrCreateConversation: async (input: { chatId: string }) => ({
    id: `conv-${input.chatId}`,
    chatId: input.chatId,
  }),
  loadHistory: async () => [],
  recordMessage: async (input: Record<string, unknown>) => {
    const row = { id: `msg-${state.messages.length + 1}`, ...input };
    state.messages.push(row);
    return row as never;
  },
  bumpConversationCount: async () => undefined,
}));

const { processTelegramUpdate } = await import("./gateway");

function update(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1001,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: 555_000_111, type: "private" },
      from: { id: 900, first_name: "Dana", username: "dana" },
      text: "what is the status?",
    },
    ...overrides,
  };
}

const outcome = (result: unknown) => result as { status: string; reason?: string; requestId?: string };

beforeEach(() => {
  state.updates.clear();
  state.messages.length = 0;
  state.requests.length = 0;
  state.sent.length = 0;
  state.trace.length = 0;
  state.logged.length = 0;
  config.chatId1 = "555000111";
  config.chatId2 = null;
  config.chatId3 = null;
  config.replyToUnauthorized = false;
  config.botTokenEncrypted = "encrypted-token";
  sendError = null;
  routeResult = {
    ok: true,
    text: "the answer",
    providerId: "p1",
    providerName: "Primary",
    model: "test-model",
    httpStatus: 200,
    durationMs: 120,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCost: null,
    attempts: [
      {
        attemptNumber: 1,
        providerId: "p1",
        providerName: "Primary",
        model: "test-model",
        outcome: "success",
        httpStatus: 200,
        durationMs: 120,
        errorCategory: null,
        errorMessage: null,
        promptTokens: 10,
        completionTokens: 20,
        startedAt: new Date(),
      },
    ],
    fallbackCount: 0,
  };
});

describe("processTelegramUpdate — validation", () => {
  it("rejects a malformed update before touching anything else", async () => {
    const result = outcome(await processTelegramUpdate({ nope: true }));
    expect(result.status).toBe("invalid");
    expect(state.sent).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });
});

describe("processTelegramUpdate — idempotency", () => {
  it("processes the first occurrence of an update_id", async () => {
    const result = outcome(await processTelegramUpdate(update()));
    expect(result.status).toBe("processed");
    expect(state.sent).toHaveLength(1);
  });

  it("short-circuits a replayed update without answering twice", async () => {
    await processTelegramUpdate(update());
    const sendsAfterFirst = state.sent.length;
    const messagesAfterFirst = state.messages.length;

    const replay = outcome(await processTelegramUpdate(update()));

    expect(replay.status).toBe("duplicate");
    expect(state.sent).toHaveLength(sendsAfterFirst);
    expect(state.messages).toHaveLength(messagesAfterFirst);
  });

  it("treats a replay as a no-op even after many updates", async () => {
    await processTelegramUpdate(update());
    for (let i = 0; i < 3; i += 1) {
      const replay = outcome(await processTelegramUpdate(update()));
      expect(replay.status).toBe("duplicate");
    }
    expect(state.sent).toHaveLength(1);
  });
});

describe("processTelegramUpdate — chat allowlist", () => {
  it("rejects a chat that is not in the allowlist", async () => {
    const result = outcome(
      await processTelegramUpdate(
        update({ message: { ...update().message, chat: { id: 777_000_999, type: "private" } } }),
      ),
    );
    expect(result.status).toBe("unauthorized");
    expect(state.sent).toHaveLength(0);
  });

  it("does not reply to a rejected chat by default", async () => {
    await processTelegramUpdate(
      update({ message: { ...update().message, chat: { id: 777_000_999, type: "private" } } }),
    );
    expect(state.sent).toHaveLength(0);
    expect(state.logged.some((l) => l.event === "telegram.chat_unauthorized")).toBe(true);
  });

  it("explains itself to a rejected chat when that option is on", async () => {
    config.replyToUnauthorized = true;
    await processTelegramUpdate(
      update({ message: { ...update().message, chat: { id: 777_000_999, type: "private" } } }),
    );
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]?.text).toMatch(/not on the gateway allowlist/i);
  });

  it("accepts a chat matching any of the three slots", async () => {
    config.chatId2 = "-1001887442109";
    const result = outcome(
      await processTelegramUpdate(
        update({ message: { ...update().message, chat: { id: -100_188_744_2109, type: "group" } } }),
      ),
    );
    expect(result.status).toBe("processed");
  });
});

describe("processTelegramUpdate — persistence", () => {
  it("records both sides of the exchange", async () => {
    await processTelegramUpdate(update());
    const inbound = state.messages.filter((m) => m.direction === "inbound");
    const outbound = state.messages.filter((m) => m.direction === "outbound");

    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.text).toBe("what is the status?");
    expect(inbound[0]?.status).toBe("received");

    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.text).toBe("the answer");
    expect(outbound[0]?.providerId).toBe("p1");
    expect(outbound[0]?.status).toBe("delivered");
  });

  it("marks the outbound message delivered with the Telegram id", async () => {
    await processTelegramUpdate(update());
    const outbound = state.messages.find((m) => m.direction === "outbound");
    expect(outbound?.telegramMessageId).toBe(777);
  });

  it("leaves the bot token out of anything it stores", async () => {
    await processTelegramUpdate(update());
    const serialised = JSON.stringify(state.messages);
    expect(serialised).not.toContain("decrypted-token");
    expect(serialised).not.toContain("123456:");
  });
});

describe("processTelegramUpdate — provider failures", () => {
  beforeEach(() => {
    routeResult = {
      ok: false,
      attempts: [
        {
          attemptNumber: 1,
          providerId: "p1",
          providerName: "Primary",
          model: "test-model",
          outcome: "error",
          httpStatus: 503,
          durationMs: 300,
          errorCategory: "server_error",
          errorMessage: "HTTP 503: service unavailable",
          promptTokens: null,
          completionTokens: null,
          startedAt: new Date(),
        },
      ],
      fallbackCount: 1,
      errorCategory: "server_error",
      errorMessage: "Every configured provider failed.",
    };
  });

  it("tells the user instead of staying silent", async () => {
    const result = outcome(await processTelegramUpdate(update()));
    expect(result.status).toBe("failed");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]?.text).toMatch(/could not get a reply/i);
  });

  it("does not leak the provider's raw error to the chat", async () => {
    await processTelegramUpdate(update());
    expect(state.sent[0]?.text).not.toContain("service unavailable");
  });

  it("still persists the failure for the trace", async () => {
    await processTelegramUpdate(update());
    const outbound = state.messages.find((m) => m.direction === "outbound");
    expect(outbound?.errorCategory).toBe("server_error");
    expect(state.trace.some((t) => t.event === "AI request failed")).toBe(true);
  });
});

describe("processTelegramUpdate — Telegram delivery", () => {
  it("records a delivery failure without losing the answer", async () => {
    sendError = new Error("Bad Request: chat not found");
    const result = outcome(await processTelegramUpdate(update()));

    // The AI work still succeeded, so the request is not marked failed.
    expect(result.status).toBe("processed");
    const outbound = state.messages.find((m) => m.direction === "outbound");
    expect(outbound?.status).toBe("failed");
    expect(outbound?.errorCategory).toBe("telegram");
    expect(state.trace.some((t) => t.event === "Telegram delivery failed")).toBe(true);
  });

  it("does not throw when Telegram is unreachable", async () => {
    sendError = new Error("ETIMEDOUT");
    await expect(processTelegramUpdate(update())).resolves.toBeDefined();
  });
});

describe("processTelegramUpdate — local commands", () => {
  it("answers /start without spending a provider call", async () => {
    const result = outcome(
      await processTelegramUpdate(update({ message: { ...update().message, text: "/start" } })),
    );
    expect(result.status).toBe("processed");
    expect(result.reason).toBe("local command");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]?.text).toMatch(/Gateway online/i);
  });

  it("still records a /start exchange in the transcript", async () => {
    await processTelegramUpdate(update({ message: { ...update().message, text: "/start" } }));
    expect(state.messages.filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(state.messages.filter((m) => m.direction === "outbound")).toHaveLength(1);
  });
});

describe("processTelegramUpdate — trace timeline", () => {
  it("records the pipeline in the order a reader expects", async () => {
    await processTelegramUpdate(update());
    const events = state.trace.map((t) => t.event);
    expect(events).toEqual([
      "Webhook received",
      "Telegram update validated",
      "Chat authorized",
      "Conversation loaded",
      "Telegram sendMessage started",
      "Telegram delivery successful",
      "Request completed",
    ]);
  });
});
