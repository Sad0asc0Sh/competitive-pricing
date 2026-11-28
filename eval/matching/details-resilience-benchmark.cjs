// سنجش: نرخ موفقیت استعلام اول، نرخ بازیابی، p50/p95 تأخیر، تعداد درخواست‌ها (amplification).
// زمان مجازی است (هیچ sleep واقعی) — معناشناسی تلاش‌ها همان policy ماژول resilience است.

const { loadTsModule } = require('../../tests/helpers/ts-loader.cjs')
const resilience = loadTsModule('src/lib/sources/torob-details-resilience.ts')

const PROD_DETAILS_TIMEOUT_MS = 7_000 // budgets.detailsTimeoutMs تعاملی
const PROD_DETAILS_BUDGET_MS = 18_000 // budgets.detailsBudgetMs تعاملی
const SUCCESS_LATENCY_MS = 1_100      // تأخیر نمونهٔ پاسخ سالم جزئیات
const N = 400
const SEED = 20261128

function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** جریان خرابی مشترک: برای هر استعلامِ i، رفتار درخواست جزئیات از پیش تعیین می‌شود */
function buildFaultStream(n) {
  const rand = lcg(SEED)
  const stream = []
  for (let i = 0; i < n; i++) {
    const r1 = rand()
    const r2 = rand()
    const r3 = rand()
    // ۲۸٪ استعلام‌ها در اولین فراخوانی جزئیات گذرا time-out می‌شوند؛
    // در ۷۰٪ آن‌ها تلاش دوم کافی است، در ۳۰٪ باقی فقط مسیر مستقیم جواب می‌دهد.
    const firstCallTimesOut = r1 < 0.28
    const recoverySucceeds = r2 < 0.7
    const fallbackSucceeds = r3 < 0.8
    stream.push({ firstCallTimesOut, recoverySucceeds, fallbackSucceeds })
  }
  return stream
}

function percentile(sorted, q) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
}

/** حالت قدیم: یک تلاش با کل مهلت؛ بعد از timeout کامل، fallback نیازمند >۱۰۰۰ms باقیمانده است ⇒ هرگز */
function runLegacy(faults) {
  const rows = []
  for (const fault of faults) {
    if (!fault.firstCallTimesOut) {
      rows.push({ ok: true, latencyMs: SUCCESS_LATENCY_MS, requests: 1, recovered: false })
      continue
    }
    rows.push({ ok: false, latencyMs: PROD_DETAILS_TIMEOUT_MS, requests: 1, recovered: false })
  }
  return rows
}

/** حالت تاب‌آور: شبیه‌سازی دقیق policy روی مهلت‌های واقعی production */
function runResilient(faults) {
  const policy = resilience.DEFAULT_DETAILS_RECOVERY_POLICY
  const rows = []
  for (const fault of faults) {
    let requests = 0
    const okFast = !fault.firstCallTimesOut
    if (okFast) {
      rows.push({ ok: true, latencyMs: SUCCESS_LATENCY_MS, requests: 1, recovered: false })
      continue
    }
    // تلاش اول با سهم ۰٫۶ از مهلت جزئیات
    requests += 1
    const firstAttemptMs = Math.round(PROD_DETAILS_TIMEOUT_MS * policy.firstAttemptShare)
    let remaining = PROD_DETAILS_TIMEOUT_MS - firstAttemptMs
    if (fault.recoverySucceeds && remaining >= policy.recoveryAttemptMinMs) {
      requests += 1
      const recoveryMs = Math.min(Math.round((remaining - policy.fallbackMinMs) * policy.recoveryAttemptShare), remaining)
      rows.push({ ok: true, latencyMs: firstAttemptMs + policy.backoffBaseMs + Math.min(SUCCESS_LATENCY_MS, recoveryMs), requests, recovered: true })
      continue
    }
    // بازیابی هم شکست خورد ⇒ fallback مستقیم اگر بودجه باشد
    if (fault.fallbackSucceeds && remaining >= policy.fallbackMinMs) {
      requests += 1
      rows.push({ ok: true, latencyMs: PROD_DETAILS_TIMEOUT_MS - remaining + Math.min(SUCCESS_LATENCY_MS, remaining), requests, recovered: true })
      continue
    }
    requests += 1
    rows.push({ ok: false, latencyMs: PROD_DETAILS_TIMEOUT_MS, requests, recovered: false })
  }
  return rows
}

function summarize(rows) {
  const ok = rows.filter((r) => r.ok)
  const sorted = [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b)
  const recovered = rows.filter((r) => r.recovered)
  const recoveredOk = recovered.filter((r) => r.ok).length
  return {
    inquiries: rows.length,
    firstInquirySuccessRate: Number((ok.length / rows.length).toFixed(4)),
    timeoutFailures: rows.filter((r) => !r.ok).length,
    recoveryAttempts: recovered.length,
    recoverySuccessRate: recovered.length ? Number((recoveredOk / recovered.length).toFixed(4)) : 0,
    requestsPerInquiry: Number((rows.reduce((s, r) => s + r.requests, 0) / rows.length).toFixed(3)),
    latencyP50Ms: percentile(sorted, 0.5),
    latencyP95Ms: percentile(sorted, 0.95),
    latencyP99Ms: percentile(sorted, 0.99),
  }
}

function main() {
  const faults = buildFaultStream(N)
  const legacy = summarize(runLegacy(faults))
  const resilient = summarize(runResilient(faults))
  const report = {
    inquiries: N,
    faultModel: { firstCallTimeoutRate: 0.28, recoveryCures: 0.7, fallbackCures: 0.8 },
    budgets: { detailsTimeoutMs: PROD_DETAILS_TIMEOUT_MS, detailsBudgetMs: PROD_DETAILS_BUDGET_MS },
    legacy: legacy,
    resilient: resilient,
    improvement: {
      successRateDelta: Number((resilient.firstInquirySuccessRate - legacy.firstInquirySuccessRate).toFixed(4)),
      requestAmplificationOnSuccess: Number((resilient.requestsPerInquiry / Math.max(1e-9, legacy.requestsPerInquiry)).toFixed(3)),
    },
  }
  console.log(JSON.stringify(report, null, 2))
  const assert = require('node:assert/strict')
  assert.ok(report.improvement.successRateDelta > 0.15, 'بازیابی باید نرخ موفقیت استعلام اول را به‌طور معنادار بالا ببرد')
  assert.ok(report.improvement.requestAmplificationOnSuccess <= 1.6, 'تقویت درخواست باید محدود بماند')
  assert.equal(resilient.timeoutFailures < legacy.timeoutFailures, true)
}

main()
