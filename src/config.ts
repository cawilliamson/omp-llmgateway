import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir } from "./lib/paths";

export const LLMGATEWAY_CONFIG_UPDATED_EVENT =
  "llmgateway:config:updated" as const;

export interface LLMGatewayConfigUpdatedPayload {
  config: ResolvedLLMGatewayConfig;
}

/** user-facing config schema (sparse — only set keys are persisted) */
export interface LLMGatewayConfig {
  /** override the base URL for self-hosted LLM Gateway instances */
  baseUrl?: string;
  /** provider routing strategy */
  routing?: "auto" | "price" | "throughput" | "latency";
  /** enable native web search for models that support it */
  webSearch?: boolean;
  /** include deactivated models in the model list */
  includeDeactivated?: boolean;
}

/** resolved config with all defaults applied */
export interface ResolvedLLMGatewayConfig {
  baseUrl: string;
  routing: "auto" | "price" | "throughput" | "latency";
  webSearch: boolean;
  includeDeactivated: boolean;
}

const DEFAULTS: ResolvedLLMGatewayConfig = {
  baseUrl: "https://api.llmgateway.io/v1",
  routing: "auto",
  webSearch: false,
  includeDeactivated: false,
};

const CONFIG_FILE = join(
  getAgentDir(),
  "cache",
  "llmgateway-config.json",
);

/** resolve sparse config with defaults */
function resolve(config: LLMGatewayConfig): ResolvedLLMGatewayConfig {
  return {
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    routing: config.routing ?? DEFAULTS.routing,
    webSearch: config.webSearch ?? DEFAULTS.webSearch,
    includeDeactivated: config.includeDeactivated ?? DEFAULTS.includeDeactivated,
  };
}

/** minimal config loader — persists to <agentDir>/cache/llmgateway-config.json */
class InlineConfigLoader {
  private current: ResolvedLLMGatewayConfig = { ...DEFAULTS };
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as LLMGatewayConfig;
      this.current = resolve(parsed);
    } catch {
      this.current = { ...DEFAULTS };
    }
  }

  getConfig(): ResolvedLLMGatewayConfig {
    return { ...this.current };
  }

  async update(patch: Partial<LLMGatewayConfig>): Promise<void> {
    const sparse = this.getSparse();
    const merged = { ...sparse, ...patch };
    this.current = resolve(merged);
    this.persist(merged);
  }

  private getSparse(): LLMGatewayConfig {
    const sparse: LLMGatewayConfig = {};
    if (this.current.baseUrl !== DEFAULTS.baseUrl)
      sparse.baseUrl = this.current.baseUrl;
    if (this.current.routing !== DEFAULTS.routing)
      sparse.routing = this.current.routing;
    if (this.current.webSearch !== DEFAULTS.webSearch)
      sparse.webSearch = this.current.webSearch;
    if (this.current.includeDeactivated !== DEFAULTS.includeDeactivated)
      sparse.includeDeactivated = this.current.includeDeactivated;
    return sparse;
  }

  private persist(config: LLMGatewayConfig): void {
    try {
      mkdirSync(dirname(CONFIG_FILE), { recursive: true });
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    } catch {
      // non-fatal — config just won't persist across restarts
    }
  }
}

export const configLoader = new InlineConfigLoader();

export function emitConfigUpdated(pi: ExtensionAPI): void {
  pi.events.emit(LLMGATEWAY_CONFIG_UPDATED_EVENT, {
    config: configLoader.getConfig(),
  });
}

/** register /llmgateway:settings command with interactive select-based UI */
export function registerLLMGatewaySettings(pi: ExtensionAPI): void {
  pi.registerCommand("llmgateway:settings", {
    description: "configure llm gateway settings (routing, web search, base url, deactivated models)",
    handler: async (_args, ctx) => {
      const config = configLoader.getConfig();

      const section = await ctx.ui.select(
        "LLM Gateway Settings — choose a setting to change",
        [
          { label: `Routing strategy: ${config.routing}`, value: "routing" },
          {
            label: `Web search: ${config.webSearch ? "enabled" : "disabled"}`,
            value: "webSearch",
          },
          { label: `Base URL: ${config.baseUrl}`, value: "baseUrl" },
          {
            label: `Include deactivated: ${config.includeDeactivated ? "include" : "ignore"}`,
            value: "includeDeactivated",
          },
        ],
        undefined,
      );

      if (!section) return;

      switch (section) {
        case "routing": {
          const choice = await ctx.ui.select(
            "Routing strategy (coding/dev plans only support auto and price)",
            [
              { label: "auto — full weighted smart-routing score", value: "auto" },
              { label: "price — optimise for lowest cost", value: "price" },
              { label: "throughput — optimise for highest throughput", value: "throughput" },
              { label: "latency — optimise for lowest latency", value: "latency" },
            ],
            config.routing,
          );
          if (choice) {
            await configLoader.update({
              routing: choice as ResolvedLLMGatewayConfig["routing"],
            });
            emitConfigUpdated(pi);
            ctx.ui.notify(`routing → ${choice}`, "info");
          }
          break;
        }
        case "webSearch": {
          const choice = await ctx.ui.select(
            "Web search",
            [
              { label: "enabled", value: "true" },
              { label: "disabled", value: "false" },
            ],
            config.webSearch ? "true" : "false",
          );
          if (choice) {
            await configLoader.update({ webSearch: choice === "true" });
            emitConfigUpdated(pi);
            ctx.ui.notify(`web search → ${choice}`, "info");
          }
          break;
        }
        case "baseUrl": {
          const input = await ctx.ui.input(
            "Base URL (for self-hosted instances)",
            config.baseUrl,
          );
          if (input && input.trim()) {
            await configLoader.update({ baseUrl: input.trim() });
            emitConfigUpdated(pi);
            ctx.ui.notify(`base URL → ${input.trim()}`, "info");
            ctx.ui.notify("restart the agent for the base URL change to take effect", "warning");
          }
          break;
        }
        case "includeDeactivated": {
          const choice = await ctx.ui.select(
            "Include deactivated models",
            [
              { label: "include — show deactivated models", value: "true" },
              { label: "ignore — hide deactivated models", value: "false" },
            ],
            config.includeDeactivated ? "true" : "false",
          );
          if (choice) {
            await configLoader.update({ includeDeactivated: choice === "true" });
            emitConfigUpdated(pi);
            ctx.ui.notify(
              `include deactivated → ${choice === "true" ? "include" : "ignore"}`,
              "info",
            );
          }
          break;
        }
      }
    },
  });
}