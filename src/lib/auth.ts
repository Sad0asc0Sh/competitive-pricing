import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "pricing_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthConfigStatus {
  configured: boolean;
  bypass: boolean;
  mode: "enforced" | "dev_bypass" | "misconfigured";
  reason?: string;
  usingDerivedSessionKey?: boolean;
}

export interface SessionTokenPayload {
  v: 2;
  sub: "pricing-admin";
  iat: number;
  exp: number;
  jti: string;
}

export interface CreateSessionTokenOptions {
  nowMs?: number;
  ttlSeconds?: number;
  secret?: string;
  iatSeconds?: number;
  expSeconds?: number;
}

export interface VerifySessionTokenOptions {
  nowMs?: number;
  secret?: string;
}

export interface SessionVerificationResult {
  valid: boolean;
  reason?:
    | "missing_token"
    | "auth_not_configured"
    | "raw_secret_rejected"
    | "malformed_token"
    | "unsupported_version"
    | "invalid_signature"
    | "invalid_payload"
    | "future_iat"
    | "expired";
  payload?: SessionTokenPayload;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax" | "strict";
  path: "/";
  maxAge: number;
  secure: boolean;
}

export function isPlaceholderSecret(value?: string | null): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^change_me/i.test(trimmed)) return true;
  if (/^replace_me/i.test(trimmed)) return true;
  if (trimmed.toLowerCase() === "your-secret-here") return true;
  return false;
}

/**
 * Constant-time string comparison using SHA-256 digest + crypto.timingSafeEqual.
 * Never leaks length or character prefix timing.
 */
export function timingSafeEqualStrings(candidate: string, expected: string): boolean {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  if (candidate.length === 0 || expected.length === 0) return false;
  const hashA = createHash("sha256").update(candidate, "utf8").digest();
  const hashB = createHash("sha256").update(expected, "utf8").digest();
  const digestsEqual = timingSafeEqual(hashA, hashB);
  const lengthsEqual = Buffer.byteLength(candidate, "utf8") === Buffer.byteLength(expected, "utf8");
  return digestsEqual && lengthsEqual;
}

function getRawAdminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim();
}

function getRawSessionSecret(): string {
  return (process.env.SESSION_SECRET || process.env.AUTH_SECRET || "").trim();
}

function getRawCronSecret(): string {
  return (process.env.CRON_SECRET || "").trim();
}

