import crypto from "node:crypto";
import { MASKED_SECRET, maskApiKey } from "@/lib/ai/config";
import { normalizeRelayUrl } from "./crypto";

export const TOROB_RELAY_SETTINGS_KEY = "torob_relay_config";

export type TorobRelayMode = "encrypted_relay" | "plain_https_base" | "direct";
export type TorobRelaySource = "db" | "env" | "none";

export interface TorobRelayStoredConfig {
  enabled?: boolean;
  url?: string;
  relayKey?: string;
  updatedAt?: string;
}

export interface TorobRelayEffectiveConfig {
  enabled: boolean;
  configured: boolean;
  mode: TorobRelayMode;
  url: string;
  relayKey: string;
  source: TorobRelaySource;
  digest: string;
}

export interface TorobRelayStatus {
  enabled: boolean;
  configured: boolean;
  mode: TorobRelayMode;
  url: string;
  hasKey: boolean;
  keyHint: string;
  source: TorobRelaySource;
  configError?: string;
}

export interface SaveTorobRelayInput {
  enabled?: boolean;
  url?: string;
  relayKey?: string;
  clearKey?: boolean;
}

const CACHE_TTL_MS = 5000;
let cachedRow: { at: number; value: TorobRelayStoredConfig | null } | null = null;
let lastSyncedMcpDigest: string | null = null;
let lastSyncedMcpAt = 0;

export function invalidateTorobRelayCache(): void {
  cachedRow = null;
  lastSyncedMcpDigest = null;
  lastSyncedMcpAt = 0;
}

export function computeRelayDigest(cfg: { enabled: boolean; mode: TorobRelayMode; url: string; relayKey: string }): string {
  const keyHash = cfg.relayKey
    ? crypto.createHash("sha256").update(cfg.relayKey, "utf8").digest("hex").slice(0, 16)
    : "";
  return crypto
    .createHash("sha256")
    .update(`${cfg.enabled ? 1 : 0}|${cfg.mode}|${cfg.url}|${keyHash}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export async function readStoredTorobRelay(): Promise<TorobRelayStoredConfig | null> {
  if (cachedRow && Date.now() - cachedRow.at < CACHE_TTL_MS) {
    return cachedRow.value;
  }
  let value: TorobRelayStoredConfig | null = null;
  try {
    const { pool } = await import("@/db");
    const res = await pool.query<{ value: unknown }>("select value from settings where key = $1 limit 1", [
      TOROB_RELAY_SETTINGS_KEY,
    ]);
    const raw = res.rows[0]?.value;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      value = raw as TorobRelayStoredConfig;
    }
  } catch {
    value = null;
  }
  cachedRow = { at: Date.now(), value };
  return value;
}

async function writeStoredTorobRelay(value: TorobRelayStoredConfig): Promise<void> {
  const { pool } = await import("@/db");
  await pool.query(
    `insert into settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [TOROB_RELAY_SETTINGS_KEY, JSON.stringify(value)],
  );
  invalidateTorobRelayCache();
}

export function resolveTorobRelayConfig(
  stored: TorobRelayStoredConfig | null,
  env: { apiBase?: string; relayKey?: string } = {
    apiBase: process.env.TOROB_API_BASE,
    relayKey: process.env.TOROB_RELAY_KEY,
  },
): TorobRelayEffectiveConfig & { configError?: string } {
  const usingDb = stored !== null;
  const source: TorobRelaySource = usingDb
    ? "db"
    : (env.apiBase ?? "").trim()
      ? "env"
      : "none";

  const enabled = usingDb ? stored.enabled !== false : Boolean((env.apiBase ?? "").trim());
  const rawUrl = usingDb ? (stored.url ?? "").trim() : (env.apiBase ?? "").trim();
  const relayKey = usingDb ? (stored.relayKey ?? "").trim() : (env.relayKey ?? "").trim();

  if (!enabled || !rawUrl) {
    const mode: TorobRelayMode = "direct";
    return {
      enabled,
      configured: false,
      mode,
      url: "",
      relayKey,
      source,
      digest: computeRelayDigest({ enabled: false, mode, url: "", relayKey: "" }),
    };
  }

  const normalized = normalizeRelayUrl(rawUrl, Boolean(relayKey));
  if (normalized.error || !normalized.url) {
    const mode: TorobRelayMode = "direct";
    return {
      enabled,
      configured: false,
      mode,
      url: rawUrl,
      relayKey,
      source,
      configError: normalized.error,
      digest: computeRelayDigest({ enabled: false, mode, url: "", relayKey: "" }),
    };
  }

  const mode: TorobRelayMode = relayKey ? "encrypted_relay" : "plain_https_base";
  return {
    enabled: true,
    configured: true,
    mode,
    url: normalized.url,
    relayKey,
    source,
    digest: computeRelayDigest({ enabled: true, mode, url: normalized.url, relayKey }),
  };
}

