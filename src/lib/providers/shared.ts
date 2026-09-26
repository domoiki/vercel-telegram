/**
 * Provider vocabulary shared by server and client.
 * Deliberately free of `server-only` and of any crypto/database import so the
 * dashboard's client components can use these types directly.
 */

export const ADAPTER_IDS = [
  "openai-compatible",
  "anthropic",
  "gemini",
  "custom-http",
] as const;

export type AdapterId = (typeof ADAPTER_IDS)[number];

/** What the browser is allowed to see about a provider. Never includes the key. */
export type ProviderSummary = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
  model: string;
  adapter: string;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  hasCustomHeaders: boolean;
  customHeaderNames: string[];
  customBodyTemplate: string | null;
  customResponsePath: string | null;
  temperature: number | null;
  maxTokens: number | null;
  timeoutMs: number;
  enabled: boolean;
  isPrimary: boolean;
  priority: number;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestHttpStatus: number | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isAdapterId(value: string): value is AdapterId {
  return (ADAPTER_IDS as readonly string[]).includes(value);
}
