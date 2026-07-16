/**
 * routing and web_search injection for LLM Gateway requests.
 *
 * the gateway reads `routing` and `web_search` as JSON body fields, not headers.
 * omp's before_provider_request event lets us modify the request payload before
 * it reaches the provider — we inject these fields there, which is cleaner than
 * the old fetch-patching approach and doesn't require a streamSimple override.
 */

export interface RoutingOptions {
  /** LLM Gateway routing strategy. "auto" uses the full weighted smart-routing score */
  routing?: "auto" | "price" | "throughput" | "latency";
  /** enable native web search for models that support it */
  webSearch?: boolean;
}

/** build the extra fields to inject into the request body */
export function buildRoutingBodyFields(
  options: RoutingOptions,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};

  if (options.routing && options.routing !== "auto") {
    extra.routing = options.routing;
  }
  if (options.webSearch) {
    extra.web_search = true;
  }

  return extra;
}

/** check if there are any routing fields to inject */
export function hasRoutingFields(options: RoutingOptions): boolean {
  return Object.keys(buildRoutingBodyFields(options)).length > 0;
}