import type { TorobRead } from "./torob-discovery";
import type { TorobDetailsData } from "./torob-payload";

/**
 * بازیابی تاب‌آور جزئیات کارت ترب (سند P0 «Eliminate Avoidable First-Inquiry Torob Details Timeouts»):
 * یک مهلتٔ کل برای عملیات دریافت جزئیات؛ بودجهٔ اولین تلاش بخشی از آن است نه همهٔ آن؛ یک تلاش بازیابی
 * محدود فقط برای خطاهای گذرا؛ سپس مسیر مستقیم ترب اگر بودجه باقی مانده باشد. خطاهای غیرگذرا
 * (۴۰۱/۴۰۳/۴۲۹/چالش/شناسهٔ ناهمخوان) هرگز مثل timeout معمولی تکرار نمی‌شوند.
 */

export type TorobDetailsFailureKind =
  | "MCP_DETAILS_TIMEOUT"
  | "TOROB_DETAILS_TIMEOUT"
  | "DETAILS_GLOBAL_DEADLINE_EXCEEDED"
  | "DETAILS_NOT_ATTEMPTED"
  | "DETAILS_EXTRACTION_INCOMPLETE"
  | "ACCESS_RESTRICTED"
  | "ACCESS_CHALLENGE"
  | "RATE_LIMITED"
  | "WRONG_PRK"
  | "CONNECTION_FAILURE"
  | "UPSTREAM_ERROR";

export interface TorobDetailsFailure {
  kind: TorobDetailsFailureKind;
  /** پیام کاربر-روبهرو و مخصوص همین طبقه؛ پیام‌های عمومی timeout جای آن نمی‌نشینند */
  message: string;
  /** کد issue خام لایهٔ حمل‌ونقل (مثل mcp_timeout / mcp_http_429) برای ممیزی */
  code: string | null;
}

export interface TorobDetailsAttemptTrace {
  prk: string;
  transport: "mcp" | "torob_direct";
  attempt: number;
  startedAt: string;
  durationMs: number;
  /** مهلتی که به این تلاش اختصاص یافت */
  timeoutMs: number;
  /** مهلت باقی‌ماندهٔ کل عملیات در شروع تلاش */
  remainingDeadlineMs: number;
  httpStatus: number | null;
  cacheHit: boolean;
  /** اولین تلاش جزئیات در این استعلام (شروع سرد MCP/ریلی محتمل است) */
  coldStart: boolean;
  fallbackAttempted: boolean;
  failureKind: TorobDetailsFailureKind | null;
  failureCode: string | null;
  correlationId: string;
  /** تلاش‌های بعدی همان PRK موفق شدند؟ */
  recoveredByLaterAttempt: boolean;
}

export type TorobDetailsFailureMessageMap = Record<TorobDetailsFailureKind, string>;

