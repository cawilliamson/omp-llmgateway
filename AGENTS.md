# omp-llmgateway

omp extension providing an LLM Gateway inference API provider.

## purpose

registers a `llmgateway` provider with omp that connects to [LLM Gateway](https://api.llmgateway.io/v1), an OpenAI-compatible inference API that routes to 200+ models from OpenAI, Anthropic, Google, xAI, Mistral, DeepSeek, and others.

## stack

TypeScript (strict mode), Biome, Vitest

## scripts

- `bun run typecheck` — type check
- `bun run lint` — lint
- `bun run format` — format code
- `bun run test` — run model validation tests (includes live API)

## structure

```
src/
  config.ts                                  # config schema, settings command, extension events
  lib/
    env.ts                                   # API key resolution (auth store -> env var)
    llmgateway-api.ts                        # /v1/models fetch with timeout/abort
  extensions/
    provider/
      index.ts                               # provider factory: registers provider + session lifecycle
      context-overflow.ts                    # normalise context-overflow errors for omp compaction
      routing.ts                             # routing/web_search body field builder
      usage.ts                               # DevPass credit tracking via dashboard API cookie → agent.db
      models/
        index.ts                             # re-exports + buildModelsFromApi + getSeedModels helpers
        static.ts                            # hardcoded model snapshot (zero-latency seed)
        map.ts                               # API model -> ProviderModelConfig converter
        family-defaults.ts                   # maxTokens defaults per model family
        overrides.ts                         # per-model compat/thinking overrides
        cache.ts                             # stale-while-revalidate disk cache for live model list
      models.test.ts                         # vitest: snapshot drift vs live API + unit tests
  types/
    models-api.ts                            # /v1/models response types (OpenRouter-style schema)
```

## provider configuration

- provider name: `llmgateway`
- base URL: `https://api.llmgateway.io/v1` (user-overridable for self-host)
- API: `openai-completions`
- auth: auth store entry for "llmgateway", fallback to `LLMGATEWAY_API_KEY` env var
- all models: `compat.supportsDeveloperRole: false`, `compat.maxTokensField: "max_tokens"`
- reasoning models: `reasoning: true`, pass-through `thinkingLevelMap`

## compat rationale

the LLM Gateway normalises upstream differences server-side:

- `max_tokens` → translated to `max_completion_tokens` for GPT-5/o-series by the gateway
- `developer` role → not supported; gateway uses `system` only
- `reasoning_effort` → gateway translates to each upstream's native format
- `reasoning_content` echoing → not required; gateway reconstructs for deepseek/moonshot
- prompt caching → gateway manages cache_control markers per-upstream

## routing / web_search injection

the gateway reads `routing` and `web_search` as JSON body fields. the `before_provider_request` event handler injects the configured fields into the `/chat/completions` request body before it reaches the gateway.

## model loading (stale-while-revalidate)

1. extension load (sync): read `${agentDir}/cache/llmgateway-models.json`; register provider with cached models. if cache is empty, fall back to the compiled-in `static.ts` snapshot. zero latency — omp's startup scoped-model validation sees models immediately.
2. `session_start`: fetch `/v1/models`, write result to cache, re-register provider with live list.
3. `/llmgateway:refresh`: manually trigger a model list refresh at any time.

## slash commands

- `/llmgateway:refresh` — refresh the model list from the live API
- `/llmgateway:login` — capture LLM Gateway session cookie for DevPass usage bars
- `/llmgateway:status` — show DevPass credit balance, usage, and poll diagnostics

## settings

`/llmgateway:settings` allows configuring:
- **routing** — provider routing strategy (`auto|price|throughput|latency`)
- **webSearch** — enable native web search
- **baseUrl** — API base URL for self-hosted instances
- **includeDeactivated** — show deactivated models