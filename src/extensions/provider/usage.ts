/**
 * usage tracking for LLM Gateway — fetches credit/DevPass usage from the
 * dashboard API and writes a UsageReport into agent.db so omp's built-in
 * `usage` status line segment shows the bar natively.
 *
 * the dashboard API lives at internal.llmgateway.io and uses Better Auth
 * session cookies (__Secure-better-auth.session_token). the /orgs endpoint
 * with ?includePersonal=true returns the devpass org with credit fields.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { configLoader } from "../../config";

const AGENT_DIR = join(homedir(), ".omp", "agent");
const STATE_FILE = join(AGENT_DIR, "cache", "llmgateway-usage.json");
const DB_PATH = join(AGENT_DIR, "agent.db");
const DASHBOARD_API = "https://internal.llmgateway.io";
const COOKIE_NAME = "__Secure-better-auth.session_token";
const POLL_INTERVAL_MS = 4 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDER = "llmgateway";

// ─── types ──────────────────────────────────────────────────────────────

export interface DevPassUsage {
  plan: string;
  creditsUsed: number;
  creditsLimit: number;
  premiumCreditsUsed: number;
  billingCycleStart: string | null;
  expiresAt: string | null;
  rawCredits: number;
}

export interface UsageReport {
  provider: string;
  fetchedAt: number;
  limits: UsageLimit[];
  notes: string[];
}

interface UsageLimit {
  id: string;
  label: string;
  scope: { windowId: string; provider: string };
  amount: {
    usedFraction: number;
    used?: number;
    remainingFraction?: number;
    unit?: string;
  };
  window: { id: string; label: string; resetsAt?: number };
  notes?: string[];
}

interface OrgData {
  kind: string;
  name: string;
  credits: string;
  devPlan: string;
  devPlanCreditsUsed: string;
  devPlanCreditsLimit: string;
  devPlanPremiumCreditsUsed: string;
  devPlanBillingCycleStart: string | null;
  devPlanExpiresAt: string | null;
}

interface DashboardResponse {
  organizations: OrgData[];
}

interface ExtensionUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
  setWidget(key: string, lines: string[] | undefined, opts?: { placement: string }): void;
  setWorkingMessage(message?: string): void;
  input(prompt: string, defaultValue?: string): Promise<string | undefined>;
  select(prompt: string, options: { label: string; value: string }[], current?: string): Promise<string | undefined>;
}

interface ExtensionCommandContext {
  hasUI: boolean;
  ui: ExtensionUi;
}

interface SessionStartContext {
  ui: ExtensionUi;
}

export interface DiagnosticsState {
  lastFetchAt: number | null;
  lastFetchOk: boolean | null;
  lastError: string | null;
  pollCount: number;
  cookieValid: boolean | null;
  lastWriteOk: boolean | null;
}

type Timer = ReturnType<typeof setInterval>;

// ─── cookie handling ────────────────────────────────────────────────────

/** accept the bare session token, a full cookie header, or anything in
 *  between — extract just the __Secure-better-auth.session_token piece */
function normaliseCookie(input: string): string {
  const trimmed = input.trim();
  // exact match — the whole input is the token
  if (!trimmed.includes("=") && !trimmed.includes(";")) return trimmed;
  // try to find the cookie by name
  const match = trimmed.match(
    /__Secure-better-auth\.session_token=([^;]+)/,
  );
  if (match) return match[1] ?? "";
  return trimmed;
}

function loadCookie(): string | null {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { cookie?: string };
    return parsed.cookie ?? null;
  } catch {
    return null;
  }
}

function saveCookie(cookie: string): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const existing = loadStateFile();
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ ...existing, cookie, savedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch {
    // non-fatal
  }
}

