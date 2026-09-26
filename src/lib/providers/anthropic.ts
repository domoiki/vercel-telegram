import "server-only";

import { safeErrorMessage } from "@/lib/sanitize";
import {
  extractProviderError,
  joinUrl,
  mergeHeaders,
  readOpenAiText,
  TEST_PROMPT,
  timedFetch,
} from "./http";
import {
  ProviderError,
  classifyHttpStatus,
  type CompletionRequest,
  type CompletionResult,
  type ProviderAdapter,
  type ProviderTestResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

/**
 * Anthropic Messages API.
 * System turns become the top-level `system` field; the rest is a flat list.
 */
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic Messages",
  hint: "Anthropic Claude models. Uses the x-api-key header and the system field.",
  supportsChat: true,

  async complete(config, request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model ?? config.model;
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const temperature = request.temperature ?? config.temperature;
    const maxTokens = request.maxTokens ?? config.maxTokens ?? 4096;

    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    if (messages.length === 0) {
      throw new ProviderError("No user or assistant turns to send", {
        category: "bad_request",
        fallbackWorthy: false,
      });
    }

    const response = await timedFetch(
      joinUrl(baseUrl, "messages"),
      {
        method: "POST",
        headers: mergeHeaders(config, {
          "anthropic-version": API_VERSION,
          ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
        }),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          ...(temperature !== null && temperature !== undefined ? { temperature } : {}),
          messages,
        }),
      },
      request.timeoutMs ?? config.timeoutMs,
      request.signal,
    );

    if (!response.ok) {
      const { category, fallbackWorthy } = classifyHttpStatus(response.status);
      throw new ProviderError(
        extractProviderError(response.body, response.rawText, response.status),
        { category, httpStatus: response.status, fallbackWorthy },
      );
    }

    const body = response.body as {
      content?: Array<{ type?: string; text?: string }>;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    } | null;

    const text = readOpenAiText(body);
    if (!text) {
      throw new ProviderError("Anthropic returned an empty completion", {
        category: "unknown",
        httpStatus: response.status,
        fallbackWorthy: true,
      });
    }

    const promptTokens = body?.usage?.input_tokens ?? null;
    const completionTokens = body?.usage?.output_tokens ?? null;
    return {
      text,
      model: body?.model ?? model,
      httpStatus: response.status,
      durationMs: response.durationMs,
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens !== null && completionTokens !== null
          ? promptTokens + completionTokens
          : null,
    };
  },

  async test(config): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    try {
      const response = await timedFetch(
        joinUrl(baseUrl, "messages"),
        {
          method: "POST",
          headers: mergeHeaders(config, {
            "anthropic-version": API_VERSION,
            ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
          }),
          body: JSON.stringify({
            model: config.model,
            max_tokens: 16,
            temperature: 0,
            messages: [{ role: "user", content: TEST_PROMPT[0]?.content ?? "ping" }],
          }),
        },
        Math.min(config.timeoutMs, 20_000),
      );

      const durationMs = response.durationMs || Date.now() - startedAt;
      if (!response.ok) {
        return {
          ok: false,
          httpStatus: response.status,
          durationMs,
          errorMessage: extractProviderError(response.body, response.rawText, response.status),
          errorCategory: classifyHttpStatus(response.status).category,
          model: config.model,
          sample: null,
        };
      }
      return {
        ok: true,
        httpStatus: response.status,
        durationMs,
        errorMessage: null,
        errorCategory: null,
        model: (response.body as { model?: string } | null)?.model ?? config.model,
        sample: readOpenAiText(response.body) || null,
      };
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(safeErrorMessage(error), { category: "unknown" });
      return {
        ok: false,
        httpStatus: providerError.httpStatus,
        durationMs: Date.now() - startedAt,
        errorMessage: providerError.message,
        errorCategory: providerError.category,
        model: config.model,
        sample: null,
      };
    }
  },
};
