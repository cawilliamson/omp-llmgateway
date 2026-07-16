import type { AuthStorage } from "@oh-my-pi/pi-coding-agent";

const PROVIDER_ID = "llmgateway";

/**
 * resolve the LLM Gateway API key through omp's auth handling.
 *
 * resolution order:
 * 1. runtime override (CLI --api-key)
 * 2. auth.json entry for "llmgateway"
 * 3. environment variable LLMGATEWAY_API_KEY
 */
export async function getLLMGatewayApiKey(
  authStorage: AuthStorage,
): Promise<string | undefined> {
  const key = await authStorage.getApiKey(PROVIDER_ID);
  return key ?? process.env.LLMGATEWAY_API_KEY;
}