#!/usr/bin/env node
/**
 * Torob Encrypted L7 Relay (Windows & Linux, zero external dependencies, Node 18+)
 *
 * Security model:
 *  - Single shared key (--key / RELAY_KEY), never transmitted on the wire.
 *  - Key derivation via scryptSync + HMAC domain separation -> AES-256-GCM req/res keys.
 *  - Request & response encrypted + authenticated (AAD bound to request nonce, anti-replay timestamp + nonce window).
 *  - Strict Torob-only L7 allowlist (GET https://api.torob.com/v4/... and https://torob.com/p/... only, redirect: manual).
 *  - Optional --allow-ip=<VPS_IP> source IP filter; unknown paths return 404.
 *
 * Usage:
 *   node torob-relay.mjs --port=43389 --key="YourSecretKey"
 *   node torob-relay.mjs --port=43389 --key="YourSecretKey" --allow-ip=1.2.3.4
 */
import http from "node:http";
import crypto from "node:crypto";

const KDF_SALT = "torob-relay-kdf-v1";
const REQ_AAD = Buffer.from("torob-relay-req-v1", "utf8");
const MAX_REQ_BYTES = 64 * 1024;
const MAX_RES_BYTES = 8 * 1024 * 1024;
const CLOCK_SKEW_MS = 120_000;
const NONCE_TTL_MS = 180_000;
const MAX_NONCES = 5_000;
const UPSTREAM_TIMEOUT_MS = 15_000;

const SAFE_FORWARD_HEADERS = new Set([
  "user-agent",
  "accept",
  "accept-language",
  "referer",
  "origin",
  "source",
  "cache-control",
  "pragma",
]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 2) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const k = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[k] = next;
        i++;
      } else {
        out[k] = "true";
      }
    }
  }
  return out;
}

function maskKey(k) {
  if (!k || k.length <= 6) return "••••••";
  return `${k.slice(0, 2)}••••${k.slice(-2)}`;
}

function deriveKeys(rawKey) {
  const master = crypto.scryptSync(rawKey, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  const reqKey = crypto.createHmac("sha256", master).update("torob-relay:req-v1").digest();
  const resKey = crypto.createHmac("sha256", master).update("torob-relay:res-v1").digest();
  return { reqKey, resKey };
}

function encryptEnvelope(key, aad, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const plaintext = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: encrypted.toString("base64url"),
  };
}

