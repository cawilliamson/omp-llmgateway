import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@oh-my-pi/pi-coding-agent";
import {
  configLoader,
  emitConfigUpdated,
  LLMGATEWAY_CONFIG_UPDATED_EVENT,
  registerLLMGatewaySettings,
} from "../../config";
import { getLLMGatewayApiKey } from "../../lib/env";
import { fetchModels } from "../../lib/llmgateway-api";
import { normalizeContextOverflowError } from "./context-overflow";
import {
  buildModelsFromApi,
  getSeedModels,
  LLMGATEWAY_STATIC_MODELS,
  loadCachedModels,
  writeCachedModels,
} from "./models";
import { buildRoutingBodyFields, hasRoutingFields } from "./routing";
import { registerUsageTracking } from "./usage";

const PROVIDER_ID = "llmgateway";

function registerProvider(
  pi: ExtensionAPI,
  models: ProviderModelConfig[],
): void {
  const { baseUrl } = configLoader.getConfig();

  pi.registerProvider(PROVIDER_ID, {
    baseUrl,
    // resolve the key eagerly: omp treats a bare string as an env var name
    // while pi requires a "$" prefix, so no single declarative value works
    // on both. the "$" fallback keeps pi's own interpolation when the var
    // is unset at registration time.
    apiKey: process.env.LLMGATEWAY_API_KEY ?? "$LLMGATEWAY_API_KEY",
    api: "openai-completions",
    authHeader: true,
    headers: {
      "HTTP-Referer": "https://github.com/cawilliamson/pi-llmgateway",
      "X-Title": "pi-llmgateway",
      "x-source": "pi-agent",
    },
    models,
  });
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();

  // stale-while-revalidate seed: read the on-disk model cache so that models
  // from a previous session_start are available at load time (before the live
  // fetch). this prevents "no models match pattern" warnings on saved scoped
  // models when omp validates them during startup — before session_start fires.
  let liveModels: ProviderModelConfig[] = loadCachedModels();
  const seedModels = getSeedModels(liveModels, LLMGATEWAY_STATIC_MODELS);

  let modelsLoaded = false;
  let fetchAbort: AbortController | undefined;

  registerProvider(pi, seedModels);
  registerUsageTracking(pi);
  registerLLMGatewaySettings(pi);

  // /llmgateway:refresh — manually trigger model list refresh from the live API
  pi.registerCommand("llmgateway:refresh", {
    description: "refresh the LLM Gateway model list from the live API",
    handler: async (_args, ctx) => {
      ctx.ui.notify("fetching models from LLM Gateway…", "info");

      const { baseUrl, includeDeactivated } = configLoader.getConfig();
      const apiKey = process.env.LLMGATEWAY_API_KEY;

      const result = await fetchModels({ baseUrl, apiKey });

      if (result.success) {
        const fetched = buildModelsFromApi(result.data, includeDeactivated);
        const before = liveModels.length;
        liveModels = fetched;
        await writeCachedModels(fetched);
        registerProvider(pi, fetched);
        ctx.ui.notify(
          `LLM Gateway: refreshed ${fetched.length} models (was ${before})`,
          "info",
        );
      } else {
        ctx.ui.notify(
          "LLM Gateway: refresh failed — check your API key and network",
          "warning",
        );
      }
    },
  });

  // re-register when settings change (e.g. baseUrl, routing, webSearch).
  pi.events.on(LLMGATEWAY_CONFIG_UPDATED_EVENT, () => {
    registerProvider(pi, liveModels.length > 0 ? liveModels : seedModels);
  });

  pi.on("session_shutdown", () => {
    fetchAbort?.abort();
    fetchAbort = undefined;
  });

  // inject routing/web_search into the request body before it reaches the gateway
  pi.on("before_provider_request", async (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const { routing, webSearch } = configLoader.getConfig();
    const options = { routing, webSearch };

    if (!hasRoutingFields(options)) return;

    const extra = buildRoutingBodyFields(options);
    const payload = event.payload as Record<string, unknown>;

    return { ...payload, ...extra };
  });

  pi.on("message_end", (event, ctx) => {
    const overflowMessage = normalizeContextOverflowError(
      event.message,
      ctx.model?.provider,
    );
    if (!overflowMessage) return;
    return { message: overflowMessage };
  });

  pi.on("session_start", async (_event, ctx) => {
    const { baseUrl, includeDeactivated } = configLoader.getConfig();

    if (!modelsLoaded) {
      modelsLoaded = true;
      fetchAbort?.abort();
      fetchAbort = new AbortController();

      const apiKey = await getLLMGatewayApiKey(ctx.modelRegistry);
      const result = await fetchModels({
        baseUrl,
        apiKey,
        signal: fetchAbort.signal,
      });

      if (result.success && !fetchAbort.signal.aborted) {
        const fetched = buildModelsFromApi(result.data, includeDeactivated);
        liveModels = fetched;
        await writeCachedModels(fetched);
        registerProvider(pi, fetched);
        ctx.ui.notify(
          `LLM Gateway: loaded ${fetched.length} models`,
          "info",
        );
      }
    }
  });
}