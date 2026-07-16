import { describe, expect, it } from "vitest";
import type { LLMGatewayApiModel } from "../../types/models-api";
import { buildModelsFromApi } from "./models";
import { LLMGATEWAY_STATIC_MODELS } from "./models/static";

// ---------------------------------------------------------------------------
// Types mirroring the live API response (kept local to avoid coupling tests
// to the production type definitions, which may change independently).
// ---------------------------------------------------------------------------

interface ApiModel {
  id: string;
  name: string;
  aliases?: string[];
  created: number;
  description?: string;
  family?: string;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
  };
  top_provider: { is_moderated: boolean };
  providers: {
    providerId: string;
    externalId: string;
    pricing?: Record<string, string>;
    streaming?: boolean;
    vision?: boolean;
    cancellation?: boolean;
    tools?: boolean;
    parallelToolCalls?: boolean;
    reasoning?: boolean;
  }[];
  pricing: Record<string, string>;
  context_length: number;
  supported_parameters?: string[];
  json_output?: boolean;
  structured_outputs?: boolean;
  free?: boolean;
  deprecated_at?: string;
  deactivated_at?: string;
  stability?: string | null;
}

interface ApiResponse {
  data: ApiModel[];
}

interface Discrepancy {
  model: string;
  field: string;
  snapshot: unknown;
  api: unknown;
}

// ---------------------------------------------------------------------------
// Live API fetch
// ---------------------------------------------------------------------------

