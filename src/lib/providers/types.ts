import "server-only";

import type { ErrorCategory } from "@/lib/db/schema";
import { ADAPTER_IDS, type AdapterId } from "./shared";

export { ADAPTER_IDS, type AdapterId };

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/** Everything an adapter needs, with the secret already decrypted server-side. */
export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  adapter: AdapterId;
  customHeaders: Record<string, string>;
  timeoutMs: number;
  temperature: number | null;
  maxTokens: number | null;
};

export type CompletionRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CompletionResult = {
  text: string;
  model: string;
  httpStatus: number;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export const ADAPTER_ID_LIST = ADAPTER_IDS;

/**
 * Failure classification drives the fallback engine.
 *
 * `fallbackWorthy` is the only thing the router reads: it must be true for
 * transient / infrastructure failures and false for a request the provider
 * genuinely rejected, so a bad prompt never burns the whole chain.
 */
export class ProviderError extends Error {
  readonly category: ErrorCategory;
  readonly httpStatus: number | null;
  readonly fallbackWorthy: boolean;

  constructor(
    message: string,
    options: {
      category: ErrorCategory;
      httpStatus?: number | null;
      fallbackWorthy?: boolean;
    },
  ) {
    super(message);
    this.name = "ProviderError";
    this.category = options.category;
    this.httpStatus = options.httpStatus ?? null;
    this.fallbackWorthy = options.fallbackWorthy ?? true;
  }
}

export function classifyHttpStatus(status: number): {
  category: ErrorCategory;
  fallbackWorthy: boolean;
} {
  if (status === 408) return { category: "timeout", fallbackWorthy: true };
  if (status === 429) return { category: "rate_limit", fallbackWorthy: true };
  if (status === 401 || status === 403) return { category: "auth", fallbackWorthy: true };
  if (status >= 500) return { category: "server_error", fallbackWorthy: true };
  if (status === 404) return { category: "config", fallbackWorthy: false };
  if (status >= 400) return { category: "bad_request", fallbackWorthy: false };
  return { category: "unknown", fallbackWorthy: false };
}

export type ProviderTestResult = {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  errorCategory: ErrorCategory | null;
  model: string;
  sample: string | null;
};

export interface ProviderAdapter {
  id: AdapterId;
  label: string;
  /** One line shown under the adapter picker. */
  hint: string;
  /** Chat-completions style endpoints. */
  supportsChat: true;
  complete(config: ProviderConfig, request: CompletionRequest): Promise<CompletionResult>;
  /** Real round trip used by the dashboard's Test Connection button. */
  test(config: ProviderConfig): Promise<ProviderTestResult>;
}
