import crypto from "node:crypto";

const KDF_SALT = "torob-relay-kdf-v1";
const REQ_AAD = Buffer.from("torob-relay-req-v1", "utf8");
const DEFAULT_TIMEOUT_MS = 16_000;

interface DerivedKeys {
  reqKey: Buffer;
  resKey: Buffer;
}

const keyCache = new Map<string, DerivedKeys>();

export interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export interface RelayPingResult {
  ok: boolean;
  relayTs?: number;
  torob?: {
    reachable: boolean;
    status?: number;
    ok: boolean;
    challenged: boolean;
    latencyMs: number;
    error?: string;
  } | null;
}

export interface RelayFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: string;
  error?: string;
}

/**
 * Normalize a user-supplied relay endpoint.
 * Accepts full URLs ("https://...", "http://...") as well as bare "host:port"
 * (e.g. "2.180.37.182:43389") when encrypted key mode is active.
 */
export function normalizeRelayUrl(raw: string | null | undefined, hasKey: boolean): { url: string; error?: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { url: "" };

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

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
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

export function deriveRelayKeys(rawKey: string): DerivedKeys {
  const key = rawKey.trim();
  const cacheId = crypto.createHash("sha256").update(key, "utf8").digest("hex");
  const hit = keyCache.get(cacheId);
  if (hit) return hit;

  if (keyCache.size >= 16) {
    const first = keyCache.keys().next();
    if (!first.done) keyCache.delete(first.value);
  }

  const master = crypto.scryptSync(key, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  const reqKey = crypto.createHmac("sha256", master).update("torob-relay:req-v1").digest();
  const resKey = crypto.createHmac("sha256", master).update("torob-relay:res-v1").digest();
  const derived = { reqKey, resKey };
  keyCache.set(cacheId, derived);
  return derived;
}

export function encryptRelayEnvelope(key: Buffer, aad: Buffer, payload: unknown): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  };
}

export function decryptRelayEnvelope<T = unknown>(key: Buffer, aad: Buffer, raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Partial<EncryptedEnvelope>;
  if (env.v !== 1 || typeof env.iv !== "string" || typeof env.tag !== "string" || typeof env.data !== "string") {
    return null;
  }
  try {
    const iv = Buffer.from(env.iv, "base64url");
    const tag = Buffer.from(env.tag, "base64url");
    const data = Buffer.from(env.data, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || data.length === 0) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export class RelayTransportError extends Error {
  kind: "auth" | "network" | "bad_response";
  status?: number;
  constructor(message: string, kind: RelayTransportError["kind"], status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

async function postEncryptedRelay<T>(opts: {
  relayUrl: string;
  relayKey: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const { reqKey, resKey } = deriveRelayKeys(opts.relayKey);
  const nonce = crypto.randomBytes(16).toString("hex");
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
      throw new RelayTransportError(
        "احراز هویت رله رد شد — کلید رله در پنل و سرور ایران یکسان نیست یا IP مجاز نیست (HTTP " + res.status + ").",
        "auth",
        res.status,
      );
    }

    const rawText = await res.text();
    let parsedEnvelope: unknown;
    try {
      parsedEnvelope = JSON.parse(rawText);
    } catch {
      throw new RelayTransportError(
        `پاسخ رله نامعتبر است (HTTP ${res.status}): ${rawText.slice(0, 120)}`,
        "bad_response",
        res.status,
      );
    }

    const resAad = Buffer.from(`torob-relay-res-v1:${nonce}`, "utf8");
    const decrypted = decryptRelayEnvelope<T>(resKey, resAad, parsedEnvelope);
    if (!decrypted) {
      throw new RelayTransportError(
        "رمزگشایی پاسخ رله ناموفق بود — کلید رله در دو طرف هم‌خوانی ندارد یا بسته دستکاری شده است.",
        "auth",
        res.status,
      );
    }

    return decrypted;
  } catch (err) {
    if (err instanceof RelayTransportError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new RelayTransportError(`عدم اتصال به رله (${endpoint}): ${msg}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

export async function pingEncryptedRelay(opts: {
  relayUrl: string;
  relayKey: string;
  checkTorob?: boolean;
  timeoutMs?: number;
}): Promise<RelayPingResult> {
  return postEncryptedRelay<RelayPingResult>({
    relayUrl: opts.relayUrl,
    relayKey: opts.relayKey,
    payload: { op: "ping", checkTorob: Boolean(opts.checkTorob) },
    timeoutMs: opts.timeoutMs ?? 12_000,
  });
}

export async function fetchViaEncryptedRelay(opts: {
  relayUrl: string;
  relayKey: string;
  target: "api" | "site";
  path: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<RelayFetchResult> {
  return postEncryptedRelay<RelayFetchResult>({
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
