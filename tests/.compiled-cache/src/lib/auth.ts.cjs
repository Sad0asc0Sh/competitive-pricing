"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_MAX_AGE_SECONDS = exports.SESSION_COOKIE = void 0;
exports.isPlaceholderSecret = isPlaceholderSecret;
exports.timingSafeEqualStrings = timingSafeEqualStrings;
exports.getAuthConfigStatus = getAuthConfigStatus;
exports.isAuthConfigured = isAuthConfigured;
exports.isDevAuthBypassEnabled = isDevAuthBypassEnabled;
exports.isAuthEnabled = isAuthEnabled;
exports.verifyAdminPassword = verifyAdminPassword;
exports.createSessionToken = createSessionToken;
exports.inspectSessionToken = inspectSessionToken;
exports.verifySessionToken = verifySessionToken;
exports.extractSessionTokenFromRequest = extractSessionTokenFromRequest;
exports.isHttpsRequest = isHttpsRequest;
exports.getSessionCookieOptions = getSessionCookieOptions;
exports.verifyCronSecret = verifyCronSecret;
exports.extractCronSecretFromRequest = extractCronSecretFromRequest;
exports.requireAdminAuth = requireAdminAuth;
exports.requireCronOrAdminAuth = requireCronOrAdminAuth;
const crypto_1 = require("crypto");
const server_1 = require("next/server");
exports.SESSION_COOKIE = "pricing_session";
exports.SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
function isPlaceholderSecret(value) {
    if (typeof value !== "string")
        return true;
    const trimmed = value.trim();
    if (!trimmed)
        return true;
    if (/^change_me/i.test(trimmed))
        return true;
    if (/^replace_me/i.test(trimmed))
        return true;
    if (trimmed.toLowerCase() === "your-secret-here")
        return true;
    return false;
}
/**
 * Constant-time string comparison using SHA-256 digest + crypto.timingSafeEqual.
 * Never leaks length or character prefix timing.
 */
function timingSafeEqualStrings(candidate, expected) {
    if (typeof candidate !== "string" || typeof expected !== "string")
        return false;
    if (candidate.length === 0 || expected.length === 0)
        return false;
    const hashA = (0, crypto_1.createHash)("sha256").update(candidate, "utf8").digest();
    const hashB = (0, crypto_1.createHash)("sha256").update(expected, "utf8").digest();
    const digestsEqual = (0, crypto_1.timingSafeEqual)(hashA, hashB);
    const lengthsEqual = Buffer.byteLength(candidate, "utf8") === Buffer.byteLength(expected, "utf8");
    return digestsEqual && lengthsEqual;
}
function getRawAdminPassword() {
    return (process.env.ADMIN_PASSWORD || "").trim();
}
function getRawSessionSecret() {
    return (process.env.SESSION_SECRET || process.env.AUTH_SECRET || "").trim();
}
function getRawCronSecret() {
    return (process.env.CRON_SECRET || "").trim();
}
function getRawStoreSyncSecret() {
    return (process.env.STORE_SYNC_SECRET || process.env.SGEOOOLE_PRICING_SECRET || "").trim();
}
function isProductionEnv() {
    return process.env.NODE_ENV === "production";
}
/**
 * Evaluates authentication configuration and secret separation.
 * Fail-closed by default: missing ADMIN_PASSWORD never opens the app unless
 * NODE_ENV !== "production" AND ALLOW_INSECURE_DEV_AUTH === "true".
 */