function getRawStoreSyncSecret(): string {
  return (process.env.STORE_SYNC_SECRET || process.env.SGEOOOLE_PRICING_SECRET || "").trim();
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Evaluates authentication configuration and secret separation.
 * Fail-closed by default: missing ADMIN_PASSWORD never opens the app unless
 * NODE_ENV !== "production" AND ALLOW_INSECURE_DEV_AUTH === "true".
 */
export function getAuthConfigStatus(): AuthConfigStatus {
  const prod = isProductionEnv();
  const adminPass = getRawAdminPassword();
  const sessionSec = getRawSessionSecret();
  const cronSec = getRawCronSecret();
  const storeSec = getRawStoreSyncSecret();

  const hasValidAdminPass = !isPlaceholderSecret(adminPass);

  if (!hasValidAdminPass) {
    const devBypassRequested =
      !prod && (process.env.ALLOW_INSECURE_DEV_AUTH || "").trim().toLowerCase() === "true";
    if (devBypassRequested) {
      return {
        configured: false,
        bypass: true,
        mode: "dev_bypass",
        reason: "Explicit ALLOW_INSECURE_DEV_AUTH=true in non-production environment",
      };
    }
    return {
      configured: false,
      bypass: false,
      mode: "misconfigured",
      reason: isPlaceholderSecret(adminPass) && adminPass
        ? "ADMIN_PASSWORD is set to a placeholder value"
        : "ADMIN_PASSWORD is not configured",
    };
  }

  // Secret separation enforcement
  if (sessionSec) {
    if (isPlaceholderSecret(sessionSec)) {
      return {
        configured: false,
        bypass: false,
        mode: "misconfigured",
        reason: "SESSION_SECRET / AUTH_SECRET is set to a placeholder value",
      };
    }
    if (timingSafeEqualStrings(sessionSec, adminPass)) {
      return {
        configured: false,
        bypass: false,
        mode: "misconfigured",
        reason: "SESSION_SECRET must be distinct from ADMIN_PASSWORD",
      };
    }
    if (cronSec && !isPlaceholderSecret(cronSec) && timingSafeEqualStrings(sessionSec, cronSec)) {
      return {
        configured: false,
        bypass: false,
        mode: "misconfigured",
        reason: "SESSION_SECRET must be distinct from CRON_SECRET",
      };
    }
    if (storeSec && !isPlaceholderSecret(storeSec) && timingSafeEqualStrings(sessionSec, storeSec)) {
      return {
        configured: false,
        bypass: false,
        mode: "misconfigured",
        reason: "SESSION_SECRET must be distinct from STORE_SYNC_SECRET / SGEOOOLE_PRICING_SECRET",
      };
    }
    return {
      configured: true,
      bypass: false,
      mode: "enforced",
      usingDerivedSessionKey: false,
    };
  }

  // Missing explicit SESSION_SECRET / AUTH_SECRET:
  // In production, require explicit SESSION_SECRET (fail-closed).
  if (prod) {
    return {
      configured: false,
      bypass: false,
      mode: "misconfigured",
      reason: "SESSION_SECRET (or AUTH_SECRET) is required in production",
    };
  }

  // In non-production, derive a domain-separated key from ADMIN_PASSWORD so the
  // raw ADMIN_PASSWORD is never used directly as the signing key or cookie.
  return {
    configured: true,
    bypass: false,
    mode: "enforced",
    usingDerivedSessionKey: true,
  };
}

export function isAuthConfigured(): boolean {
  return getAuthConfigStatus().configured;
}

export function isDevAuthBypassEnabled(): boolean {
  return getAuthConfigStatus().bypass;
}

/**
 * Returns true whenever authentication enforcement is active.
 * Fail-closed: returns true even when ADMIN_PASSWORD is missing, unless an
 * explicit non-production dev bypass flag (ALLOW_INSECURE_DEV_AUTH=true) is set.
 */
export function isAuthEnabled(): boolean {
  return !isDevAuthBypassEnabled();
}

function resolveSigningKeyBuffer(explicitSecret?: string): Buffer | null {
  if (typeof explicitSecret === "string") {
    const trimmed = explicitSecret.trim();
    if (!trimmed || isPlaceholderSecret(trimmed)) return null;
    return createHmac("sha256", "competitive-pricing:session-signing-key:v2")
      .update(trimmed, "utf8")
      .digest();
  }

  const status = getAuthConfigStatus();
  if (!status.configured) return null;

  const sessionSec = getRawSessionSecret();
  if (sessionSec) {
    return createHmac("sha256", "competitive-pricing:session-signing-key:v2")
      .update(sessionSec, "utf8")
      .digest();
  }

  const adminPass = getRawAdminPassword();
  if (!adminPass || isPlaceholderSecret(adminPass)) return null;
  return createHmac("sha256", "competitive-pricing:dev-derived-session-key:v2")
    .update(adminPass, "utf8")
    .digest();
}

/**
 * Verifies the admin password in constant time.
 * Fails closed (returns false) if authentication is not properly configured.
 */
export function verifyAdminPassword(candidate: string): boolean {
  const status = getAuthConfigStatus();
  if (!status.configured) return false;
  const adminPass = getRawAdminPassword();
  return timingSafeEqualStrings(candidate, adminPass);
}

/**
 * Creates a signed v2 session token containing issued-at (iat), expiration (exp),
 * and a random token ID (jti), signed with HMAC-SHA256.
 */
export async function createSessionToken(opts?: CreateSessionTokenOptions): Promise<string> {
  const signingKey = resolveSigningKeyBuffer(opts?.secret);
  if (!signingKey) {
    throw new Error("Authentication signing key is not configured (Fail-Closed)");
  }

  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  const envTtl = Number(process.env.SESSION_TTL_SECONDS);
  const defaultTtl =
    Number.isFinite(envTtl) && envTtl > 0 ? Math.floor(envTtl) : SESSION_MAX_AGE_SECONDS;
  const ttlSec =
    typeof opts?.ttlSeconds === "number" && Number.isFinite(opts.ttlSeconds)
      ? Math.floor(opts.ttlSeconds)
      : defaultTtl;

  const iat =
    typeof opts?.iatSeconds === "number" && Number.isFinite(opts.iatSeconds)
      ? Math.floor(opts.iatSeconds)
      : nowSec;
  const exp =
    typeof opts?.expSeconds === "number" && Number.isFinite(opts.expSeconds)
      ? Math.floor(opts.expSeconds)
      : iat + ttlSec;

  const payload: SessionTokenPayload = {
    v: 2,
    sub: "pricing-admin",
    iat,
    exp,
    jti: randomBytes(16).toString("hex"),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `v2.${payloadB64}`;
  const sigB64 = createHmac("sha256", signingKey).update(signingInput, "utf8").digest("base64url");
  return `${signingInput}.${sigB64}`;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Inspects and verifies a session token in constant time, returning detailed diagnostics.
 */
export async function inspectSessionToken(
  token?: string | null,
  opts?: VerifySessionTokenOptions
): Promise<SessionVerificationResult> {
  if (!token || typeof token !== "string" || token.length > 4096) {
    return { valid: false, reason: "missing_token" };
  }

  const signingKey = resolveSigningKeyBuffer(opts?.secret);
  if (!signingKey) {
    return { valid: false, reason: "auth_not_configured" };
  }

  // Never accept raw ADMIN_PASSWORD, SESSION_SECRET, or CRON_SECRET as a cookie value
  const adminPass = getRawAdminPassword();
  const sessionSec = getRawSessionSecret();
  const cronSec = getRawCronSecret();
  if (
    (adminPass && timingSafeEqualStrings(token, adminPass)) ||
    (sessionSec && timingSafeEqualStrings(token, sessionSec)) ||
    (cronSec && timingSafeEqualStrings(token, cronSec))
  ) {
    return { valid: false, reason: "raw_secret_rejected" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed_token" };
  }

  const [version, payloadB64, sigB64] = parts;
  if (version !== "v2") {
    return { valid: false, reason: "unsupported_version" };
  }
  if (!payloadB64 || !sigB64 || !BASE64URL_RE.test(payloadB64) || !BASE64URL_RE.test(sigB64)) {
    return { valid: false, reason: "malformed_token" };
  }

  const signingInput = `v2.${payloadB64}`;
  const expectedSig = createHmac("sha256", signingKey).update(signingInput, "utf8").digest();
  const actualSig = Buffer.from(sigB64, "base64url");

  if (actualSig.byteLength !== expectedSig.byteLength || !timingSafeEqual(actualSig, expectedSig)) {
    return { valid: false, reason: "invalid_signature" };
  }

  let parsed: unknown;
  try {
    const jsonStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    parsed = JSON.parse(jsonStr);
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, reason: "invalid_payload" };
  }

  const p = parsed as Partial<SessionTokenPayload>;
  if (
    p.v !== 2 ||
    p.sub !== "pricing-admin" ||
    typeof p.iat !== "number" ||
    !Number.isFinite(p.iat) ||
    typeof p.exp !== "number" ||
    !Number.isFinite(p.exp) ||
    typeof p.jti !== "string" ||
    p.jti.length < 8
  ) {
    return { valid: false, reason: "invalid_payload" };
  }

  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  const maxClockSkewSec = 60;

  if (p.iat > nowSec + maxClockSkewSec) {
    return { valid: false, reason: "future_iat", payload: p as SessionTokenPayload };
  }

  if (nowSec >= p.exp || p.exp <= p.iat) {
    return { valid: false, reason: "expired", payload: p as SessionTokenPayload };
  }

  return { valid: true, payload: p as SessionTokenPayload };
}

export async function verifySessionToken(
  token?: string | null,
  opts?: VerifySessionTokenOptions
): Promise<boolean> {
  const res = await inspectSessionToken(token, opts);
  return res.valid;
}

export function extractSessionTokenFromRequest(req: Request): string | undefined {
  const anyReq = req as Request & {
    cookies?: { get?: (name: string) => { value?: string } | undefined };
  };
  if (typeof anyReq.cookies?.get === "function") {
    const val = anyReq.cookies.get(SESSION_COOKIE)?.value;
    if (val) return val;
  }

  const cookieHeader = req.headers?.get?.("cookie");
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === SESSION_COOKIE) {
      const rawVal = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return undefined;
}

export function isHttpsRequest(req?: Request): boolean {
  if (!req) return false;
  const forwardedProto = req.headers?.get?.("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  try {
    if (req.url && new URL(req.url).protocol === "https:") return true;
  } catch {
    // ignore malformed URL
  }
  return false;
}

export function getSessionCookieOptions(
  req?: Request,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
    secure: isProductionEnv() || isHttpsRequest(req),
  };
}

/**
 * Verifies CRON_SECRET in constant time and enforces secret separation.
 * Fails closed when CRON_SECRET is missing or a placeholder in ALL environments.
 */
export function verifyCronSecret(candidate?: string | null): {
  ok: boolean;
  status: number;
  error?: string;
} {
  const cronSec = getRawCronSecret();
  if (!cronSec || isPlaceholderSecret(cronSec)) {
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET is not configured (Fail-Closed)",
    };
  }

  const adminPass = getRawAdminPassword();
  const sessionSec = getRawSessionSecret();
  if (
    (adminPass && !isPlaceholderSecret(adminPass) && timingSafeEqualStrings(cronSec, adminPass)) ||
    (sessionSec && !isPlaceholderSecret(sessionSec) && timingSafeEqualStrings(cronSec, sessionSec))
  ) {
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET must be distinct from ADMIN_PASSWORD and SESSION_SECRET",
    };
  }

  if (!candidate || typeof candidate !== "string") {
    return {
      ok: false,
      status: 401,
      error: "Missing cron authentication token",
    };
  }

  if (!timingSafeEqualStrings(candidate.trim(), cronSec)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid cron authentication token",
    };
  }

  return { ok: true, status: 200 };
}

