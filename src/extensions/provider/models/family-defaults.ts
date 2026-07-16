import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/**
 * Default maxTokens per model family.
 *
 * the LLM Gateway /v1/models API does not expose per-model max output tokens,
 * so sensible family-level defaults are used. these can be overridden per-model
 * in overrides.ts.
 */
export const FAMILY_MAX_TOKENS: Record<string, number> = {
  alibaba: 16384,
  anthropic: 32000,
  bytedance: 32768,
  deepseek: 32768,
  glm: 32768,
  google: 32768,
  llmgateway: 32768,
  meta: 8192,
  minimax: 40960,
  mistral: 32768,
  moonshot: 32768,
  nvidia: 32768,
  openai: 16384,
  perplexity: 32768,
  xai: 32768,
  xiaomi: 32768,
};

/** fallback when a model's family is not in the map */
export const DEFAULT_MAX_TOKENS = 16384;

export function getMaxTokensForFamily(family?: string): number {
  if (!family) return DEFAULT_MAX_TOKENS;
  return FAMILY_MAX_TOKENS[family] ?? DEFAULT_MAX_TOKENS;
}