function getAuthConfigStatus() {
    const prod = isProductionEnv();
    const adminPass = getRawAdminPassword();
    const sessionSec = getRawSessionSecret();
    const cronSec = getRawCronSecret();
    const storeSec = getRawStoreSyncSecret();
    const hasValidAdminPass = !isPlaceholderSecret(adminPass);
    if (!hasValidAdminPass) {
        const devBypassRequested = !prod && (process.env.ALLOW_INSECURE_DEV_AUTH || "").trim().toLowerCase() === "true";
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
function isAuthConfigured() {
    return getAuthConfigStatus().configured;
}
function isDevAuthBypassEnabled() {
    return getAuthConfigStatus().bypass;
}
/**
 * Returns true whenever authentication enforcement is active.
 * Fail-closed: returns true even when ADMIN_PASSWORD is missing, unless an
 * explicit non-production dev bypass flag (ALLOW_INSECURE_DEV_AUTH=true) is set.
 */
function isAuthEnabled() {
    return !isDevAuthBypassEnabled();
}
function resolveSigningKeyBuffer(explicitSecret) {
    if (typeof explicitSecret === "string") {
        const trimmed = explicitSecret.trim();
        if (!trimmed || isPlaceholderSecret(trimmed))
            return null;
        return (0, crypto_1.createHmac)("sha256", "competitive-pricing:session-signing-key:v2")
            .update(trimmed, "utf8")
            .digest();
    }
    const status = getAuthConfigStatus();
    if (!status.configured)
        return null;
    const sessionSec = getRawSessionSecret();
    if (sessionSec) {
        return (0, crypto_1.createHmac)("sha256", "competitive-pricing:session-signing-key:v2")
            .update(sessionSec, "utf8")
            .digest();
    }
    const adminPass = getRawAdminPassword();
    if (!adminPass || isPlaceholderSecret(adminPass))
        return null;
    return (0, crypto_1.createHmac)("sha256", "competitive-pricing:dev-derived-session-key:v2")
        .update(adminPass, "utf8")
        .digest();
}
/**
 * Verifies the admin password in constant time.
 * Fails closed (returns false) if authentication is not properly configured.
 */
function verifyAdminPassword(candidate) {
    const status = getAuthConfigStatus();
    if (!status.configured)
        return false;
    const adminPass = getRawAdminPassword();
    return timingSafeEqualStrings(candidate, adminPass);
}
/**
 * Creates a signed v2 session token containing issued-at (iat), expiration (exp),
 * and a random token ID (jti), signed with HMAC-SHA256.
 */
async function createSessionToken(opts) {
    const signingKey = resolveSigningKeyBuffer(opts?.secret);
    if (!signingKey) {
        throw new Error("Authentication signing key is not configured (Fail-Closed)");
    }
    const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
    const envTtl = Number(process.env.SESSION_TTL_SECONDS);
    const defaultTtl = Number.isFinite(envTtl) && envTtl > 0 ? Math.floor(envTtl) : exports.SESSION_MAX_AGE_SECONDS;
    const ttlSec = typeof opts?.ttlSeconds === "number" && Number.isFinite(opts.ttlSeconds)
        ? Math.floor(opts.ttlSeconds)
        : defaultTtl;
    const iat = typeof opts?.iatSeconds === "number" && Number.isFinite(opts.iatSeconds)
        ? Math.floor(opts.iatSeconds)
        : nowSec;
    const exp = typeof opts?.expSeconds === "number" && Number.isFinite(opts.expSeconds)
        ? Math.floor(opts.expSeconds)
        : iat + ttlSec;
    const payload = {
        v: 2,
        sub: "pricing-admin",
        iat,
        exp,
        jti: (0, crypto_1.randomBytes)(16).toString("hex"),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signingInput = `v2.${payloadB64}`;
    const sigB64 = (0, crypto_1.createHmac)("sha256", signingKey).update(signingInput, "utf8").digest("base64url");
    return `${signingInput}.${sigB64}`;
}
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/**
 * Inspects and verifies a session token in constant time, returning detailed diagnostics.
 */
async function inspectSessionToken(token, opts) {
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
    if ((adminPass && timingSafeEqualStrings(token, adminPass)) ||
        (sessionSec && timingSafeEqualStrings(token, sessionSec)) ||
        (cronSec && timingSafeEqualStrings(token, cronSec))) {
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
    const expectedSig = (0, crypto_1.createHmac)("sha256", signingKey).update(signingInput, "utf8").digest();
    const actualSig = Buffer.from(sigB64, "base64url");
    if (actualSig.byteLength !== expectedSig.byteLength || !(0, crypto_1.timingSafeEqual)(actualSig, expectedSig)) {
        return { valid: false, reason: "invalid_signature" };
    }
    let parsed;
    try {
        const jsonStr = Buffer.from(payloadB64, "base64url").toString("utf8");
        parsed = JSON.parse(jsonStr);
    }
    catch {
        return { valid: false, reason: "invalid_payload" };
    }
    if (!parsed || typeof parsed !== "object") {
        return { valid: false, reason: "invalid_payload" };
    }
    const p = parsed;
    if (p.v !== 2 ||
        p.sub !== "pricing-admin" ||
        typeof p.iat !== "number" ||
        !Number.isFinite(p.iat) ||
        typeof p.exp !== "number" ||
        !Number.isFinite(p.exp) ||
        typeof p.jti !== "string" ||
        p.jti.length < 8) {
        return { valid: false, reason: "invalid_payload" };
    }
    const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
    const maxClockSkewSec = 60;
    if (p.iat > nowSec + maxClockSkewSec) {
        return { valid: false, reason: "future_iat", payload: p };
    }
    if (nowSec >= p.exp || p.exp <= p.iat) {
        return { valid: false, reason: "expired", payload: p };
    }
    return { valid: true, payload: p };
}
async function verifySessionToken(token, opts) {
    const res = await inspectSessionToken(token, opts);
    return res.valid;
}
function extractSessionTokenFromRequest(req) {
    const anyReq = req;
    if (typeof anyReq.cookies?.get === "function") {
        const val = anyReq.cookies.get(exports.SESSION_COOKIE)?.value;
        if (val)
            return val;
    }
    const cookieHeader = req.headers?.get?.("cookie");
    if (!cookieHeader)
        return undefined;
    for (const part of cookieHeader.split(";")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx).trim();
        if (key === exports.SESSION_COOKIE) {
            const rawVal = part.slice(eqIdx + 1).trim();
            try {
                return decodeURIComponent(rawVal);
            }
            catch {
                return rawVal;
            }
        }
    }
    return undefined;
}
function isHttpsRequest(req) {
    if (!req)
        return false;
    const forwardedProto = req.headers?.get?.("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (forwardedProto === "https")
        return true;
    try {
        if (req.url && new URL(req.url).protocol === "https:")
            return true;
    }
    catch {
        // ignore malformed URL
    }
    return false;
}
function getSessionCookieOptions(req, maxAgeSeconds = exports.SESSION_MAX_AGE_SECONDS) {
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
function verifyCronSecret(candidate) {
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
    if ((adminPass && !isPlaceholderSecret(adminPass) && timingSafeEqualStrings(cronSec, adminPass)) ||
        (sessionSec && !isPlaceholderSecret(sessionSec) && timingSafeEqualStrings(cronSec, sessionSec))) {
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
function extractCronSecretFromRequest(req) {
    const authHeader = req.headers?.get?.("authorization") || "";
    if (/^bearer\s+/i.test(authHeader)) {
        const bearer = authHeader.replace(/^bearer\s+/i, "").trim();
        if (bearer)
            return bearer;
    }
    const headerSecret = req.headers?.get?.("x-cron-secret")?.trim();
    if (headerSecret)
        return headerSecret;
    return undefined;
}
/**
 * Defence-in-depth guard for administrative API route handlers.
 * Returns null if authorized, or a NextResponse (401 / 503) if rejected.
 */
async function requireAdminAuth(req) {
    const status = getAuthConfigStatus();
    if (status.bypass) {
        return null;
    }
    if (!status.configured) {
        return server_1.NextResponse.json({
            ok: false,
            error: "احراز هویت ادمین پیکربندی نشده است (Fail-Closed).",
            reason: status.reason || "Authentication not configured",
        }, { status: 503 });
    }
    const token = extractSessionTokenFromRequest(req);
    const verification = await inspectSessionToken(token);
    if (!verification.valid) {
        return server_1.NextResponse.json({
            ok: false,
            error: "نشست کاربری معتبر نیست یا منقضی شده است (Unauthorized).",
            reason: verification.reason,
        }, { status: 401 });
    }
    return null;
}
/**
 * Guard for /api/cron and /api/scheduler/tick.
 * Allows either a valid admin session cookie OR a valid CRON_SECRET bearer/header token.
 * Fails closed when neither is valid (and when CRON_SECRET is unconfigured for non-session callers).
 */
async function requireCronOrAdminAuth(req) {
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
        return server_1.NextResponse.json({ ok: false, error: cronCheck.error || "Unauthorized" }, { status: cronCheck.status });
    }
    return null;
}
