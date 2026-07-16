# omp LLM Gateway Extension

An omp extension that adds [LLM Gateway](https://llmgateway.io) as a model provider, giving you access to 200+ chat models from OpenAI, Anthropic, Google, xAI, Mistral, DeepSeek, and many others through a single OpenAI-compatible API.

## installation

### get API key

sign up at [llmgateway.io](https://llmgateway.io) to get an API key.

### configure credentials

add your API key to the omp auth store (recommended):

```bash
omp auth-broker login llmgateway
```

or set an environment variable:

```bash
export LLMGATEWAY_API_KEY="your-api-key-here"
```

### install extension

install as an omp plugin:

```bash
omp plugin install git:github.com/cawilliamson/omp-llmgateway
```

or for local development:

```bash
omp -e ./src/extensions/provider/index.ts
```

## usage

select `llmgateway` as your provider and choose from available models:

```
/model llmgateway gpt-5
/model llmgateway claude-opus-4-8
/model llmgateway gemini-2.5-pro
/model llmgateway auto
```

the special `auto` model lets the gateway pick the best provider and model for each request based on the configured routing strategy.

## slash commands

- `/llmgateway:refresh` — refresh the model list from the live API
- `/llmgateway:settings` — configure routing, web search, base URL, and deactivated models
- `/llmgateway:login` — capture your LLM Gateway session cookie for DevPass usage tracking
- `/llmgateway:status` — show DevPass credit balance, usage, and poll diagnostics

## settings

configure with `/llmgateway:settings`:

| setting | values | default | description |
|---|---|---|---|
| `routing` | `auto`, `price`, `throughput`, `latency` | `auto` | provider routing strategy. note: coding (dev) plans only support `auto` and `price`. |
| `webSearch` | `enabled`, `disabled` | `disabled` | enable native web search for models that support it. |
| `baseUrl` | URL string | `https://api.llmgateway.io/v1` | API base URL for self-hosted instances. |
| `includeDeactivated` | `include`, `ignore` | `ignore` | show deactivated models (may stop working at any time). |

## model auto-population

models are seeded from a hardcoded snapshot (`src/extensions/provider/models/static.ts`) and refreshed from the live `/v1/models` API on each session start. use `/llmgateway:refresh` to manually trigger a refresh at any time.

## compat values

the extension sends all requests in standard OpenAI Chat Completions format. the LLM Gateway normalises everything server-side:

- `max_tokens` is used for all models (the gateway translates to `max_completion_tokens` for GPT-5/o-series internally)
- `developer` role is not used (`system` role is sent for all models)
- reasoning is controlled via top-level `reasoning_effort` (`none|minimal|low|medium|high|xhigh|max`)
- `reasoning_content` on assistant messages is not required (the gateway reconstructs it for upstreams that need it)
- prompt caching is managed by the gateway

## self-hosted instances

change the base URL in settings to point to your own LLM Gateway deployment:

```
/llmgateway:settings → Base URL → https://your-gateway.example.com/v1
```

restart omp after changing the URL.

## development

```bash
git clone https://github.com/cawilliamson/omp-llmgateway.git
cd omp-llmgateway
bun install
```

### commands

```bash
bun run typecheck   # TypeScript type check
bun run lint        # Biome lint
bun run format      # Biome format (auto-fix)
bun run test        # Vitest (includes live API drift check)
```

## links

- [LLM Gateway](https://llmgateway.io)
- [LLM Gateway Docs](https://docs.llmgateway.io)
- [LLM Gateway GitHub](https://github.com/theopenco/llmgateway)