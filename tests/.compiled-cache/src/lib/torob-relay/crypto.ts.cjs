"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayTransportError = void 0;
exports.normalizeRelayUrl = normalizeRelayUrl;
exports.deriveRelayKeys = deriveRelayKeys;
exports.encryptRelayEnvelope = encryptRelayEnvelope;
exports.decryptRelayEnvelope = decryptRelayEnvelope;
exports.pingEncryptedRelay = pingEncryptedRelay;
exports.fetchViaEncryptedRelay = fetchViaEncryptedRelay;
const node_crypto_1 = __importDefault(require("node:crypto"));
const KDF_SALT = "torob-relay-kdf-v1";
const REQ_AAD = Buffer.from("torob-relay-req-v1", "utf8");
const DEFAULT_TIMEOUT_MS = 16_000;
const keyCache = new Map();
/**
 * Normalize a user-supplied relay endpoint.
 * Accepts full URLs ("https://...", "http://...") as well as bare "host:port"
 * (e.g. "2.180.37.182:43389") when encrypted key mode is active.
 */
function normalizeRelayUrl(raw, hasKey) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed)
        return { url: "" };
    let candidate = trimmed;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
        if (!hasKey) {
            return {
                url: "",
                error: "بدون کلید رله، آدرس باید با https:// شروع شود (یا یک کلید امنیتی رله وارد کنید).",
            };
        }
        candidate = `http://${candidate}`;
    }
    let parsed;
    try {
        parsed = new URL(candidate);
    }
    catch {
        return { url: "", error: `آدرس رله نامعتبر است: ${trimmed}` };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { url: "", error: "پروتکل رله فقط می‌تواند http یا https باشد." };
    }
    if (parsed.protocol === "http:" && !hasKey) {
        return {
            url: "",
            error: "استفاده از HTTP بدون کلید رمزنگاری امن نیست؛ یا کلید رله وارد کنید یا از HTTPS استفاده نمایید.",
        };
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return { url: `${parsed.origin}${cleanPath}` };
}
function deriveRelayKeys(rawKey) {
    const key = rawKey.trim();
    const cacheId = node_crypto_1.default.createHash("sha256").update(key, "utf8").digest("hex");
    const hit = keyCache.get(cacheId);
    if (hit)
        return hit;
    if (keyCache.size >= 16) {
        const first = keyCache.keys().next();
        if (!first.done)
            keyCache.delete(first.value);
    }
    const master = node_crypto_1.default.scryptSync(key, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
    const reqKey = node_crypto_1.default.createHmac("sha256", master).update("torob-relay:req-v1").digest();
    const resKey = node_crypto_1.default.createHmac("sha256", master).update("torob-relay:res-v1").digest();
    const derived = { reqKey, resKey };
    keyCache.set(cacheId, derived);
    return derived;
}
function encryptRelayEnvelope(key, aad, payload) {
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return {
        v: 1,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        data: encrypted.toString("base64url"),
    };
}
function decryptRelayEnvelope(key, aad, raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const env = raw;
    if (env.v !== 1 || typeof env.iv !== "string" || typeof env.tag !== "string" || typeof env.data !== "string") {
        return null;
    }
    try {
        const iv = Buffer.from(env.iv, "base64url");
        const tag = Buffer.from(env.tag, "base64url");
        const data = Buffer.from(env.data, "base64url");
        if (iv.length !== 12 || tag.length !== 16 || data.length === 0)
            return null;
        const decipher = node_crypto_1.default.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
        return JSON.parse(plain);
    }
    catch {
        return null;
    }
}
class RelayTransportError extends Error {
    kind;
    status;
    constructor(message, kind, status) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}
exports.RelayTransportError = RelayTransportError;
async function postEncryptedRelay(opts) {
    const { reqKey, resKey } = deriveRelayKeys(opts.relayKey);
    const nonce = node_crypto_1.default.randomBytes(16).toString("hex");
    const envelope = encryptRelayEnvelope(reqKey, REQ_AAD, {
        v: 1,
        ts: Date.now(),
        nonce,
        ...opts.payload,
    });
    const endpoint = `${opts.relayUrl.replace(/\/+$/, "")}/_relay`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(envelope),
            signal: ctrl.signal,
            cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) {
            throw new RelayTransportError("احراز هویت رله رد شد — کلید رله در پنل و سرور ایران یکسان نیست یا IP مجاز نیست (HTTP " + res.status + ").", "auth", res.status);
        }
        const rawText = await res.text();
        let parsedEnvelope;
        try {
            parsedEnvelope = JSON.parse(rawText);
        }
        catch {
            throw new RelayTransportError(`پاسخ رله نامعتبر است (HTTP ${res.status}): ${rawText.slice(0, 120)}`, "bad_response", res.status);
        }
        const resAad = Buffer.from(`torob-relay-res-v1:${nonce}`, "utf8");
        const decrypted = decryptRelayEnvelope(resKey, resAad, parsedEnvelope);
        if (!decrypted) {
            throw new RelayTransportError("رمزگشایی پاسخ رله ناموفق بود — کلید رله در دو طرف هم‌خوانی ندارد یا بسته دستکاری شده است.", "auth", res.status);
        }
        return decrypted;
    }
    catch (err) {
        if (err instanceof RelayTransportError)
            throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new RelayTransportError(`عدم اتصال به رله (${endpoint}): ${msg}`, "network");
    }
    finally {
        clearTimeout(timer);
    }
}
async function pingEncryptedRelay(opts) {
    return postEncryptedRelay({
        relayUrl: opts.relayUrl,
        relayKey: opts.relayKey,
        payload: { op: "ping", checkTorob: Boolean(opts.checkTorob) },
        timeoutMs: opts.timeoutMs ?? 12_000,
    });
}
async function fetchViaEncryptedRelay(opts) {
    return postEncryptedRelay({
        relayUrl: opts.relayUrl,
        relayKey: opts.relayKey,
        payload: {
            op: "fetch",
            target: opts.target,
            path: opts.path,
            headers: opts.headers ?? {},
        },
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
}
