import type {
  LLMGatewayApiModel,
  LLMGatewayModelsResponse,
} from "../types/models-api";

const BASE_URL = "https://api.llmgateway.io/v1";
const FETCH_TIMEOUT_MS = 15_000;

function combineSignals(signal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

export type LLMGatewayModelsResult =
  | { success: true; data: LLMGatewayApiModel[] }
  | { success: false };

/**
 * Fetch the list of models from the LLM Gateway /v1/models endpoint.
 *
 * The endpoint is unauthenticated; an API key is not required but may be
 * passed for future authenticated endpoints or self-hosted instances that
 * require auth on the models list.
 */
export async function fetchModels(opts?: {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<LLMGatewayModelsResult> {
  const base = opts?.baseUrl ?? BASE_URL;
  const combined = combineSignals(opts?.signal);

  const headers: Record<string, string> = {
    "HTTP-Referer": "https://github.com/cawilliamson/pi-llmgateway",
    "X-Title": "pi-llmgateway",
  };

  if (opts?.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  try {
    const response = await fetch(`${base}/models?exclude_deprecated=true`, {
      headers,
      signal: combined,
    });

    if (!response.ok) {
      return { success: false };
    }

    const data: LLMGatewayModelsResponse = await response.json();
    return { success: true, data: data.data };
  } catch {
    return { success: false };
  }
}
