import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/**
 * Per-model or per-family overrides applied on top of the dynamically-mapped
 * provider config. Keys are model IDs. Add entries here when a specific model
 * requires non-default compat flags, a custom maxTokens, or a custom
 * thinkingLevelMap that can't be derived from the API response alone.
 *
 * Examples of when to add an override:
 *   - A model requires `requiresReasoningContentOnAssistantMessages: true`
 *   - A reasoning model needs a different thinkingLevelMap (e.g. only supports
 *     a subset of levels)
 *   - The API-reported context_length is wrong for a specific model
 */
export const MODEL_OVERRIDES: Partial<
  Record<string, Partial<ProviderModelConfig>>
> = {
  // Example (uncomment when needed):
  //
  // "some-model-id": {
  //   maxTokens: 65536,
  //   compat: {
  //     supportsDeveloperRole: false,
  //     maxTokensField: "max_tokens",
  //     requiresReasoningContentOnAssistantMessages: true,
  //   },
  // },
};

export function applyModelOverride(
  model: ProviderModelConfig,
  override: Partial<ProviderModelConfig>,
): ProviderModelConfig {
  const result: ProviderModelConfig = { ...model };

  if (override.name !== undefined) result.name = override.name;
  if (override.reasoning !== undefined) result.reasoning = override.reasoning;
  if (override.input !== undefined) result.input = override.input;
  if (override.thinkingLevelMap !== undefined) {
    result.thinkingLevelMap = override.thinkingLevelMap;
  }
  if (override.contextWindow !== undefined) {
    result.contextWindow = override.contextWindow;
  }
  if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;
  if (override.cost !== undefined) {
    result.cost = { ...model.cost, ...override.cost };
  }
  if (override.compat !== undefined) {
    result.compat = { ...model.compat, ...override.compat };
  }

  return result;
}
