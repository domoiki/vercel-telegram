import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAiCompatibleAdapter } from "./http";

/**
 * Reasoning models (Nemotron 3, DeepSeek-R1, QwQ, the o-series) answer in two
 * channels: `content` for the user and `reasoning_content` for the chain of
 * thought. They changed what "connected" and "answered" have to mean.
 */

const baseConfig = {
  id: "p1",
  name: "NVIDIA",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  apiKey: "nvapi-test",
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  adapter: "openai-compatible" as const,
  temperature: null,
  maxTokens: 16384,
  timeoutMs: 45_000,
  customHeaders: {},
};

/** `timedFetch` calls the real fetch, so the mock has to look like a Response. */
function completion(overrides: Record<string, unknown> = {}) {
  const body = {
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    choices: [
      {
        message: { content: "online" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 23, completion_tokens: 14, total_tokens: 37 },
    ...overrides,
  };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("openai-compatible adapter · test()", () => {
  it("reports a healthy connection for a thinking model that answered", async () => {
    fetchMock.mockResolvedValue(completion());

    const result = await openAiCompatibleAdapter.test(baseConfig);

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.sample).toBe("online");
  });

  it("leaves room for the model to think before answering", async () => {
    fetchMock.mockResolvedValue(completion());

    await openAiCompatibleAdapter.test(baseConfig);

    // 16 left a reasoning model no room to finish: it returned
    // finish_reason "length" with a fragment of its own thoughts, which is
    // indistinguishable from a broken endpoint.
    expect(sentBody().max_tokens).toBe(256);
  });

  it("still counts as connected when the answer came back as reasoning", async () => {
    fetchMock.mockResolvedValue(
      completion({
        choices: [
          {
            message: { content: "", reasoning_content: "The user asks for one word…" },
            finish_reason: "stop",
          },
        ],
      }),
    );

    const result = await openAiCompatibleAdapter.test(baseConfig);

    expect(result.ok).toBe(true);
    expect(result.sample).toBe("The user asks for one word…");
  });
});

describe("openai-compatible adapter · complete()", () => {
  const request = { messages: [{ role: "user" as const, content: "hi" }] };

  it("never sends the chain of thought to Telegram", async () => {
    fetchMock.mockResolvedValue(
      completion({
        choices: [
          {
            message: { content: "The answer is 42.", reasoning_content: "SECRET CHAIN OF THOUGHT" },
            finish_reason: "stop",
          },
        ],
      }),
    );

    const result = await openAiCompatibleAdapter.complete(baseConfig, request);

    expect(result.text).toBe("The answer is 42.");
    expect(result.text).not.toContain("SECRET CHAIN OF THOUGHT");
  });

  it("points at the token budget when a model ran out while reasoning", async () => {
    fetchMock.mockResolvedValue(
      completion({
        choices: [
          { message: { content: "", reasoning_content: "still thinking…" }, finish_reason: "length" },
        ],
      }),
    );

    await expect(openAiCompatibleAdapter.complete(baseConfig, request)).rejects.toThrow(
      /ran out of tokens while reasoning/,
    );
  });

  it("treats a fully empty response as fallback-worthy", async () => {
    fetchMock.mockResolvedValue(
      completion({
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      }),
    );

    await expect(openAiCompatibleAdapter.complete(baseConfig, request)).rejects.toMatchObject({
      category: "unknown",
    });
  });
});