async function fetchLiveModels(): Promise<ApiModel[]> {
  const response = await fetch(
    "https://api.llmgateway.io/v1/models?exclude_deprecated=true",
    {
      headers: {
        "HTTP-Referer": "https://github.com/cawilliamson/omp-llmgateway",
        "X-Title": "omp-llmgateway",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data: ApiResponse = await response.json();
  return data.data;
}

/** Apply the same filter as buildModelsFromApi with includeDeactivated=false. */
function isChatModel(m: ApiModel): boolean {
  if (m.id === "custom") return false;
  const outputs = m.architecture.output_modalities ?? [];
  if (!outputs.includes("text")) return false;
  if (m.deactivated_at) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Snapshot vs live comparison
// ---------------------------------------------------------------------------

function compareSnapshot(
  liveModels: ApiModel[],
  snapshot: typeof LLMGATEWAY_STATIC_MODELS,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  const liveChat = liveModels.filter(isChatModel);
  const liveIds = new Set(liveChat.map((m) => m.id));
  const snapIds = new Set(snapshot.map((m) => m.id));

  // Models in snapshot not in live API
  for (const m of snapshot) {
    if (!liveIds.has(m.id)) {
      discrepancies.push({
        model: m.id,
        field: "exists",
        snapshot: true,
        api: false,
      });
    }
  }

  // Models in live API not in snapshot
  for (const m of liveChat) {
    if (!snapIds.has(m.id)) {
      discrepancies.push({
        model: m.id,
        field: "exists",
        snapshot: false,
        api: true,
      });
    }
  }

  // Per-model field drift for models present in both
  for (const snap of snapshot) {
    const live = liveChat.find((m) => m.id === snap.id);
    if (!live) continue;

    // context_length (skip auto model which has 0 context)
    const liveCtx = live.context_length > 0 ? live.context_length : 131_072;
    if (liveCtx !== snap.contextWindow) {
      discrepancies.push({
        model: snap.id,
        field: "contextWindow",
        snapshot: snap.contextWindow,
        api: liveCtx,
      });
    }

    // reasoning capability
    const liveReasoning =
      (live.supported_parameters ?? []).includes("reasoning") ||
      (live.supported_parameters ?? []).includes("reasoning_effort") ||
      live.providers.some((p) => p.reasoning === true);
    if (liveReasoning !== snap.reasoning) {
      discrepancies.push({
        model: snap.id,
        field: "reasoning",
        snapshot: snap.reasoning,
        api: liveReasoning,
      });
    }

    // vision / image input
    const liveHasImage = live.architecture.input_modalities.includes("image");
    const snapHasImage = snap.input.includes("image");
    if (liveHasImage !== snapHasImage) {
      discrepancies.push({
        model: snap.id,
        field: "input (image)",
        snapshot: snapHasImage,
        api: liveHasImage,
      });
    }
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LLM Gateway static snapshot", () => {
  it("should have unique model IDs", () => {
    const ids = LLMGATEWAY_STATIC_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should include the 'auto' meta-model", () => {
    const ids = new Set(LLMGATEWAY_STATIC_MODELS.map((m) => m.id));
    expect(ids.has("auto")).toBe(true);
  });

  it("should not include the 'custom' meta-model", () => {
    const ids = new Set(LLMGATEWAY_STATIC_MODELS.map((m) => m.id));
    expect(ids.has("custom")).toBe(false);
  });

  it("should have no deactivated models", () => {
    // All models in the static snapshot should have been active at generation
    // time (the generator filters deactivated_at). The snapshot has no
    // deactivated_at field available, so we validate indirectly: if we
    // rebuild from the live API, none should be deactivated.
    // This is checked by the live-drift test below.
  });

  it("should have required fields for every model", () => {
    for (const model of LLMGATEWAY_STATIC_MODELS) {
      expect(model.id, "id").toBeTruthy();
      expect(model.name, `${model.id}.name`).toBeTruthy();
      expect(typeof model.reasoning, `${model.id}.reasoning`).toBe("boolean");
      expect(model.contextWindow, `${model.id}.contextWindow`).toBeGreaterThan(
        0,
      );
      expect(model.maxTokens, `${model.id}.maxTokens`).toBeGreaterThan(0);
      expect(model.cost.input, `${model.id}.cost.input`).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        model.cost.output,
        `${model.id}.cost.output`,
      ).toBeGreaterThanOrEqual(0);
      expect(model.input, `${model.id}.input`).toContain("text");

      // Compat invariants — cast to access OpenAICompletionsCompat fields
      const compat = model.compat as Record<string, unknown> | undefined;
      expect(
        compat?.supportsDeveloperRole,
        `${model.id}.compat.supportsDeveloperRole`,
      ).toBe(false);
      expect(compat?.maxTokensField, `${model.id}.compat.maxTokensField`).toBe(
        "max_tokens",
      );
    }
  });

  it("should have thinkingLevelMap for all reasoning models", () => {
    for (const model of LLMGATEWAY_STATIC_MODELS) {
      if (!model.reasoning) continue;
      expect(
        model.thinkingLevelMap,
        `${model.id}.thinkingLevelMap`,
      ).toBeDefined();
      expect(model.thinkingLevelMap).toHaveProperty("minimal");
      expect(model.thinkingLevelMap).toHaveProperty("low");
      expect(model.thinkingLevelMap).toHaveProperty("medium");
      expect(model.thinkingLevelMap).toHaveProperty("high");
      expect(model.thinkingLevelMap).toHaveProperty("xhigh");
    }
  });

  it("should match the live /v1/models API (snapshot drift check)", {
    timeout: 30_000,
  }, async () => {
    const liveModels = await fetchLiveModels();
    const discrepancies = compareSnapshot(liveModels, LLMGATEWAY_STATIC_MODELS);

    if (discrepancies.length > 0) {
      console.error("\nSnapshot discrepancies found:");
      console.error("==============================");
      for (const d of discrepancies) {
        if (d.field === "exists") {
          if (d.snapshot) {
            console.error(
              `  ${d.model}: in snapshot but MISSING from live API`,
            );
          } else {
            console.error(
              `  ${d.model}: in live API but NOT in snapshot (NEW — regenerate static.ts)`,
            );
          }
        } else {
          console.error(`  ${d.model}.${d.field}:`);
          console.error(`    snapshot: ${JSON.stringify(d.snapshot)}`);
          console.error(`    live api: ${JSON.stringify(d.api)}`);
        }
      }
      console.error("==============================\n");
      console.error(
        "Run the static snapshot generator to update src/extensions/provider/models/static.ts",
      );
    }

    expect(discrepancies).toHaveLength(0);
  });
});

describe("buildModelsFromApi", () => {
  it("should filter out non-chat models", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "2.5e-6", completion: "10.0e-6" },
        context_length: 128000,
        family: "openai",
      },
      {
        id: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["embedding"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "0.02e-6", completion: "0" },
        context_length: 8192,
        family: "openai",
      },
    ];

    const result = buildModelsFromApi(models);
    expect(result.map((m) => m.id)).toEqual(["gpt-4o"]);
  });

  it("should filter out deactivated models by default", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "active-model",
        name: "Active",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "1e-6", completion: "2e-6" },
        context_length: 128000,
        family: "openai",
      },
      {
        id: "deactivated-model",
        name: "Deactivated",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "1e-6", completion: "2e-6" },
        context_length: 128000,
        family: "openai",
        deactivated_at: "2025-01-01T00:00:00.000Z",
      },
    ];

    const result = buildModelsFromApi(models, false);
    expect(result.map((m) => m.id)).toEqual(["active-model"]);

    const withDeactivated = buildModelsFromApi(models, true);
    expect(withDeactivated.map((m) => m.id)).toEqual([
      "active-model",
      "deactivated-model",
    ]);
  });

  it("should filter out the 'custom' meta-model", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "custom",
        name: "Custom Model",
        created: 0,
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "0", completion: "0" },
        context_length: 0,
        family: "llmgateway",
      },
    ];

    const result = buildModelsFromApi(models);
    expect(result).toHaveLength(0);
  });

  it("should correctly parse pricing strings into per-million costs", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "test-model",
        name: "Test",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: {
          prompt: "3.0e-6",
          completion: "15.0e-6",
          input_cache_read: "0.3e-6",
          input_cache_write: "3.75e-6",
        },
        context_length: 200000,
        family: "anthropic",
      },
    ];

    const [model] = buildModelsFromApi(models);
    expect(model.cost.input).toBeCloseTo(3.0, 5);
    expect(model.cost.output).toBeCloseTo(15.0, 5);
    expect(model.cost.cacheRead).toBeCloseTo(0.3, 5);
    expect(model.cost.cacheWrite).toBeCloseTo(3.75, 5);
  });

  it("should detect reasoning from supported_parameters", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "reasoning-model",
        name: "Reasoner",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "1e-6", completion: "3e-6" },
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "reasoning"],
        family: "deepseek",
      },
      {
        id: "plain-model",
        name: "Plain",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "1e-6", completion: "3e-6" },
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens"],
        family: "openai",
      },
    ];

    const result = buildModelsFromApi(models);
    const reasoner = result.find((m) => m.id === "reasoning-model");
    const plain = result.find((m) => m.id === "plain-model");

    expect(reasoner?.reasoning).toBe(true);
    expect(reasoner?.thinkingLevelMap).toBeDefined();
    expect(plain?.reasoning).toBe(false);
    expect(plain?.thinkingLevelMap).toBeUndefined();
  });

  it("should set consistent compat for all models", () => {
    const models: LLMGatewayApiModel[] = [
      {
        id: "m1",
        name: "M1",
        created: 0,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
          tokenizer: "GPT",
        },
        top_provider: { is_moderated: true },
        providers: [],
        pricing: { prompt: "1e-6", completion: "2e-6" },
        context_length: 128000,
        family: "openai",
      },
    ];

    const [m] = buildModelsFromApi(models);
    const compat = m.compat as Record<string, unknown> | undefined;
    expect(compat?.supportsDeveloperRole).toBe(false);
    expect(compat?.maxTokensField).toBe("max_tokens");
  });
});
