const PROVIDER_ID = "llmgateway";

/** minimal structural slice of the host model registry across runtimes */
interface ModelRegistryLike {
  /** omp: auth storage with direct key lookup */
  authStorage?: {
    getApiKey(provider: string): Promise<string | null | undefined>;
  };
  /** pi: resolved provider auth (apiKey, headers, baseUrl, env) */
  getProviderAuth?(
    provider: string,
  ):
    | { auth?: { apiKey?: string } }
    | undefined
    | Promise<{ auth?: { apiKey?: string } } | undefined>;
}

/**
 * resolve the LLM Gateway API key through the host's auth handling.
 *
 * omp exposes ctx.modelRegistry.authStorage; pi exposes
 * ctx.modelRegistry.getProviderAuth instead. detect whichever is present.
 *
 * resolution order:
 * 1. host auth store (omp authStorage / pi provider auth)
 * 2. environment variable LLMGATEWAY_API_KEY
 */
export async function getLLMGatewayApiKey(
  modelRegistry: ModelRegistryLike,
): Promise<string | undefined> {
  if (modelRegistry.authStorage) {
    const key = await modelRegistry.authStorage.getApiKey(PROVIDER_ID);
    return key ?? process.env.LLMGATEWAY_API_KEY;
  }
  if (modelRegistry.getProviderAuth) {
    const result = await modelRegistry.getProviderAuth(PROVIDER_ID);
    const key = result?.auth?.apiKey;
    // pi leaves unresolved "$VAR" references in place when the env var is
    // missing — treat those as absent and fall through to the env lookup
    if (key && !key.startsWith("$")) return key;
  }
  return process.env.LLMGATEWAY_API_KEY;
}
