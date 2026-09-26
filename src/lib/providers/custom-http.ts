import "server-only";

import { safeErrorMessage } from "@/lib/sanitize";
import { classifyHttpStatus, extractProviderError, mergeHeaders, timedFetch } from "./http";
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderTestResult,
} from "./types";
/** Extra, adapter-specific options carried on ProviderConfig. */
export type CustomHttpOptions = {
  bodyTemplate: Record<string, unknown> | null;
  responsePath: string | null;
};

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || current === undefined) return null;
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : null;
      continue;
    }
    if (typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function renderValue(
  value: unknown,
  vars: Record<string, string | number | null>,
): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
      const replacement = vars[key];
      return replacement === undefined || replacement === null ? match : String(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderValue(v, vars);
    }
    return out;
  }
  return value;
}

function transcript(messages: CompletionRequest["messages"]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System"}: ${m.content}`)
    .join("\n\n");
}

function buildVars(
  config: ProviderConfig,
  request: CompletionRequest,
): Record<string, string | number | null> {
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return {
    model: request.model ?? config.model,
    temperature: request.temperature ?? config.temperature,
    maxTokens: request.maxTokens ?? config.maxTokens,
    system,
    messages: transcript(request.messages),
    prompt: request.messages.filter((m) => m.role === "user").at(-1)?.content ?? "",
  };
}

const DEFAULT_PATH = "choices.0.message.content";

/**
 * Escape hatch for endpoints that are neither OpenAI-, Anthropic- nor
 * Gemini-shaped. The user supplies a request body template and a dot path to
 * the reply text; everything else behaves like the other adapters.
 */
export const customHttpAdapter: ProviderAdapter = {
  id: "custom-http",
  label: "Custom HTTP",
  hint: "Any JSON endpoint. Map the request with a body template and read the reply with a dot path.",
  supportsChat: true,

  async complete(config, request: CompletionRequest): Promise<CompletionResult> {
    const options: CustomHttpOptions = {
      bodyTemplate: (config as ProviderConfig & CustomHttpOptions).bodyTemplate ?? null,
      responsePath:
        (config as ProviderConfig & CustomHttpOptions).responsePath ?? DEFAULT_PATH,
    };

    const body = options.bodyTemplate
      ? renderValue(options.bodyTemplate, buildVars(config, request))
      : { model: config.model, prompt: buildVars(config, request).prompt };

    const response = await timedFetch(
      config.baseUrl,
      {
        method: "POST",
        headers: mergeHeaders(config, config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        body: JSON.stringify(body),
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

    const found = readPath(response.body, options.responsePath ?? DEFAULT_PATH);
    const text = typeof found === "string" ? found.trim() : "";
    if (!text) {
      throw new ProviderError(
        `No text at response path "${options.responsePath}". Check the path in the provider settings.`,
        { category: "config", httpStatus: response.status, fallbackWorthy: false },
      );
    }

    const usage = readPath(response.body, "usage") as
      | { prompt_tokens?: number; completion_tokens?: number }
      | null;

    return {
      text,
      model: config.model,
      httpStatus: response.status,
      durationMs: response.durationMs,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens:
        usage?.prompt_tokens !== undefined && usage?.completion_tokens !== undefined
          ? usage.prompt_tokens + usage.completion_tokens
          : null,
    };
  },

  async test(config): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    const probe: CompletionRequest = {
      messages: [{ role: "user", content: "Reply with the single word: online" }],
    };
    try {
      const result = await customHttpAdapter.complete(config, {
        ...probe,
        timeoutMs: Math.min(config.timeoutMs, 20_000),
        temperature: 0,
        maxTokens: 16,
      });
      return {
        ok: true,
        httpStatus: result.httpStatus,
        durationMs: result.durationMs || Date.now() - startedAt,
        errorMessage: null,
        errorCategory: null,
        model: result.model,
        sample: result.text,
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
