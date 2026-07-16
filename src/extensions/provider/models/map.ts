import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type { LLMGatewayApiModel } from "../../../types/models-api";
import { getMaxTokensForFamily } from "./family-defaults";
import { applyModelOverride, MODEL_OVERRIDES } from "./overrides";

/**
 * Parse a per-token pricing decimal string (e.g. "1.5e-6") into a
 * per-million-token cost number. Returns 0 for missing or zero values.
 */
function parsePerMillionCost(value: string | undefined): number {
  if (!value || value === "0") return 0;
  const raw = Number.parseFloat(value);
  if (!Number.isFinite(raw)) return 0;
  return raw * 1_000_000;
}

/**
 * Returns true if any provider mapping for this model advertises reasoning
 * support, or if "reasoning" appears in supported_parameters.
 */
function modelSupportsReasoning(m: LLMGatewayApiModel): boolean {
  const sp = m.supported_parameters ?? [];
  if (sp.includes("reasoning") || sp.includes("reasoning_effort")) return true;
  return m.providers.some((p) => p.reasoning === true);
}

/**
 * Derive the input modality array from the model's architecture.
 * The gateway only surfaces "text" and "image" as meaningful chat inputs.
 */
function deriveInput(m: LLMGatewayApiModel): ("text" | "image")[] {
  const mods = m.architecture.input_modalities ?? [];
  const input: ("text" | "image")[] = ["text"];
  if (mods.includes("image")) input.push("image");
  return input;
}

/**
 * Models that the gateway exposes but that are not useful as chat providers
 * in Pi (non-text output, deactivated, or the catch-all "custom" placeholder).
 *
 * Filtering rules (applied before this function is called from buildModelsFromApi):
 *   - output_modalities must be ["text"] — only chat models
 *   - deactivated_at must be absent/null
 *   - id must not be "custom"
 */
export function isIncludedChatModel(
  m: LLMGatewayApiModel,
  includeDeactivated: boolean,
): boolean {
  if (m.id === "custom") return false;

  const outputs = m.architecture.output_modalities ?? [];
  if (!outputs.includes("text")) return false;

  if (!includeDeactivated && m.deactivated_at) return false;

  return true;
}

/**
 * Convert a raw LLM Gateway API model entry into Pi's ProviderModelConfig
 * format, applying family-level maxTokens defaults and any per-model overrides.
 */
export function toProviderModelConfig(
  m: LLMGatewayApiModel,
): ProviderModelConfig {
  const reasoning = modelSupportsReasoning(m);
  const input = deriveInput(m);
  const p = m.pricing;

  const cost = {
    input: parsePerMillionCost(p.prompt),
    output: parsePerMillionCost(p.completion),
    cacheRead: parsePerMillionCost(p.input_cache_read),
    cacheWrite: parsePerMillionCost(p.input_cache_write),
  };

  // The "auto" meta-model has context_length: 0 (unknown at routing time).
  // Use a generous placeholder so Pi doesn't reject it as invalid.
  const contextWindow = m.context_length > 0 ? m.context_length : 131_072;

  const maxTokens = getMaxTokensForFamily(m.family);

  const model: ProviderModelConfig = {
    id: m.id,
    name: m.name,
    reasoning,
    input,
    cost,
    contextWindow,
    maxTokens,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  };

  if (reasoning) {
    model.thinkingLevelMap = {
      minimal: null,
      low: null,
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
    };
  }

  const override = MODEL_OVERRIDES[m.id];
  if (override) {
    return applyModelOverride(model, override);
  }

  return model;
}
