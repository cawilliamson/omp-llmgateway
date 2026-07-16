import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type { LLMGatewayApiModel } from "../../../types/models-api";
import { isIncludedChatModel, toProviderModelConfig } from "./map";

export { loadCachedModels, writeCachedModels } from "./cache";
export { MODEL_OVERRIDES } from "./overrides";
export { LLMGATEWAY_STATIC_MODELS } from "./static";

/**
 * Convert a raw API model list into Pi ProviderModelConfig entries,
 * applying inclusion filtering and the override table.
 */
export function buildModelsFromApi(
  apiModels: LLMGatewayApiModel[],
  includeDeactivated = false,
): ProviderModelConfig[] {
  return apiModels
    .filter((m) => isIncludedChatModel(m, includeDeactivated))
    .map(toProviderModelConfig);
}

/**
 * Return the seed model list: the stale-while-revalidate cache when non-empty,
 * otherwise fall through to the compiled-in static snapshot.
 */
export function getSeedModels(
  cachedModels: ProviderModelConfig[],
  staticModels: ProviderModelConfig[],
): ProviderModelConfig[] {
  return cachedModels.length > 0 ? cachedModels : staticModels;
}