function loadStateFile(): { cookie?: string; savedAt?: string; usage?: DevPassUsage } {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// ─── usage fetch ────────────────────────────────────────────────────────

function parseNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** fetch orgs from the dashboard API and extract DevPass usage */
export async function fetchUsage(cookie: string): Promise<DevPassUsage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${DASHBOARD_API}/orgs?includePersonal=true`,
      {
        headers: {
          Cookie: `${COOKIE_NAME}=${cookie}`,
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;

    const data: DashboardResponse = await response.json();
    const devpassOrg = data.organizations.find((o) => o.kind === "devpass");

    if (!devpassOrg) {
      // no devpass org — try the default org for credits
      const defaultOrg = data.organizations.find((o) => o.kind === "default");
      if (!defaultOrg) return null;
      return {
        plan: defaultOrg.devPlan ?? "none",
        creditsUsed: parseNumber(defaultOrg.devPlanCreditsUsed),
        creditsLimit: parseNumber(defaultOrg.devPlanCreditsLimit),
        premiumCreditsUsed: parseNumber(defaultOrg.devPlanPremiumCreditsUsed),
        billingCycleStart: defaultOrg.devPlanBillingCycleStart,
        expiresAt: defaultOrg.devPlanExpiresAt,
        rawCredits: parseNumber(defaultOrg.credits),
      };
    }

    return {
      plan: devpassOrg.devPlan,
      creditsUsed: parseNumber(devpassOrg.devPlanCreditsUsed),
      creditsLimit: parseNumber(devpassOrg.devPlanCreditsLimit),
      premiumCreditsUsed: parseNumber(devpassOrg.devPlanPremiumCreditsUsed),
      billingCycleStart: devpassOrg.devPlanBillingCycleStart,
      expiresAt: devpassOrg.devPlanExpiresAt,
      rawCredits: parseNumber(devpassOrg.credits),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── cache persistence ──────────────────────────────────────────────────

function saveCachedUsage(usage: DevPassUsage): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const existing = loadStateFile();
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ ...existing, usage, savedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch {
    // non-fatal
  }
}

function loadCachedUsage(): DevPassUsage | null {
  return loadStateFile().usage ?? null;
}

/** build a UsageReport matching omp's internal schema so the built-in
 *  `usageSegment` can parse it via #normalizeUsageReports.
 *
 *  the status line usageSegment only recognises windowId "5h" and "7d".
 *  DevPass is a monthly billing cycle, so we map to "7d" — the segment
 *  renders it as "7d {percent}%". the /usage command also shows the
 *  dollar amounts via amount.used, amount.remainingFraction, and notes. */
function buildReport(usage: DevPassUsage): UsageReport {
  const now = Date.now();
  const limits: UsageLimit[] = [];

  if (usage.creditsLimit > 0) {
    const resetsAt = usage.billingCycleStart
      ? new Date(usage.billingCycleStart).getTime()
      : undefined;
    const usedFraction = Math.min(usage.creditsUsed / usage.creditsLimit, 1);
    const remaining = usage.creditsLimit - usage.creditsUsed;
    const limitNotes: string[] = [
      `${formatCurrency(remaining)} remaining of ${formatCurrency(usage.creditsLimit)}`,
    ];
    if (usage.premiumCreditsUsed > 0) {
      limitNotes.push(`${formatCurrency(usage.premiumCreditsUsed)} premium used`);
    }
    limits.push({
      id: "llmgateway:devplan",
      label: `DevPass ${usage.plan}`,
      scope: { windowId: "7d", provider: PROVIDER },
      amount: {
        usedFraction,
        used: usage.creditsUsed,
        remainingFraction: Math.max(0, 1 - usedFraction),
        unit: "USD",
      },
      window: { id: "7d", label: "Billing Cycle", ...resetsAt ? { resetsAt } : {} },
      notes: limitNotes,
    });
  }

  return {
    provider: PROVIDER,
    fetchedAt: now,
    limits,
    notes: [],
  };
}

// ─── agent.db cache injection ───────────────────────────────────────────

/** construct the real cache key that omp's AuthStorageUsageCache expects.
 *  omp's identity for an api_key credential is:
 *    api_key|secret:<Bun.hash(apiKey.trim()).toString(16)>
 *  and the full cache key is:
 *    usage_cache:report:<provider>:<baseUrl>:<identity> */
function buildUsageCacheKey(): string | null {
  // try auth_credentials first, then fall back to the env var.
  // the llmgateway provider uses apiKey: "LLMGATEWAY_API_KEY" (env var
  // name), so the key may not be stored in auth_credentials at all.
  let apiKey: string | null = null;
  try {
    const roDb = new Database(DB_PATH, { readonly: true });
    roDb.exec("PRAGMA busy_timeout = 5000");
    try {
      const row = roDb
        .prepare(
          `SELECT data FROM auth_credentials WHERE provider = ? AND credential_type = ? AND disabled_cause IS NULL LIMIT 1`,
        )
        .get(PROVIDER, "api_key") as { data: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.data) as { key?: string };
        apiKey = typeof parsed.key === "string" ? parsed.key : null;
      }
    } finally {
      roDb.close();
    }
  } catch {
    // db read failed — fall through to env var
  }
  if (!apiKey) {
    apiKey = process.env.LLMGATEWAY_API_KEY ?? null;
  }
  if (!apiKey) return null;
  const identity = `api_key|secret:${Bun.hash(apiKey.trim()).toString(16)}`;
  const baseUrl = configLoader.getConfig().baseUrl.replace(/\/+$/, "");
  return `usage_cache:report:${PROVIDER}:${baseUrl}:${identity}`;
}

/** write the UsageReport into agent.db's cache table so omp's
 *  AuthStorageUsageCache serves it to the built-in `usageSegment` */
function writeUsageCache(report: UsageReport): boolean {
  try {
    const payload = JSON.stringify({
      value: report,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    const expiresAtSec = Math.floor((Date.now() + CACHE_TTL_MS) / 1000);
    const BUSY_TIMEOUT_MS = 5000;

    const db = new Database(DB_PATH);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    try {
      // delete all old llmgateway cache keys (stale windowId, old hashes)
      db.prepare(`DELETE FROM cache WHERE key LIKE ?`).run(
        `usage_cache:report:${PROVIDER}:%`,
      );

      // write the primary key (env-var-derived identity)
      const primaryKey = buildUsageCacheKey();
      if (primaryKey) {
        db.prepare(
          `INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)`,
        ).run(primaryKey, payload, expiresAtSec);
      }

      // always write the fallback anonymous key too
      const fallbackKey = `usage_cache:report:${PROVIDER}:default:api_key|anonymous`;
      db.prepare(
        `INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)`,
      ).run(fallbackKey, payload, expiresAtSec);
    } finally {
      db.close();
    }
    return true;
  } catch {
    return false;
  }
}

// ─── formatting ─────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 100) return `$${amount.toFixed(0)}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