export function extractCronSecretFromRequest(req: Request): string | undefined {
  const authHeader = req.headers?.get?.("authorization") || "";
  if (/^bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const headerSecret = req.headers?.get?.("x-cron-secret")?.trim();
  if (headerSecret) return headerSecret;
  return undefined;
}

/**
 * Defence-in-depth guard for administrative API route handlers.
 * Returns null if authorized, or a NextResponse (401 / 503) if rejected.
 */
export async function requireAdminAuth(req: Request): Promise<NextResponse | null> {
  const status = getAuthConfigStatus();
  if (status.bypass) {
    return null;
  }
  if (!status.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "احراز هویت ادمین پیکربندی نشده است (Fail-Closed).",
        reason: status.reason || "Authentication not configured",
      },
      { status: 503 }
    );
  }

  const token = extractSessionTokenFromRequest(req);
  const verification = await inspectSessionToken(token);
  if (!verification.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: "نشست کاربری معتبر نیست یا منقضی شده است (Unauthorized).",
        reason: verification.reason,
      },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Guard for /api/cron and /api/scheduler/tick.
 * Allows either a valid admin session cookie OR a valid CRON_SECRET bearer/header token.
 * Fails closed when neither is valid (and when CRON_SECRET is unconfigured for non-session callers).
 */
export async function requireCronOrAdminAuth(req: Request): Promise<NextResponse | null> {
  const status = getAuthConfigStatus();
  if (status.bypass) {
    return null;
  }

  // 1. Check if caller has a valid admin session cookie
  const sessionToken = extractSessionTokenFromRequest(req);
  if (sessionToken && status.configured) {
    const sessionCheck = await inspectSessionToken(sessionToken);
    if (sessionCheck.valid) {
      return null;
    }
  }

  // 2. Otherwise require valid CRON_SECRET header/bearer token (fail-closed)
  const providedCronSecret = extractCronSecretFromRequest(req);
  const cronCheck = verifyCronSecret(providedCronSecret);
  if (!cronCheck.ok) {
    return NextResponse.json(
      { ok: false, error: cronCheck.error || "Unauthorized" },
      { status: cronCheck.status }
    );
  }

  return null;
}
