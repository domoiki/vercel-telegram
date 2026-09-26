import "server-only";

import { safeErrorMessage } from "@/lib/sanitize";
import {
  ProviderError,
  classifyHttpStatus,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type ProviderConfig,
  type ProviderTestResult,
  type ProviderAdapter,
} from "./types";

export type FetchResult = {  status: number;
  ok: boolean;
  body: unknown;
  rawText: string;
  durationMs: number;
};

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${trimmed}/${suffix}`;
}

/** Single place where every provider HTTP call goes through. */
export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const rawText = await response.text();
    let body: unknown = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = null;
    }
    return {
      status: response.status,
      ok: response.ok,
      body,
      rawText,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (controller.signal.aborted) {
      const reason = externalSignal?.aborted ? "cancelled" : "timeout";
      throw new ProviderError(
        reason === "timeout"
          ? `Request timed out after ${timeoutMs}ms`
          : "Request cancelled",
        { category: "timeout", fallbackWorthy: true },
      );
    }
    throw new ProviderError(
      `Network failure after ${durationMs}ms: ${safeErrorMessage(error, "could not reach the provider")}`,
      { category: "network", fallbackWorthy: true },
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Pulls a short, safe message out of whatever shape the provider returned. */
export function extractProviderError(body: unknown, rawText: string, status: number): string {
  const b = body as
    | {
        error?: string | { message?: string; type?: string; code?: string };
        message?: string;
        detail?: string;
      }
    | null;

  const detail =
    (typeof b?.error === "string" ? b.error : b?.error?.message) ??
    b?.message ??
    b?.detail ??
    (rawText ? rawText.slice(0, 200) : `HTTP ${status}`);

  return detail.replace(/\s+/g, " ").trim().slice(0, 300);
}

export function throwForResponse(
  response: FetchResult,
  body: unknown,
): never {
  const { category, fallbackWorthy } = classifyHttpStatus(response.status);
  throw new ProviderError(extractProviderError(body, response.rawText, response.status), {
    category,
    httpStatus: response.status,
    fallbackWorthy,
  });
}

function mergeHeaders(
  config: ProviderConfig,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...lowerKeys(config.customHeaders),
    ...lowerKeys(extra),
  };
}

function lowerKeys(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) out[k.toLowerCase()] = v;
  return out;
}

type OpenAiResponse = {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    text?: string;
    finish_reason?: string;
  }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  content?: Array<{ type?: string; text?: string }>;
};

/**
 * @param allowReasoning - Reasoning models (Nemotron 3, DeepSeek-R1, QwQ, the
 * o-series) return their visible answer in `content` and their chain of thought
 * in `reasoning_content`. A reply path must never send the reasoning to
 * Telegram, so this stays off by default. The connectivity test turns it on,
 * because a provider that answered *at all* is connected, even when the budget
 * was too small for it to finish thinking out loud.
 */
function readOpenAiText(body: unknown, allowReasoning = false): string {
  const b = body as OpenAiResponse | null;
  const choice = b?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (Array.isArray(b?.content)) {
    const joined = b.content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (allowReasoning) {
    const reasoning = choice?.message?.reasoning_content;
    if (typeof reasoning === "string" && reasoning.trim()) return reasoning.trim();
  }
  return "";
}

function readTokens(body: unknown): {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
} {
  const b = body as OpenAiResponse | null;
  const promptTokens = b?.usage?.prompt_tokens ?? null;
  const completionTokens = b?.usage?.completion_tokens ?? null;
  const totalTokens = b?.usage?.total_tokens ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);
  return { promptTokens, completionTokens, totalTokens };
}

const TEST_PROMPT: ChatMessage[] = [
  { role: "user", content: "Reply with the single word: online" },
];

export const openAiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI compatible",
  hint: "Any /chat/completions endpoint: OpenAI, Groq, Together, Ollama, LM Studio, vLLM.",
  supportsChat: true,

  async complete(config, request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model ?? config.model;
    const temperature = request.temperature ?? config.temperature;
    const maxTokens = request.maxTokens ?? config.maxTokens;

    const headers = mergeHeaders(config, {
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    });

    const response = await timedFetch(
      joinUrl(config.baseUrl, "chat/completions"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: request.messages,
          ...(temperature !== null && temperature !== undefined
            ? { temperature }
            : {}),
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          stream: false,
        }),
      },
      request.timeoutMs ?? config.timeoutMs,
      request.signal,
    );

    if (!response.ok) throwForResponse(response, response.body);

    const text = readOpenAiText(response.body);
    if (!text) {
      // Worth saying what to do: a reasoning model that exhausted its budget
      // before producing a visible answer is the usual cause, and the fix is a
      // bigger token budget on this provider rather than a retry.
      const finish = (response.body as OpenAiResponse | null)?.choices?.[0]?.finish_reason;
      const detail =
        finish === "length"
          ? "Provider returned an empty completion (ran out of tokens while reasoning) — raise this provider's max tokens"
          : "Provider returned an empty completion";
      throw new ProviderError(detail, {
        category: finish === "length" ? "config" : "unknown",
        httpStatus: response.status,
        fallbackWorthy: true,
      });
    }

    const tokens = readTokens(response.body);
    return {
      text,
      model: (response.body as OpenAiResponse | null)?.model ?? model,
      httpStatus: response.status,
      durationMs: response.durationMs,
      ...tokens,
    };
  },

  async test(config): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    const model = config.model;
    const headers = mergeHeaders(config, {
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    });

    try {
      const response = await timedFetch(
        joinUrl(config.baseUrl, "chat/completions"),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: TEST_PROMPT,
            // Reasoning models spend this budget thinking before they answer.
            // The old value of 16 left no room at all: the model returned
            // `finish_reason: "length"` with only a fragment of its own
            // reasoning, which reads as a broken connection rather than a
            // working one. 256 is enough for a one-word answer to land.
            max_tokens: 256,
            temperature: 0,
            stream: false,
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
          model,
          sample: null,
        };
      }

      return {
        ok: true,
        httpStatus: response.status,
        durationMs,
        errorMessage: null,
        errorCategory: null,
        model: (response.body as OpenAiResponse | null)?.model ?? model,
        // A reasoning model that ran out of budget still proves the endpoint,
        // the key and the model name are all correct.
        sample: readOpenAiText(response.body, true) || null,
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
        model,
        sample: null,
      };
    }
  },
};

export { joinUrl, mergeHeaders, readTokens, readOpenAiText, TEST_PROMPT, classifyHttpStatus };
