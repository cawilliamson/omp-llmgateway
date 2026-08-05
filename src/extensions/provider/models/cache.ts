import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir } from "../../../lib/paths";

const CACHE_FILENAME = "llmgateway-models.json";

function getCachePath(): string {
  return join(getAgentDir(), "cache", CACHE_FILENAME);
}

interface CacheFile {
  version: 1;
  fetchedAt: string;
  models: ProviderModelConfig[];
}

/** read the on-disk model cache. returns an empty array on any read/parse error */
export function loadCachedModels(): ProviderModelConfig[] {
  try {
    const raw = readFileSync(getCachePath(), "utf-8");
    const parsed: CacheFile = JSON.parse(raw);
    if (parsed.version !== 1 || !Array.isArray(parsed.models)) return [];
    return parsed.models;
  } catch {
    return [];
  }
}

/** write the model list to the on-disk cache. silently ignores write errors */
export function writeCachedModels(models: ProviderModelConfig[]): void {
  try {
    const path = getCachePath();
    mkdirSync(dirname(path), { recursive: true });
    const data: CacheFile = {
      version: 1,
      fetchedAt: new Date().toISOString(),
      models,
    };
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // non-fatal: a stale or missing cache just means we use the static snapshot
  }
}