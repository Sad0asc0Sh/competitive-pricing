import crypto from "node:crypto";
import type { EncryptedRelayTransport, RelayTransportResponse } from "./http.js";

const KDF_SALT = "torob-relay-kdf-v1";
const REQ_AAD = Buffer.from("torob-relay-req-v1", "utf8");

interface DerivedKeys {
  reqKey: Buffer;
  resKey: Buffer;
}

const keyCache = new Map<string, DerivedKeys>();

function deriveKeys(rawKey: string): DerivedKeys {
  const key = rawKey.trim();
  const id = crypto.createHash("sha256").update(key, "utf8").digest("hex");
  const hit = keyCache.get(id);
  if (hit) return hit;

  if (keyCache.size >= 16) {
    const first = keyCache.keys().next();
    if (!first.done) keyCache.delete(first.value);
  }

  const master = crypto.scryptSync(key, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  const reqKey = crypto.createHmac("sha256", master).update("torob-relay:req-v1").digest();
  const resKey = crypto.createHmac("sha256", master).update("torob-relay:res-v1").digest();
  const derived = { reqKey, resKey };
  keyCache.set(id, derived);
  return derived;
}

function encryptEnvelope(key: Buffer, aad: Buffer, obj: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

function decryptEnvelope(key: Buffer, aad: Buffer, raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
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
    return JSON.parse(plain) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function timingSafeEqualSecret(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b) && Buffer.byteLength(candidate) === Buffer.byteLength(expected);
}

export function computeRelayConfigDigest(cfg: {
  enabled: boolean;
  mode: string;
  url: string;
  key: string;
}): string {
  const keyHash = cfg.key
    ? crypto.createHash("sha256").update(cfg.key, "utf8").digest("hex").slice(0, 16)
    : "";
  return crypto
    .createHash("sha256")
    .update(`${cfg.enabled ? 1 : 0}|${cfg.mode}|${cfg.url}|${keyHash}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export const createEncryptedRelayTransport = (): EncryptedRelayTransport => {
  return async ({ url, key, path, headers, timeoutMs }): Promise<RelayTransportResponse> => {
    const { reqKey, resKey } = deriveKeys(key);
    const nonce = crypto.randomBytes(16).toString("hex");
    const envelope = encryptEnvelope(reqKey, REQ_AAD, {
      v: 1,
      ts: Date.now(),
      nonce,
      op: "fetch",
      target: "api",
      path,
      headers,
    });

    const endpoint = `${url.replace(/\/+$/, "")}/_relay`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: ctrl.signal,
      });

      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Relay authentication failed (HTTP ${res.status}): check RELAY_KEY.`);
        (err as Error & { fatalRelayAuth?: boolean }).fatalRelayAuth = true;
        throw err;
      }

      const rawText = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error(`Invalid relay response (HTTP ${res.status})`);
      }

      const resAad = Buffer.from(`torob-relay-res-v1:${nonce}`, "utf8");
      const decrypted = decryptEnvelope(resKey, resAad, parsed);
      if (!decrypted) {
        const err = new Error("Relay response decryption failed: RELAY_KEY mismatch or tampered response.");
        (err as Error & { fatalRelayAuth?: boolean }).fatalRelayAuth = true;
        throw err;
      }

      if (typeof decrypted.error === "string" && decrypted.error) {
        throw new Error(`Relay upstream error: ${decrypted.error}`);
      }

      return {
        status: typeof decrypted.status === "number" ? decrypted.status : 502,
        contentType: typeof decrypted.contentType === "string" ? decrypted.contentType : "",
        body: typeof decrypted.body === "string" ? decrypted.body : "",
      };
    } finally {
      clearTimeout(timer);
    }
  };
};