// ─── public API: register commands and polling ──────────────────────────

/** register /llmgateway:login, /llmgateway:status, and background polling */
export function registerUsageTracking(pi: ExtensionAPI): void {
  let pollTimer: Timer | null = null;
  let polling = false;
  const diag: DiagnosticsState = {
    lastFetchAt: null,
    lastFetchOk: null,
    lastError: null,
    pollCount: 0,
    cookieValid: null,
    lastWriteOk: null,
  };

  async function pollOnce(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const cookie = loadCookie();
      if (!cookie) {
        diag.lastError = "no cookie stored — run /llmgateway:login";
        return;
      }
      const usage = await fetchUsage(cookie);
      diag.lastFetchAt = Date.now();
      diag.pollCount++;
      if (!usage) {
        diag.lastFetchOk = false;
        diag.cookieValid = false;
        diag.lastError = "fetch failed — cookie may be invalid or expired";
        return;
      }
      diag.lastFetchOk = true;
      diag.cookieValid = true;
      diag.lastError = null;
      saveCachedUsage(usage);
      const report = buildReport(usage);
      let writeOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        writeOk = writeUsageCache(report);
        if (writeOk) break;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 500);
        await promise;
      }
      diag.lastWriteOk = writeOk;
      if (!writeOk) diag.lastError = "cache write failed after 3 retries (db locked?)";
    } catch (err) {
      diag.lastFetchOk = false;
      diag.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      polling = false;
    }
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  }

  // /llmgateway:login — capture session cookie
  pi.registerCommand("llmgateway:login", {
    description: "capture your LLM Gateway session cookie to enable usage bars (DevPass credits)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("LLM Gateway usage login requires an interactive session", "error");
        return;
      }

      const WIDGET_KEY = "llmgateway-login";

      ctx.ui.setWidget(
        WIDGET_KEY,
        [
          " 🌐  LLM Gateway usage login",
          "",
          "  1. open https://devpass.llmgateway.io/dashboard in your browser",
          "     (sign in if prompted)",
          "  2. devtools (F12) → application → storage → cookies → https://devpass.llmgateway.io",
          `  3. find the row named  ${COOKIE_NAME}`,
          "  4. copy its entire cookie value",
          "  5. paste it at the prompt below",
        ],
        { placement: "belowEditor" },
      );

      try {
        const input = await ctx.ui.input("paste session cookie value", "");
        if (!input || !input.trim()) {
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.notify("LLM Gateway usage login cancelled", "info");
          return;
        }
        const cookie = normaliseCookie(input);

        ctx.ui.setWorkingMessage("validating LLM Gateway cookie…");
        const usage = await fetchUsage(cookie);
        ctx.ui.setWorkingMessage();

        if (!usage) {
          diag.cookieValid = false;
          diag.lastFetchOk = false;
          diag.lastError = "cookie rejected during login (invalid or expired)";
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.notify(
            "LLM Gateway: cookie rejected (invalid or expired). re-copy the session token and run /llmgateway:login again.",
            "error",
          );
          return;
        }

        saveCookie(cookie);
        saveCachedUsage(usage);
        diag.cookieValid = true;
        diag.lastFetchAt = Date.now();
        diag.lastFetchOk = true;
        diag.lastError = null;
        const report = buildReport(usage);
        writeUsageCache(report);
        startPolling();
        ctx.ui.setWidget(WIDGET_KEY, undefined);

        const remaining = usage.creditsLimit - usage.creditsUsed;
        ctx.ui.notify(
          `LLM Gateway: cookie valid — DevPass ${usage.plan}, ${formatCurrency(remaining)} remaining of ${formatCurrency(usage.creditsLimit)}`,
          "info",
        );
      } catch (err) {
        ctx.ui.setWorkingMessage();
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.notify(
          `LLM Gateway usage login failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });

  // /llmgateway:status — show diagnostics
  pi.registerCommand("llmgateway:status", {
    description: "show LLM Gateway usage diagnostics: cookie, DevPass credits, poll status",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("LLM Gateway usage status requires an interactive session", "error");
        return;
      }

      const WIDGET_KEY = "llmgateway-status";
      const lines: string[] = [" 📊  LLM Gateway DevPass", ""];

      // cookie + cached usage condensed into fewer lines
      const cookie = loadCookie();
      const cached = loadCachedUsage();
      const state = loadStateFile();
      let cookieAge = "?";
      if (state.savedAt) {
        const ms = Date.now() - new Date(state.savedAt).getTime();
        cookieAge = `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
      }
      lines.push(`  cookie ${cookie ? `✓ ${cookieAge}` : "✗ run /llmgateway:login"}`);

      if (cached) {
        const remaining = cached.creditsLimit - cached.creditsUsed;
        const pct = cached.creditsLimit > 0
          ? ((cached.creditsUsed / cached.creditsLimit) * 100).toFixed(1)
          : "0";
        lines.push(`  DevPass ${cached.plan} · ${formatCurrency(remaining)} remaining (${pct}% used)`);
        if (cached.expiresAt) {
          const expDate = new Date(cached.expiresAt).toLocaleDateString("en-GB");
          lines.push(`  expires ${expDate} · ${formatCurrency(cached.creditsLimit)} limit`);
        }
      } else {
        lines.push(`  no cached data`);
      }

      // live fetch (compact)
      if (cookie) {
        lines.push("  fetching live…");
        ctx.ui.setWidget(WIDGET_KEY, [...lines], { placement: "belowEditor" });
        const live = await fetchUsage(cookie);
        lines.pop();
        if (live) {
          const remaining = live.creditsLimit - live.creditsUsed;
          lines.push(`  live ✓ ${formatCurrency(remaining)} remaining of ${formatCurrency(live.creditsLimit)}`);
          saveCachedUsage(live);
          writeUsageCache(buildReport(live));
        } else {
          lines.push(`  live ✗ fetch failed — cookie may be expired`);
        }
      }

      // poll + db status (one line)
      const fetchAge = diag.lastFetchAt ? `${Math.floor((Date.now() - diag.lastFetchAt) / 1000)}s` : "never";
      const writeStatus = diag.lastWriteOk === null ? "n/a" : diag.lastWriteOk ? "✓" : "✗";
      lines.push(`  poll ${fetchAge} ago · write ${writeStatus} · ${pollTimer ? "active" : "idle"}`);

      if (diag.lastError) {
        lines.push(`  ⚠ ${diag.lastError}`);
      }

      ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "belowEditor" });
    },
  });

  // session_start — write cached usage to db, patch authStorage to
  // recognise llmgateway as a usage provider, and start polling.
  //
  // omp's #collectUsageRequests skips providers without a registered
  // UsageProvider. llmgateway is extension-registered, so it has no
  // built-in usage provider — we monkey-patch authStorage.usageProviderFor
  // to return a dummy provider that returns empty limits. our extension
  // writes the real data to the agent.db cache table; when omp calls
  // #fetchUsageCached, it finds our fresh cache entry and returns it
  // instead of calling the dummy provider.
  pi.on("session_start", (_event, ctx: { modelRegistry?: { authStorage?: { usageProviderFor?: (provider: string) => unknown } } }) => {
    const authStorage = ctx.modelRegistry?.authStorage;
    if (authStorage?.usageProviderFor) {
      const original = authStorage.usageProviderFor.bind(authStorage);
      authStorage.usageProviderFor = (provider: string): unknown => {
        if (provider === PROVIDER) {
          return {
            id: PROVIDER,
            fetchUsage: async (): Promise<UsageReport | null> => ({
              provider: PROVIDER,
              fetchedAt: Date.now(),
              limits: [],
              notes: [],
            }),
            supports: (params: { provider: string }) => params.provider === PROVIDER,
            validatesCredentials: false,
          };
        }
        return original(provider);
      };
    }

    const cookie = loadCookie();
    if (!cookie) return;
    const cached = loadCachedUsage();
    if (cached) {
      const report = buildReport(cached);
      if (!writeUsageCache(report)) {
        const retryWrite = async (): Promise<void> => {
          for (const delay of [500, 1500, 3000]) {
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, delay);
            await promise;
            if (writeUsageCache(report)) return;
          }
        };
        void retryWrite();
      }
    }
    startPolling();
    void pollOnce();
  });

  // session_shutdown — stop polling
  pi.on("session_shutdown", () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
}