"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DETAILS_RECOVERY_POLICY = exports.TOROB_DETAILS_FAILURE_MESSAGES = void 0;
exports.retrieveTorobDetailsWithRecovery = retrieveTorobDetailsWithRecovery;
exports.detailsFailureOf = detailsFailureOf;
exports.TOROB_DETAILS_FAILURE_MESSAGES = {
    MCP_DETAILS_TIMEOUT: "مهلت دریافت جزئیات کارت ترب از سرور MCP پایان یافت؛ تلاش بازیابی در مهلت کل جا نشد",
    TOROB_DETAILS_TIMEOUT: "مهلت دریافت جزئیات از مسیر مستقیم ترب پایان یافت",
    DETAILS_GLOBAL_DEADLINE_EXCEEDED: "بودجهٔ کل استعلام جزئیات پیش از دریافت پاسخ کامل به پایان رسید",
    DETAILS_NOT_ATTEMPTED: "هیچ درخواست جزئیاتی برای این کارت آغاز نشد",
    DETAILS_EXTRACTION_INCOMPLETE: "پاسخ ترب دریافت شد ولی ساختار آن ناقص بود و استخراج کامل نشد",
    ACCESS_RESTRICTED: "ترب دسترسی دریافت جزئیات را محدود کرده است",
    ACCESS_CHALLENGE: "ترب این درخواست را با چالش امنیتی متوقف کرده است",
    RATE_LIMITED: "ترب این درخواست را به‌دلیل محدودیت نرخ متوقف کرده است (429)",
    WRONG_PRK: "شناسهٔ پاسخ جزئیات با کارت درخواست‌شده متفاوت است",
    CONNECTION_FAILURE: "اتصال به سرور ترب/MCP برقرار نشد",
    UPSTREAM_ERROR: "سرور ترب/MCP خطای سطح بالامرحله برگرداند",
};
/** سیاست پیش‌فرض — اعداد با بنچمارک fault-injection (eval/matching/details-resilience-benchmark.cjs) تنظیم شده‌اند */
exports.DEFAULT_DETAILS_RECOVERY_POLICY = {
    firstAttemptShare: 0.6,
    firstAttemptMinMs: 900,
    firstAttemptMaxMs: 7_000,
    recoveryAttemptShare: 0.7,
    recoveryAttemptMinMs: 800,
    entryMinMs: 400,
    fallbackMinMs: 500,
    backoffBaseMs: 120,
    backoffJitterMs: 120,
    maxAttemptsPerTransport: 2,
};
const RETRYABLE_KINDS = new Set([
    "MCP_DETAILS_TIMEOUT",
    "TOROB_DETAILS_TIMEOUT",
    "CONNECTION_FAILURE",
    "UPSTREAM_ERROR",
]);
/** مسیر دوم فقط برای خطاهایی که «ممکن است در مسیر دیگر جواب بدهند»؛ دسترسی/نرخ/شناسهٔ ناهمخوان هرگز */
const FALLBACK_ALLOWED_KINDS = new Set([
    "MCP_DETAILS_TIMEOUT",
    "TOROB_DETAILS_TIMEOUT",
    "CONNECTION_FAILURE",
    "UPSTREAM_ERROR",
    "DETAILS_EXTRACTION_INCOMPLETE",
]);
function classifyDetailsRead(read, transport) {
    if (!read.issue && !read.unavailable && !read.blocked && !read.challenged)
        return null;
    const issue = read.issue ?? "";
    // 429 پیش از عمومیِ blocked طبقه‌بندی می‌شود تا کد اختصاصی RATE_LIMITED حفظ شود
    if (issue === "access_rate_limited" || /(?:^|_)http_429$/.test(issue))
        return { kind: "RATE_LIMITED", code: issue };
    if (read.challenged || issue.includes("challenge"))
        return { kind: "ACCESS_CHALLENGE", code: issue || "access_challenge" };
    if (read.blocked || /(?:^|_)http_(?:401|403)$/.test(issue))
        return { kind: "ACCESS_RESTRICTED", code: issue || "access_restricted" };
    // «یافت نشد» گذرا نیست — تلاش دوباره/fallback فقط درخواست اضافه است (کارت وجود ندارد یا شناسه غلط است)
    if (issue === "details_prk_mismatch" || issue === "not_found" || issue === "details_not_found") {
        return { kind: "WRONG_PRK", code: issue };
    }
    if (issue === "details_timeout" || issue === "mcp_timeout" || issue === "torob_timeout" || issue === "details_timeout_direct") {
        return { kind: transport === "mcp" ? "MCP_DETAILS_TIMEOUT" : "TOROB_DETAILS_TIMEOUT", code: issue };
    }
    if (issue === "mcp_connection" || issue === "torob_connection" || issue === "mcp_connect" || issue.includes("connection")) {
        return { kind: "CONNECTION_FAILURE", code: issue };
    }
    if (issue === "details_schema" || issue === "mcp_response_schema" || issue === "search_schema") {
        return { kind: "DETAILS_EXTRACTION_INCOMPLETE", code: issue };
    }
    if (/(?:^|_)http_\d{3}$/.test(issue))
        return { kind: "UPSTREAM_ERROR", code: issue };
    if (issue === "details_budget_exhausted")
        return { kind: "DETAILS_NOT_ATTEMPTED", code: issue };
    if (read.unavailable)
        return { kind: transport === "mcp" ? "UPSTREAM_ERROR" : "TOROB_DETAILS_TIMEOUT", code: issue || "unavailable" };
    return { kind: "DETAILS_EXTRACTION_INCOMPLETE", code: issue || "unknown" };
}
function httpStatusOf(read) {
    const match = /(?:^|_)http_(\d{3})$/.exec(read.issue ?? "");
    return match ? Number(match[1]) : null;
}
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
/** باکس‌اسیکنال محدود با جیتر — فقط بین تلاش‌های گذرا؛ deterministic در تست با تزریق jitter ثابت */
function backoffDelayMs(baseMs, jitterMs) {
    const jitter = jitterMs > 0 ? Math.floor((Date.now() * 7919) % jitterMs) : 0;
    return baseMs + jitter;
}
async function retrieveTorobDetailsWithRecovery(opts) {
    const policy = { ...exports.DEFAULT_DETAILS_RECOVERY_POLICY, ...opts.policy };
    const startedAt = Date.now();
    const deadline = startedAt + opts.timeoutMs;
    const attempts = [];
    const push = (trace) => {
        attempts.push(trace);
        opts.onTrace?.(trace);
    };
    const remainingAt = () => Math.max(0, deadline - Date.now());
    let lastFailure = null;
    if (opts.timeoutMs <= 0 || remainingAt() < policy.entryMinMs || opts.transports.length === 0) {
        const failure = {
            kind: "DETAILS_NOT_ATTEMPTED",
            message: exports.TOROB_DETAILS_FAILURE_MESSAGES.DETAILS_NOT_ATTEMPTED,
            code: "details_budget_exhausted",
        };
        push({
            prk: opts.prk,
            transport: opts.transports[0]?.kind ?? "mcp",
            attempt: 0,
            startedAt: new Date(startedAt).toISOString(),
            durationMs: 0,
            timeoutMs: 0,
            remainingDeadlineMs: remainingAt(),
            httpStatus: null,
            cacheHit: false,
            coldStart: opts.coldStart ?? false,
            fallbackAttempted: false,
            failureKind: failure.kind,
            failureCode: failure.code,
            correlationId: opts.correlationId,
            recoveredByLaterAttempt: false,
        });
        return {
            read: { issue: "details_budget_exhausted", unavailable: true, detailsFailure: failure },
            failure,
            attempts,
            recovered: false,
        };
    }
    let attemptNo = 0;
    let lastRawRead = null;
    // وقتی مسیر دوم (fallback) موجود است، تلاش بازیابیِ مسیر اول حق ندارد کل باقیمانده را بلعیده باشد
    const fallbackReserve = opts.transports.length > 1 ? policy.fallbackMinMs : 0;
    for (let tIdx = 0; tIdx < opts.transports.length; tIdx++) {
        const transport = opts.transports[tIdx];
        const isFallbackTransport = tIdx > 0;
        let transportAttempts = 0;
        let priorFailure = isFallbackTransport ? lastFailure : null;
        while (transportAttempts < policy.maxAttemptsPerTransport) {
            const remaining = remainingAt();
            const isRecoveryAttempt = transportAttempts > 0;
            if (isRecoveryAttempt) {
                if (priorFailure && !RETRYABLE_KINDS.has(priorFailure.kind))
                    break;
                const waitMs = backoffDelayMs(policy.backoffBaseMs, policy.backoffJitterMs);
                if (remaining - waitMs < policy.recoveryAttemptMinMs)
                    break;
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
            else if (isFallbackTransport) {
                if (priorFailure && !FALLBACK_ALLOWED_KINDS.has(priorFailure.kind))
                    break;
                if (remaining < policy.fallbackMinMs)
                    break;
            }
            else if (remaining < policy.entryMinMs) {
                break;
            }
            const remainingBefore = remainingAt();
            const allocatedTimeoutMs = isRecoveryAttempt
                ? (() => {
                    const recoveryBudget = Math.max(0, remainingBefore - fallbackReserve);
                    if (recoveryBudget < policy.recoveryAttemptMinMs)
                        return -1; // باقیمانده برای fallback نگه داشته می‌شود
                    return clamp(Math.round(recoveryBudget * policy.recoveryAttemptShare), policy.recoveryAttemptMinMs, recoveryBudget);
                })()
                : tIdx === 0
                    ? clamp(Math.round(opts.timeoutMs * policy.firstAttemptShare), policy.firstAttemptMinMs, Math.min(policy.firstAttemptMaxMs, remainingBefore))
                    : remainingBefore;
            if (allocatedTimeoutMs < 0)
                break;
            attemptNo += 1;
            const attemptStartedAt = Date.now();
            let read;
            try {
                read = await transport.run(allocatedTimeoutMs);
            }
            catch (error) {
                read = {
                    issue: transport.kind === "mcp" ? "mcp_connection" : "torob_connection",
                    unavailable: true,
                    ...(error instanceof Error && /abort/i.test(error.name + " " + error.message) ? { issue: "details_timeout" } : {}),
                };
            }
            const durationMs = Date.now() - attemptStartedAt;
            lastRawRead = read;
            const usable = transport.isUsable ? transport.isUsable(read) : Boolean(read.data && !read.issue && !read.unavailable && !read.blocked);
            const classified = usable ? null : classifyDetailsRead(read, transport.kind) ?? {
                kind: "DETAILS_EXTRACTION_INCOMPLETE",
                code: read.issue ?? "unusable_response",
            };
            const failure = classified
                ? { kind: classified.kind, message: exports.TOROB_DETAILS_FAILURE_MESSAGES[classified.kind], code: classified.code }
                : null;
            const trace = {
                prk: opts.prk,
                transport: transport.kind,
                attempt: attemptNo,
                startedAt: new Date(attemptStartedAt).toISOString(),
                durationMs,
                timeoutMs: allocatedTimeoutMs,
                remainingDeadlineMs: remainingBefore,
                httpStatus: httpStatusOf(read),
                cacheHit: false,
                coldStart: opts.coldStart === true && attemptNo === 1,
                fallbackAttempted: isFallbackTransport,
                failureKind: failure?.kind ?? null,
                failureCode: failure?.code ?? null,
                correlationId: opts.correlationId,
                recoveredByLaterAttempt: false,
            };
            push(trace);
            if (!failure) {
                for (const earlier of attempts) {
                    if (earlier !== trace && earlier.failureKind !== null)
                        earlier.recoveredByLaterAttempt = true;
                }
                return { read, failure: null, attempts, recovered: attempts.some((a) => a.failureKind !== null) };
            }
            lastFailure = failure;
            priorFailure = failure;
            transportAttempts += 1;
            if (remainingAt() < policy.entryMinMs)
                break;
        }
    }
    // شکست نهایی: پرچم‌های لایهٔ حمل‌ونقل (blocked/challenged/origin) و دادهٔ جزئیِ آخرین پاسخ حفظ می‌شوند
    const failureRead = {
        ...(lastRawRead ?? {}),
        issue: lastFailure?.code ?? "details_failure",
        unavailable: true,
        detailsFailure: lastFailure,
    };
    return {
        read: failureRead,
        failure: lastFailure,
        attempts,
        recovered: attempts.some((a) => a.failureKind !== null && a.recoveredByLaterAttempt),
    };
}
/** ساخت پیام نهایی برای meta/detailsFailure از روی آخرین شکست */
function detailsFailureOf(kind, code) {
    return { kind, message: exports.TOROB_DETAILS_FAILURE_MESSAGES[kind], code: code ?? null };
}
