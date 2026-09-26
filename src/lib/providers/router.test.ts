import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProviderError,
  type CompletionResult,
  type ProviderConfig,
  type ProviderAdapter,
} from "./types";
import { classifyHttpStatus } from "./http";

// --- the router's collaborators are replaced; the routing logic is the subject --
const getProviderChain = vi.fn<() => Promise<ChainRow[]>>();
const persistAttempt = vi.fn<(row: unknown) => Promise<void>>();
const trace = vi.fn();

vi.mock("./service", () => ({
  getProviderChain: () => getProviderChain(),
  toProviderConfig: (row: ChainRow): ProviderConfig => ({
    id: row.id,
    name: row.name,
    baseUrl: "https://example.invalid/v1",
    apiKey: "key",
    model: row.model,
    adapter: "openai-compatible",
    customHeaders: {},
    timeoutMs: 1_000,
    temperature: null,
    maxTokens: null,
  }),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({ values: async (row: unknown) => persistAttempt(row) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: {
    requestAttempts: {},
    aiRequests: { id: {} },
  },
}));

vi.mock("@/lib/trace", () => ({ trace: (...args: unknown[]) => trace(...args) }));
vi.mock("@/lib/ids", () => ({ newId: () => "attempt-id" }));

const { executeWithFallback } = await import("./router");

type ChainRow = {
  id: string;
  name: string;
  model: string;
  adapter: string;
  priority: number;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
};

function row(overrides: Partial<ChainRow> & { id: string; name: string }): ChainRow {
  return {
    model: "test-model",
    adapter: "openai-compatible",
    priority: 1,
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    ...overrides,
  };
}

/** An adapter whose every call replays a scripted list of outcomes. */
function scriptedAdapter(script: Array<() => Promise<CompletionResult>>) {
  const calls: string[] = [];
  let index = 0;
  const adapter: ProviderAdapter = {
    id: "openai-compatible",
    label: "Test",
    hint: "",
    supportsChat: true,
    async complete() {
      calls.push(String(index));
      const next = script[Math.min(index, script.length - 1)] as () => Promise<CompletionResult>;
      index += 1;
      return next();
    },
    async test() {
      throw new Error("not used");
    },
  };
  return { adapter, calls };
}

const ok = (text: string) => async () => ({
  text,
  model: "test-model",
  httpStatus: 200,
  durationMs: 120,
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
});

const failing = (
  message: string,
  options: { category: ConstructorParameters<typeof ProviderError>[1]["category"]; fallbackWorthy?: boolean; httpStatus?: number },
) => async () => {
  throw new ProviderError(message, options);
};

const baseOptions = { requestId: "req-1", messages: [{ role: "user" as const, content: "hi" }] };

beforeEach(() => {
  vi.clearAllMocks();
  getProviderChain.mockResolvedValue([]);
});

describe("executeWithFallback", () => {
  it("fails cleanly when no provider is enabled", async () => {
    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCategory).toBe("config");
    expect(result.attempts).toHaveLength(0);
  });

  it("returns the first provider's answer with no fallback", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter, calls } = scriptedAdapter([ok("first answer")]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("first answer");
    expect(result.providerId).toBe("p1");
    expect(result.fallbackCount).toBe(0);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.attemptNumber).toBe(1);
    expect(result.attempts[0]?.outcome).toBe("success");
    expect(calls).toHaveLength(1);
  });

  it("retries the same provider in place on a 429", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter, calls } = scriptedAdapter([
      failing("HTTP 429: slow down", { category: "rate_limit", httpStatus: 429 }),
      ok("recovered"),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("recovered");
    expect(result.fallbackCount).toBe(0);
    // Both attempts hit p1 — a retry, not a fallback.
    expect(result.attempts.map((a) => a.providerId)).toEqual(["p1", "p1"]);
    expect(result.attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(result.attempts[0]?.outcome).toBe("error");
    expect(result.attempts[0]?.errorCategory).toBe("rate_limit");
    expect(calls).toHaveLength(2);
  });

  it("gives up on a provider after the retry budget is spent", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter, calls } = scriptedAdapter([
      failing("HTTP 503: unavailable", { category: "server_error", httpStatus: 503 }),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 1 initial try + 1 retry.
    expect(calls).toHaveLength(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.errorCategory).toBe("server_error");
  });

  it("does not retry a timeouts-limited provider more than the budget", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter, calls } = scriptedAdapter([
      failing("Request timed out", { category: "timeout" }),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    await executeWithFallback({ ...baseOptions, retryAttempts: 2 });
    expect(calls).toHaveLength(3);
  });

  it("falls back to the next provider without burning the retry budget", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "Primary", priority: 1 }),
      row({ id: "p2", name: "Backup", priority: 2 }),
    ]);
    const { adapter, calls } = scriptedAdapter([
      failing("HTTP 401: invalid api key", { category: "auth", httpStatus: 401 }),
      ok("from the backup"),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerId).toBe("p2");
    expect(result.providerName).toBe("Backup");
    expect(result.fallbackCount).toBe(1);
    // Auth failures are not retried in place: one call to p1, one to p2.
    expect(calls).toHaveLength(2);
    expect(result.attempts[0]?.providerId).toBe("p1");
    expect(result.attempts[1]?.providerId).toBe("p2");
  });

  it("walks the whole chain in priority order", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "A", priority: 1 }),
      row({ id: "p2", name: "B", priority: 2 }),
      row({ id: "p3", name: "C", priority: 3 }),
    ]);
    const { adapter } = scriptedAdapter([
      failing("HTTP 500", { category: "server_error", httpStatus: 500 }),
      failing("HTTP 500", { category: "server_error", httpStatus: 500 }),
      ok("finally"),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerId).toBe("p3");
    expect(result.fallbackCount).toBe(2);
    expect(result.attempts.map((a) => a.providerId)).toEqual(["p1", "p2", "p3"]);
    // Attempt numbers are global and strictly increasing.
    expect(result.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
  });

  it("stops the chain on a rejected request, without fallback", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "Primary" }),
      row({ id: "p2", name: "Backup" }),
    ]);
    const { adapter, calls } = scriptedAdapter([
      failing("HTTP 400: context length exceeded", {
        category: "bad_request",
        fallbackWorthy: false,
        httpStatus: 400,
      }),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCategory).toBe("bad_request");
    expect(result.fallbackCount).toBe(0);
    // The backup was never touched: a bad prompt fails on every provider.
    expect(calls).toHaveLength(1);
  });

  it("stops on a 404 misconfiguration rather than trying the backup", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "Primary" }),
      row({ id: "p2", name: "Backup" }),
    ]);
    const { adapter, calls } = scriptedAdapter([
      failing("HTTP 404: no such model", {
        category: "config",
        fallbackWorthy: false,
        httpStatus: 404,
      }),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCategory).toBe("config");
    expect(calls).toHaveLength(1);
  });

  it("treats an unrecognised thrown value as a fallback-worthy failure", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "Primary" }),
      row({ id: "p2", name: "Backup" }),
    ]);
    const { adapter } = scriptedAdapter([
      async () => {
        throw new Error("socket hang up");
      },
      ok("ok now"),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerId).toBe("p2");
    expect(result.attempts[0]?.errorCategory).toBe("unknown");
  });

  it("reports the last error when every provider fails", async () => {
    getProviderChain.mockResolvedValue([
      row({ id: "p1", name: "A" }),
      row({ id: "p2", name: "B" }),
    ]);
    const { adapter } = scriptedAdapter([
      failing("HTTP 429 from A", { category: "rate_limit", httpStatus: 429 }),
      failing("HTTP 503 from B", { category: "server_error", httpStatus: 503 }),
    ]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    const result = await executeWithFallback({ ...baseOptions, retryAttempts: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCategory).toBe("server_error");
    expect(result.errorMessage).toBe("HTTP 503 from B");
    expect(result.fallbackCount).toBe(1);
  });

  it("persists one row per attempt, successes included", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter } = scriptedAdapter([ok("done")]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    await executeWithFallback({ ...baseOptions, retryAttempts: 0 });
    expect(persistAttempt).toHaveBeenCalledTimes(1);
    expect(persistAttempt.mock.calls[0]?.[0]).toMatchObject({
      requestId: "req-1",
      providerId: "p1",
      outcome: "success",
      httpStatus: 200,
      attemptNumber: 1,
    });
  });

  it("never loses the user's question: every attempt is traced", async () => {
    getProviderChain.mockResolvedValue([row({ id: "p1", name: "Primary" })]);
    const { adapter } = scriptedAdapter([ok("hi")]);
    vi.spyOn(await import("./registry"), "getAdapter").mockReturnValue(adapter);

    await executeWithFallback({ ...baseOptions, retryAttempts: 0 });
    const events = trace.mock.calls.map((call) => (call[1] as { event: string }).event);
    expect(events).toContain("Provider selected");
    expect(events).toContain("AI response received");
  });
});