export const TOROB_DETAILS_FAILURE_MESSAGES: TorobDetailsFailureMessageMap = {
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

export interface TorobDetailsRecoveryPolicy {
  /** سهم اولین تلاش از مهلت کل عملیات بازیابی */
  firstAttemptShare: number;
  firstAttemptMinMs: number;
  firstAttemptMaxMs: number;
  /** سهم تلاش بازیابی از باقیماندهٔ مهلت */
  recoveryAttemptShare: number;
  recoveryAttemptMinMs: number;
  /** کمترین مهلت برای آنکه یک تلاش اصلاً آغاز شود */
  entryMinMs: number;
  /** کمترین مهلت برای آنکه fallback مسیر دوم آغاز شود */
  fallbackMinMs: number;
  backoffBaseMs: number;
  backoffJitterMs: number;
  /** حداکثر تلاش در هر مسیر حمل‌ونقل (۱ تلاش اصلی + ۱ بازیابی) */
  maxAttemptsPerTransport: number;
}

/** سیاست پیش‌فرض — اعداد با بنچمارک fault-injection (eval/matching/details-resilience-benchmark.cjs) تنظیم شده‌اند */
export const DEFAULT_DETAILS_RECOVERY_POLICY: TorobDetailsRecoveryPolicy = {
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

const RETRYABLE_KINDS: ReadonlySet<TorobDetailsFailureKind> = new Set([
  "MCP_DETAILS_TIMEOUT",
  "TOROB_DETAILS_TIMEOUT",
  "CONNECTION_FAILURE",
  "UPSTREAM_ERROR",
]);
/** مسیر دوم فقط برای خطاهایی که «ممکن است در مسیر دیگر جواب بدهند»؛ دسترسی/نرخ/شناسهٔ ناهمخوان هرگز */
const FALLBACK_ALLOWED_KINDS: ReadonlySet<TorobDetailsFailureKind> = new Set([
  "MCP_DETAILS_TIMEOUT",
  "TOROB_DETAILS_TIMEOUT",
  "CONNECTION_FAILURE",
  "UPSTREAM_ERROR",
  "DETAILS_EXTRACTION_INCOMPLETE",
]);

export interface TorobDetailsTransport {
  kind: "mcp" | "torob_direct";
  /** اجرای یک تلاش با مهلت داده‌شده؛ خروجی TorobRead با issue طبقه‌بندی‌شدهٔ لایهٔ حمل‌ونقل */
  run: (timeoutMs: number) => Promise<TorobRead<TorobDetailsData>>;
  /** پاسخ «قابل استفاده» است؟ (پیش‌فرض: داده موجود و بدون issue) — مثلاً عنوان غایب قابل استفاده نیست */
  isUsable?: (read: TorobRead<TorobDetailsData>) => boolean;
}

export interface TorobDetailsRecoveryResult {
  read: TorobRead<TorobDetailsData>;
  failure: TorobDetailsFailure | null;
  attempts: TorobDetailsAttemptTrace[];
  /** حداقل یک تلاشِ قبلیِ ناموفق، با تلاش بعدی جبران شد */
  recovered: boolean;
}

function classifyDetailsRead(
  read: TorobRead<TorobDetailsData>,
  transport: "mcp" | "torob_direct",
): { kind: TorobDetailsFailureKind; code: string | null } | null {
  if (!read.issue && !read.unavailable && !read.blocked && !read.challenged) return null;
  const issue = read.issue ?? "";
  // 429 پیش از عمومیِ blocked طبقه‌بندی می‌شود تا کد اختصاصی RATE_LIMITED حفظ شود
  if (issue === "access_rate_limited" || /(?:^|_)http_429$/.test(issue)) return { kind: "RATE_LIMITED", code: issue };
  if (read.challenged || issue.includes("challenge")) return { kind: "ACCESS_CHALLENGE", code: issue || "access_challenge" };
  if (read.blocked || /(?:^|_)http_(?:401|403)$/.test(issue)) return { kind: "ACCESS_RESTRICTED", code: issue || "access_restricted" };
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
  if (/(?:^|_)http_\d{3}$/.test(issue)) return { kind: "UPSTREAM_ERROR", code: issue };
  if (issue === "details_budget_exhausted") return { kind: "DETAILS_NOT_ATTEMPTED", code: issue };
  if (read.unavailable) return { kind: transport === "mcp" ? "UPSTREAM_ERROR" : "TOROB_DETAILS_TIMEOUT", code: issue || "unavailable" };
  return { kind: "DETAILS_EXTRACTION_INCOMPLETE", code: issue || "unknown" };
}

function httpStatusOf(read: TorobRead<TorobDetailsData>): number | null {
  const match = /(?:^|_)http_(\d{3})$/.exec(read.issue ?? "");
  return match ? Number(match[1]) : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** باکس‌اسیکنال محدود با جیتر — فقط بین تلاش‌های گذرا؛ deterministic در تست با تزریق jitter ثابت */
function backoffDelayMs(baseMs: number, jitterMs: number): number {
  const jitter = jitterMs > 0 ? Math.floor((Date.now() * 7919) % jitterMs) : 0;
  return baseMs + jitter;
}

export async function retrieveTorobDetailsWithRecovery(opts: {
  prk: string;
  correlationId: string;
  /** کل مهلت عملیات بازیابی برای این کارت (از بودجهٔ استعلام) */
  timeoutMs: number;
  transports: TorobDetailsTransport[];
  onTrace?: (trace: TorobDetailsAttemptTrace) => void;
  coldStart?: boolean;
  policy?: Partial<TorobDetailsRecoveryPolicy>;
}): Promise<TorobDetailsRecoveryResult> {
  const policy = { ...DEFAULT_DETAILS_RECOVERY_POLICY, ...opts.policy };
  const startedAt = Date.now();
  const deadline = startedAt + opts.timeoutMs;
  const attempts: TorobDetailsAttemptTrace[] = [];
  const push = (trace: TorobDetailsAttemptTrace) => {
    attempts.push(trace);
    opts.onTrace?.(trace);
  };

  const remainingAt = () => Math.max(0, deadline - Date.now());
  let lastFailure: TorobDetailsFailure | null = null;

  if (opts.timeoutMs <= 0 || remainingAt() < policy.entryMinMs || opts.transports.length === 0) {
    const failure: TorobDetailsFailure = {
      kind: "DETAILS_NOT_ATTEMPTED",
      message: TOROB_DETAILS_FAILURE_MESSAGES.DETAILS_NOT_ATTEMPTED,
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
  let lastRawRead: TorobRead<TorobDetailsData> | null = null;
  // وقتی مسیر دوم (fallback) موجود است، تلاش بازیابیِ مسیر اول حق ندارد کل باقیمانده را بلعیده باشد
  const fallbackReserve = opts.transports.length > 1 ? policy.fallbackMinMs : 0;
  for (let tIdx = 0; tIdx < opts.transports.length; tIdx++) {
    const transport = opts.transports[tIdx];
    const isFallbackTransport = tIdx > 0;
    let transportAttempts = 0;
    let priorFailure: TorobDetailsFailure | null = isFallbackTransport ? lastFailure : null;

    while (transportAttempts < policy.maxAttemptsPerTransport) {
      const remaining = remainingAt();
      const isRecoveryAttempt = transportAttempts > 0;
      if (isRecoveryAttempt) {
        if (priorFailure && !RETRYABLE_KINDS.has(priorFailure.kind)) break;
        const waitMs = backoffDelayMs(policy.backoffBaseMs, policy.backoffJitterMs);
        if (remaining - waitMs < policy.recoveryAttemptMinMs) break;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else if (isFallbackTransport) {
        if (priorFailure && !FALLBACK_ALLOWED_KINDS.has(priorFailure.kind)) break;
        if (remaining < policy.fallbackMinMs) break;
      } else if (remaining < policy.entryMinMs) {
        break;
      }

      const remainingBefore = remainingAt();
      const allocatedTimeoutMs = isRecoveryAttempt
        ? (() => {
          const recoveryBudget = Math.max(0, remainingBefore - fallbackReserve);
          if (recoveryBudget < policy.recoveryAttemptMinMs) return -1; // باقیمانده برای fallback نگه داشته می‌شود
          return clamp(Math.round(recoveryBudget * policy.recoveryAttemptShare), policy.recoveryAttemptMinMs, recoveryBudget);
        })()
        : tIdx === 0
          ? clamp(Math.round(opts.timeoutMs * policy.firstAttemptShare), policy.firstAttemptMinMs, Math.min(policy.firstAttemptMaxMs, remainingBefore))
          : remainingBefore;
      if (allocatedTimeoutMs < 0) break;
      attemptNo += 1;
      const attemptStartedAt = Date.now();
      let read: TorobRead<TorobDetailsData>;
      try {
        read = await transport.run(allocatedTimeoutMs);
      } catch (error) {
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
        kind: "DETAILS_EXTRACTION_INCOMPLETE" as const,
        code: read.issue ?? "unusable_response",
      };
      const failure: TorobDetailsFailure | null = classified
        ? { kind: classified.kind, message: TOROB_DETAILS_FAILURE_MESSAGES[classified.kind], code: classified.code }
        : null;
      const trace: TorobDetailsAttemptTrace = {
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
          if (earlier !== trace && earlier.failureKind !== null) earlier.recoveredByLaterAttempt = true;
        }
        return { read, failure: null, attempts, recovered: attempts.some((a) => a.failureKind !== null) };
      }
      lastFailure = failure;
      priorFailure = failure;
      transportAttempts += 1;
      if (remainingAt() < policy.entryMinMs) break;
    }
  }

  // شکست نهایی: پرچم‌های لایهٔ حمل‌ونقل (blocked/challenged/origin) و دادهٔ جزئیِ آخرین پاسخ حفظ می‌شوند
  const failureRead: TorobRead<TorobDetailsData> = {
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
export function detailsFailureOf(kind: TorobDetailsFailureKind, code: string | null): TorobDetailsFailure {
  return { kind, message: TOROB_DETAILS_FAILURE_MESSAGES[kind], code: code ?? null };
}
