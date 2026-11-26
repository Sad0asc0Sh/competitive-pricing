"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOROB_RELAY_SETTINGS_KEY = void 0;
exports.invalidateTorobRelayCache = invalidateTorobRelayCache;
exports.computeRelayDigest = computeRelayDigest;
exports.readStoredTorobRelay = readStoredTorobRelay;
exports.resolveTorobRelayConfig = resolveTorobRelayConfig;
exports.getTorobRelayConfig = getTorobRelayConfig;
exports.getTorobRelayStatus = getTorobRelayStatus;
exports.saveTorobRelayConfig = saveTorobRelayConfig;
exports.getInternalMcpSyncSecret = getInternalMcpSyncSecret;
exports.getTorobMcpBaseUrl = getTorobMcpBaseUrl;
exports.syncTorobRelayToMcp = syncTorobRelayToMcp;
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../ai/config");
const crypto_1 = require("./crypto");
exports.TOROB_RELAY_SETTINGS_KEY = "torob_relay_config";
const CACHE_TTL_MS = 5000;
let cachedRow = null;
let lastSyncedMcpDigest = null;
let lastSyncedMcpAt = 0;
function invalidateTorobRelayCache() {
    cachedRow = null;
    lastSyncedMcpDigest = null;
    lastSyncedMcpAt = 0;
}
function computeRelayDigest(cfg) {
    const keyHash = cfg.relayKey
        ? node_crypto_1.default.createHash("sha256").update(cfg.relayKey, "utf8").digest("hex").slice(0, 16)
        : "";
    return node_crypto_1.default
        .createHash("sha256")
        .update(`${cfg.enabled ? 1 : 0}|${cfg.mode}|${cfg.url}|${keyHash}`, "utf8")
        .digest("hex")
        .slice(0, 16);
}
async function readStoredTorobRelay() {
    if (cachedRow && Date.now() - cachedRow.at < CACHE_TTL_MS) {
        return cachedRow.value;
    }
    let value = null;
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("@/db")));
        const res = await pool.query("select value from settings where key = $1 limit 1", [
            exports.TOROB_RELAY_SETTINGS_KEY,
        ]);
        const raw = res.rows[0]?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            value = raw;
        }
    }
    catch {
        value = null;
    }
    cachedRow = { at: Date.now(), value };
    return value;
}
async function writeStoredTorobRelay(value) {
    const { pool } = await Promise.resolve().then(() => __importStar(require("@/db")));
    await pool.query(`insert into settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`, [exports.TOROB_RELAY_SETTINGS_KEY, JSON.stringify(value)]);
    invalidateTorobRelayCache();
}
function resolveTorobRelayConfig(stored, env = {
    apiBase: process.env.TOROB_API_BASE,
    relayKey: process.env.TOROB_RELAY_KEY,
}) {
    const usingDb = stored !== null;
    const source = usingDb
        ? "db"
        : (env.apiBase ?? "").trim()
            ? "env"
            : "none";
    const enabled = usingDb ? stored.enabled !== false : Boolean((env.apiBase ?? "").trim());
    const rawUrl = usingDb ? (stored.url ?? "").trim() : (env.apiBase ?? "").trim();
    const relayKey = usingDb ? (stored.relayKey ?? "").trim() : (env.relayKey ?? "").trim();
    if (!enabled || !rawUrl) {
        const mode = "direct";
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
    const normalized = (0, crypto_1.normalizeRelayUrl)(rawUrl, Boolean(relayKey));
    if (normalized.error || !normalized.url) {
        const mode = "direct";
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
    const mode = relayKey ? "encrypted_relay" : "plain_https_base";
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
async function getTorobRelayConfig() {
    const stored = await readStoredTorobRelay();
    return resolveTorobRelayConfig(stored);
}
async function getTorobRelayStatus() {
    const cfg = await getTorobRelayConfig();
    return {
        enabled: cfg.enabled,
        configured: cfg.configured,
        mode: cfg.mode,
        url: cfg.url,
        hasKey: Boolean(cfg.relayKey),
        keyHint: (0, config_1.maskApiKey)(cfg.relayKey),
        source: cfg.source,
        ...(cfg.configError ? { configError: cfg.configError } : {}),
    };
}
async function saveTorobRelayConfig(input) {
    const existing = (await readStoredTorobRelay()) ?? {};
    const next = { ...existing };
    if (typeof input.enabled === "boolean")
        next.enabled = input.enabled;
    if (typeof input.url === "string")
        next.url = input.url.trim();
    if (input.clearKey === true) {
        next.relayKey = "";
    }
    else if (typeof input.relayKey === "string") {
        const candidate = input.relayKey.trim();
        const looksMasked = candidate.includes(config_1.MASKED_SECRET) || /^•+$/.test(candidate);
        if (candidate && !looksMasked) {
            if (candidate.length < 6) {
                throw new Error("کلید رله باید دست‌کم ۶ کاراکتر باشد.");
            }
            next.relayKey = candidate;
        }
    }
    if (next.enabled !== false && next.url) {
        const check = (0, crypto_1.normalizeRelayUrl)(next.url, Boolean((next.relayKey ?? "").trim()));
        if (check.error)
            throw new Error(check.error);
        next.url = check.url;
    }
    next.updatedAt = new Date().toISOString();
    await writeStoredTorobRelay(next);
    return next;
}
function getInternalMcpSyncSecret() {
    return (process.env.TOROB_MCP_SYNC_SECRET ||
        process.env.AUTH_SECRET ||
        process.env.SESSION_SECRET ||
        process.env.CRON_SECRET ||
        "").trim();
}
function getTorobMcpBaseUrl() {
    const raw = (process.env.TOROB_MCP_URL ?? "").trim();
    if (!raw)
        return "";
    return raw.replace(/\/mcp\/?$/, "");
}
/**
 * Push active relay settings to the local torob-mcp HTTP server.
 * Skips silently when TOROB_MCP_URL is not configured or points to a test stub.
 */
async function syncTorobRelayToMcp(cfg, opts) {
    const mcpBase = getTorobMcpBaseUrl();
    if (!mcpBase || mcpBase.startsWith("http://fake")) {
        return { synced: false };
    }
    const effective = cfg ?? (await getTorobRelayConfig());
    if (!opts?.force && lastSyncedMcpDigest === effective.digest && Date.now() - lastSyncedMcpAt < 10_000) {
        return { synced: true };
    }
    const headers = { "Content-Type": "application/json" };
    const secret = getInternalMcpSyncSecret();
    if (secret)
        headers["X-Internal-Sync-Secret"] = secret;
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
                const statusJson = (await statusRes.json().catch(() => null));
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
    }
    catch (err) {
        return { synced: false, error: err instanceof Error ? err.message : String(err) };
    }
    finally {
        clearTimeout(timer);
    }
}