describe("classifyHttpStatus", () => {
  it.each([
    [408, "timeout", true],
    [429, "rate_limit", true],
    [401, "auth", true],
    [403, "auth", true],
    [500, "server_error", true],
    [502, "server_error", true],
    [503, "server_error", true],
    [599, "server_error", true],
  ])("treats %i as a %s worth falling back from", (status, category, worthy) => {
    expect(classifyHttpStatus(status as number)).toEqual({
      category,
      fallbackWorthy: worthy,
    });
  });

  it.each([
    [400, "bad_request"],
    [404, "config"],
    [422, "bad_request"],
  ])("treats %i as a %s that must not burn the chain", (status, category) => {
    expect(classifyHttpStatus(status as number).fallbackWorthy).toBe(false);
    expect(classifyHttpStatus(status as number).category).toBe(category);
  });

  it("does not mark a success as fallback-worthy", () => {
    expect(classifyHttpStatus(200).fallbackWorthy).toBe(false);
    expect(classifyHttpStatus(201).fallbackWorthy).toBe(false);
  });
});

describe("ProviderError", () => {
  it("defaults to fallback-worthy and carries its category", () => {
    const error = new ProviderError("boom", { category: "network" });
    expect(error).toBeInstanceOf(Error);
    expect(error.category).toBe("network");
    expect(error.fallbackWorthy).toBe(true);
    expect(error.httpStatus).toBeNull();
  });
});