export async function getTorobRelayConfig(): Promise<TorobRelayEffectiveConfig & { configError?: string }> {
  const stored = await readStoredTorobRelay();
  return resolveTorobRelayConfig(stored);
}

export async function getTorobRelayStatus(): Promise<TorobRelayStatus> {
  const cfg = await getTorobRelayConfig();
  return {
    enabled: cfg.enabled,
    configured: cfg.configured,
    mode: cfg.mode,
    url: cfg.url,
    hasKey: Boolean(cfg.relayKey),
    keyHint: maskApiKey(cfg.relayKey),
    source: cfg.source,
    ...(cfg.configError ? { configError: cfg.configError } : {}),
  };
}

export async function saveTorobRelayConfig(input: SaveTorobRelayInput): Promise<TorobRelayStoredConfig> {
  const existing = (await readStoredTorobRelay()) ?? {};
  const next: TorobRelayStoredConfig = { ...existing };

  if (typeof input.enabled === "boolean") next.enabled = input.enabled;
  if (typeof input.url === "string") next.url = input.url.trim();

  if (input.clearKey === true) {
    next.relayKey = "";
  } else if (typeof input.relayKey === "string") {
    const candidate = input.relayKey.trim();
    const looksMasked = candidate.includes(MASKED_SECRET) || /^•+$/.test(candidate);
    if (candidate && !looksMasked) {
      if (candidate.length < 6) {
        throw new Error("کلید رله باید دست‌کم ۶ کاراکتر باشد.");
      }
      next.relayKey = candidate;
    }
  }

  if (next.enabled !== false && next.url) {
    const check = normalizeRelayUrl(next.url, Boolean((next.relayKey ?? "").trim()));
    if (check.error) throw new Error(check.error);
    next.url = check.url;
  }

  next.updatedAt = new Date().toISOString();
  await writeStoredTorobRelay(next);
  return next;
}

export function getInternalMcpSyncSecret(): string {
  return (
    process.env.TOROB_MCP_SYNC_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
}

export function getTorobMcpBaseUrl(): string {
  const raw = (process.env.TOROB_MCP_URL ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/mcp\/?$/, "");
}

/**
 * Push active relay settings to the local torob-mcp HTTP server.
 * Skips silently when TOROB_MCP_URL is not configured or points to a test stub.
 */
export async function syncTorobRelayToMcp(
  cfg?: TorobRelayEffectiveConfig,
  opts?: { force?: boolean },
): Promise<{ synced: boolean; error?: string }> {
  const mcpBase = getTorobMcpBaseUrl();
  if (!mcpBase || mcpBase.startsWith("http://fake")) {
    return { synced: false };
  }

  const effective = cfg ?? (await getTorobRelayConfig());
  if (!opts?.force && lastSyncedMcpDigest === effective.digest && Date.now() - lastSyncedMcpAt < 10_000) {
    return { synced: true };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = getInternalMcpSyncSecret();
  if (secret) headers["X-Internal-Sync-Secret"] = secret;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    // Check if torob-mcp already has the exact same digest before pushing secrets
    if (!opts?.force) {
      const statusRes = await fetch(`${mcpBase}/relay-status`, {
        method: "GET",
        headers,
        signal: ctrl.signal,
        cache: "no-store",
      }).catch(() => null);
      if (statusRes?.ok) {
        const statusJson = (await statusRes.json().catch(() => null)) as { digest?: string } | null;
        if (statusJson?.digest === effective.digest) {
          lastSyncedMcpDigest = effective.digest;
          lastSyncedMcpAt = Date.now();
          return { synced: true };
        }
      }
    }

    const res = await fetch(`${mcpBase}/relay-config`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        enabled: effective.enabled && effective.configured,
        mode: effective.mode,
        url: effective.configured ? effective.url : "",
        key: effective.configured ? effective.relayKey : "",
        digest: effective.digest,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { synced: false, error: `torob-mcp sync HTTP ${res.status}: ${txt.slice(0, 120)}` };
    }
    lastSyncedMcpDigest = effective.digest;
    lastSyncedMcpAt = Date.now();
    return { synced: true };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