function decryptEnvelope(key, aad, raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1) return null;
  if (typeof raw.iv !== "string" || typeof raw.tag !== "string" || typeof raw.data !== "string") return null;
  try {
    const iv = Buffer.from(raw.iv, "base64url");
    const tag = Buffer.from(raw.tag, "base64url");
    const data = Buffer.from(raw.data, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || data.length === 0) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

function normalizeRemoteIp(addr) {
  if (!addr) return "";
  const s = String(addr).trim();
  return s.startsWith("::ffff:") ? s.slice(7) : s;
}

function resolveTorobTargetUrl(target, rawPath) {
  if (typeof rawPath !== "string" || !rawPath.startsWith("/") || rawPath.startsWith("//")) return null;
  if (/[\r\n\0\\]/.test(rawPath)) return null;
  const origin = target === "site" ? "https://torob.com" : "https://api.torob.com";
  const prefix = target === "site" ? "/p/" : "/v4/";
  if (!rawPath.startsWith(prefix)) return null;
  try {
    const u = new URL(rawPath, origin);
    if (u.origin !== origin || !u.pathname.startsWith(prefix)) return null;
    if (u.pathname.includes("..")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeHeaders(inputHeaders) {
  const out = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://torob.com/",
    Origin: "https://torob.com",
  };
  if (inputHeaders && typeof inputHeaders === "object" && !Array.isArray(inputHeaders)) {
    for (const [k, v] of Object.entries(inputHeaders)) {
      const lk = String(k).toLowerCase();
      if (!SAFE_FORWARD_HEADERS.has(lk) || typeof v !== "string") continue;
      if (/[\r\n\0]/.test(v) || v.length > 1024) continue;
      out[lk] = v;
    }
  }
  return out;
}

async function readResponseCapped(res, maxBytes) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Upstream body exceeded ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function looksLikeChallenge(status, contentType, body) {
  if (status === 490) return true;
  if (String(contentType || "").toLowerCase().includes("json")) return false;
  return /arcaptcha|ربات هستید|captcha/i.test(String(body || "").slice(0, 4000));
}

async function fetchTorob(url, headers, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: ctrl.signal,
    });
    const body = await readResponseCapped(res, MAX_RES_BYTES);
    return {
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function main() {
  if (typeof globalThis.fetch !== "function") {
    console.error("Error: Node.js 18+ is required (global fetch not found).");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(
      [
        "Torob Encrypted L7 Relay",
        "",
        "Options:",
        "  --port=43389          Port to listen on (env: RELAY_PORT or PORT, default: 43389)",
        "  --host=0.0.0.0        Bind address (env: RELAY_HOST or HOST, default: 0.0.0.0)",
        "  --key=SECRET          Shared relay key (env: RELAY_KEY, min 6 chars)",
        "  --allow-ip=IP1,IP2    Optional comma-separated allowed client IPs (env: ALLOW_IP)",
      ].join("\n"),
    );
    process.exit(0);
  }

  const rawPort = Number(args.port ?? process.env.RELAY_PORT ?? process.env.PORT ?? 43389);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 43389;
  const host = String(args.host ?? process.env.RELAY_HOST ?? process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const relayKey = String(args.key ?? process.env.RELAY_KEY ?? "").trim();
  const allowRaw = String(args["allow-ip"] ?? process.env.ALLOW_IP ?? "").trim();
  const allowedIps = new Set(
    allowRaw
      .split(",")
      .map((s) => normalizeRemoteIp(s))
      .filter(Boolean),
  );

  if (relayKey.length < 6) {
    console.error(
      "Error: Missing or too short --key / RELAY_KEY (minimum 6 characters).\n" +
        'Example: node torob-relay.mjs --port=43389 --key="MySimpleKey2026"',
    );
    process.exit(1);
  }

  const { reqKey, resKey } = deriveKeys(relayKey);
  const seenNonces = new Map();

  function trackNonce(nonce) {
    const now = Date.now();
    if (seenNonces.size > MAX_NONCES / 2) {
      for (const [k, exp] of seenNonces) {
        if (exp <= now) seenNonces.delete(k);
      }
      while (seenNonces.size >= MAX_NONCES) {
        const oldest = seenNonces.keys().next();
        if (oldest.done) break;
        seenNonces.delete(oldest.value);
      }
    }
    const existing = seenNonces.get(nonce);
    if (existing && existing > now) return false;
    seenNonces.set(nonce, now + NONCE_TTL_MS);
    return true;
  }

  const server = http.createServer((req, res) => {
    if (allowedIps.size > 0) {
      const remote = normalizeRemoteIp(req.socket?.remoteAddress);
      if (!allowedIps.has(remote)) {
        res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
        return;
      }
    }

    const reqPath = (req.url || "").split("?")[0];
    if (req.method !== "POST" || reqPath !== "/_relay") {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }

    const chunks = [];
    let bytes = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_REQ_BYTES) {
        aborted = true;
        if (!res.headersSent) res.writeHead(413).end("Payload too large");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", async () => {
      if (aborted || res.writableEnded) return;
      let envelope;
      try {
        envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"bad_json"}');
        return;
      }

      const payload = decryptEnvelope(reqKey, REQ_AAD, envelope);
      if (!payload || typeof payload !== "object") {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
        return;
      }

      const ts = Number(payload.ts);
      const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
      if (
        !Number.isFinite(ts) ||
        Math.abs(Date.now() - ts) > CLOCK_SKEW_MS ||
        nonce.length < 16 ||
        nonce.length > 128 ||
        !trackNonce(nonce)
      ) {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"replay_or_expired"}');
        return;
      }

      const resAad = Buffer.from(`torob-relay-res-v1:${nonce}`, "utf8");
      const sendEncrypted = (status, bodyObj) => {
        const encrypted = encryptEnvelope(resKey, resAad, bodyObj);
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(encrypted));
      };

      try {
        if (payload.op === "ping") {
          const started = Date.now();
          let torob = null;
          if (payload.checkTorob) {
            try {
              const probe = await fetchTorob(
                "https://api.torob.com/v4/search-trends/",
                sanitizeHeaders(null),
                10_000,
              );
              const challenged = looksLikeChallenge(probe.status, probe.contentType, probe.body);
              torob = {
                reachable: true,
                status: probe.status,
                ok: probe.status >= 200 && probe.status < 300 && !challenged,
                challenged,
                latencyMs: Date.now() - started,
              };
            } catch (err) {
              torob = {
                reachable: false,
                ok: false,
                challenged: false,
                latencyMs: Date.now() - started,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
          sendEncrypted(200, { ok: true, relayTs: Date.now(), torob });
          return;
        }

        if (payload.op === "fetch") {
          const target = payload.target === "site" ? "site" : "api";
          const targetUrl = resolveTorobTargetUrl(target, payload.path);
          if (!targetUrl) {
            sendEncrypted(400, { error: "Disallowed upstream path or target" });
            return;
          }
          const headers = sanitizeHeaders(payload.headers);
          const upstream = await fetchTorob(targetUrl, headers);
          sendEncrypted(200, {
            ok: true,
            status: upstream.status,
            contentType: upstream.contentType,
            body: upstream.body,
          });
          return;
        }

        sendEncrypted(400, { error: "Unknown operation" });
      } catch (err) {
        sendEncrypted(502, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });

  server.listen(port, host, () => {
    console.log(
      `[torob-relay] listening on ${host}:${port} | key=${maskKey(relayKey)} | allow-ip=${
        allowedIps.size ? [...allowedIps].join(",") : "any (encrypted auth)"
      }`,
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
