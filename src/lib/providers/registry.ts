import "server-only";

import { ADAPTER_IDS, isAdapterId, type AdapterId } from "./shared";
import { anthropicAdapter } from "./anthropic";
import { customHttpAdapter } from "./custom-http";
import { geminiAdapter } from "./gemini";
import { openAiCompatibleAdapter } from "./http";
import type { ProviderAdapter } from "./types";

const registry: Record<AdapterId, ProviderAdapter> = {
  "openai-compatible": openAiCompatibleAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  "custom-http": customHttpAdapter,
};

export function getAdapter(id: string): ProviderAdapter {
  return registry[id as AdapterId] ?? openAiCompatibleAdapter;
}

export function listAdapters(): Array<{ id: AdapterId; label: string; hint: string }> {
  return ADAPTER_IDS.map((id) => {
    const adapter = registry[id];
    return { id, label: adapter.label, hint: adapter.hint };
  });
}

export { isAdapterId };
