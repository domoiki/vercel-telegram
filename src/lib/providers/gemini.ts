import "server-only";

import { safeErrorMessage } from "@/lib/sanitize";
import { classifyHttpStatus, extractProviderError, joinUrl, mergeHeaders, timedFetch } from "./http";
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderTestResult,
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

function readGeminiText(body: unknown): string {
  const b = body as GeminiResponse | null;
  const parts = b?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

function buildContents(
  messages: CompletionRequest["messages"],
): { systemInstruction?: { parts: Array<{ text: string }> }; contents: Array<{ role: string; parts: Array<{ text: string }> }> } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
  };
}

async function request(
  config: ProviderConfig,
  model: string,
  messages: CompletionRequest["messages"],
  temperature: number | null,
  maxTokens: number | null,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const { systemInstruction, contents } = buildContents(messages);
  const url = `${joinUrl(baseUrl, `models/${model}:generateContent`)}`;

  return timedFetch(
    url,
    {
      method: "POST",
      headers: mergeHeaders(config, config.apiKey ? { "x-goog-api-key": config.apiKey } : {}),
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        generationConfig: {
          ...(temperature !== null && temperature !== undefined ? { temperature } : {}),
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
      }),
    },
    timeoutMs,
    signal,
  );
}

/** Google Gemini generateContent endpoint. */
export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  hint: "Google Generative Language API. Uses the x-goog-api-key header.",
  supportsChat: true,

  async complete(config, req: CompletionRequest): Promise<CompletionResult> {
    const model = req.model ?? config.model;
    const response = await request(
      config,
      model,
      req.messages,
      req.temperature ?? config.temperature,
      req.maxTokens ?? config.maxTokens,
      req.timeoutMs ?? config.timeoutMs,
      req.signal,
    );

    if (!response.ok) {
      const { category, fallbackWorthy } = classifyHttpStatus(response.status);
      throw new ProviderError(
        extractProviderError(response.body, response.rawText, response.status),
        { category, httpStatus: response.status, fallbackWorthy },
      );
    }

    const text = readGeminiText(response.body);
    if (!text) {
      throw new ProviderError("Gemini returned an empty completion", {
        category: "unknown",
        httpStatus: response.status,
        fallbackWorthy: true,
      });
    }

    const body = response.body as GeminiResponse | null;
    const promptTokens = body?.usageMetadata?.promptTokenCount ?? null;
    const completionTokens = body?.usageMetadata?.candidatesTokenCount ?? null;
    return {
      text,
      model: body?.modelVersion ?? model,
      httpStatus: response.status,
      durationMs: response.durationMs,
      promptTokens,
      completionTokens,
      totalTokens: body?.usageMetadata?.totalTokenCount ?? null,
    };
  },

  async test(config): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    try {
      const response = await request(
        config,
        config.model,
        [{ role: "user", content: "Reply with the single word: online" }],
        0,
        16,
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
        model: (response.body as GeminiResponse | null)?.modelVersion ?? config.model,
        sample: readGeminiText(response.body) || null,
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
