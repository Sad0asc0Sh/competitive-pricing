'use strict'
/**
 * تبدیل «تصمیم‌های ذخیره‌شده» به ردیف‌های برچسب‌دار برای بازتنظیم مدل اعتماد کالیبره (۴.۲.۰)
 *
 * چرا؟ اعتبارسنجی موتور روی شبیه‌ساز انجام شده است؛ اعدادش «ادعا»ست تا وقتی که روی دادهٔ واقعی بازتنظیم/راستی‌آزمایی نشود.
 * این ماژول (بدون وابستگی به دیتابیس و بدون هیچ شبکه‌ای) ورودیِ eval/market/fit-confidence.cjs --data را می‌سازد.
 *
 * دو منبع برچسب:
 *  ۱) ممیزی تصادفی (بی‌طرف‌ترین): انسان برای یک نمونهٔ تصادفی از تصمیم‌ها «قیمت درست» را از روی ترب می‌نویسد
 *     (فایل CSV با ستون‌های decisionId,correctPrice). برچسب = |قیمت ما − قیمت درست| ≤ ۲٪ (قابل تنظیم).
 *     اگر کارتِ ترب اصلاً کالای ما نیست یا مرجع قابل‌اتکایی وجود ندارد، به‌جای قیمت «wrong» بنویسید (برچسب ۰)؛ سطر را حذف نکنید،
 *     وگرنه بدترین شکست‌ها از ممیزی بیرون می‌افتند و نرخ خطا کمتر از واقعیت برآورد می‌شود.
 *  ۲) نتیجهٔ بازبینی انسانی (ارزان ولی سوگیردار): تصمیم‌هایی که به صف بازبینی رفتند؛ تأیید ⇒ ۱ ، رد ⇒ ۰.
 *     سوگیری: فقط تصمیم‌های کم‌اعتماد را می‌بیند و بازبین ممکن است بی‌دقت تأیید کند ⇒ برای کالیبراسیونِ ناحیهٔ بالای
 *     اعتماد کافی نیست؛ حتماً با ممیزی تصادفی از تصمیم‌های «خودکار» تکمیل شود.
 */

const TOLERANCE = 0.02
/** نشانهٔ ممیزی: «قیمتِ ما به هر قیمتی نادرست است» (کارت اشتباه / بدون مرجع قابل‌اتکا) */
const WRONG = 'wrong'
const WRONG_MARK = /^(wrong|x|noref|نادرست|اشتباه|خطا)$/i

const stepOf = (steps, name) => (Array.isArray(steps) ? steps : []).find((s) => s && s.step === name) || null
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** عددِ مثبت یا null (null/''/NaN/۰/منفی ⇒ null؛ Number(null)=۰ نباید «قیمت صفر» حساب شود) */
const positive = (x) => {
  if (x == null || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** ویژگی‌های مدل اعتماد از steps؛ برای تصمیم‌های قدیمی (بدون گام robustness) null */
function featuresFromSteps(steps) {
  const rob = stepOf(steps, 'robustness')
  const pRight = rob && rob.data ? num(rob.data.pRight) : null
  if (pRight == null) return null
  const guards = stepOf(steps, 'guards')
  const dec = stepOf(steps, 'decision')
  const bd = dec && dec.data && dec.data.confidenceBreakdown ? dec.data.confidenceBreakdown : null
  return {
    pRight,
    pNone: num(rob.data.pNoneValid) ?? 0,
    heuristic: bd ? num(bd.heuristic) : null,
    floorBound: Boolean(guards && guards.data && guards.data.floorEnforced),
  }
}

/** آیا این تصمیم به صف بازبینی رفته بود (true) یا خودکار می‌توانست اعمال شود (false)؟ نامعلوم ⇒ null */
function needsReviewFromSteps(steps) {
  const dec = stepOf(steps, 'decision')
  if (!dec) return null
  if (dec.data && typeof dec.data.needsReview === 'boolean') return dec.data.needsReview
  const m = String(dec.message || '')
  if (m.includes('ارسال به بخش ریویو') || m.includes('رد کامل')) return true
  if (m.includes('اعمال خودکار')) return false
  return null
}

/** برچسب از بازبینی انسانی: تأیید ⇒ ۱ ، رد ⇒ ۰ ؛ بدون بازبینی (یا هنوز در صف) ⇒ null */
function labelFromReview(decision) {
  if (needsReviewFromSteps(decision.steps) !== true) return null
  if (decision.status === 'applied') return 1
  if (decision.status === 'rejected') return 0
  return null
}

/** برچسب از ممیزی: قیمتی که انسان آگاه «درست» می‌داند */
function labelFromAudit(decision, correctPrice, tol = TOLERANCE) {
  const f = positive(decision.finalPrice)
  if (f == null) return null
  if (correctPrice === WRONG) return 0
  const c = positive(correctPrice)
  if (c == null) return null
  return Math.abs((f - c) / c) <= tol ? 1 : 0
}

/** «۲٬۴۵۰٬۰۰۰» / «2,450,000» / «2450000» → عدد (نامعتبر ⇒ null) */
function toNumber(text) {
  if (text == null) return null
  const ascii = String(text)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,٬،\s_]/g, '')
  if (!/^\d+(\.\d+)?$/.test(ascii)) return null
  const n = Number(ascii)
  return Number.isFinite(n) ? n : null
}

/** CSV ممیزی: سرستون decisionId,correctPrice (ترتیب ستون‌ها آزاد؛ جداکنندهٔ «,» یا «;» یا تب) → Map(id → قیمت | 'wrong') */
function parseAuditCsv(text) {
  const lines = String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const out = new Map()
  const problems = []
  if (!lines.length) return { audit: out, problems }
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  // «,» می‌تواند جداکنندهٔ هزارگان هم باشد؛ برای همین قیمت‌ها باید داخل کوتیشن بیایند یا از «;» استفاده شود
  const split = (line) => {
    const cells = []
    let cur = ''
    let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (ch === sep && !q) {
        cells.push(cur)
        cur = ''
      } else cur += ch
    }
    cells.push(cur)
    return cells.map((c) => c.trim())
  }
  const head = split(lines[0]).map((h) => h.toLowerCase())
  const idCol = head.indexOf('decisionid')
  const priceCol = head.indexOf('correctprice')
  if (idCol < 0 || priceCol < 0) {
    problems.push('سرستون باید شامل decisionId و correctPrice باشد')
    return { audit: out, problems }
  }
  lines.slice(1).forEach((line, i) => {
    const cells = split(line)
    const id = toNumber(cells[idCol])
    const rawPrice = cells[priceCol]
    if (id != null && rawPrice != null && WRONG_MARK.test(String(rawPrice).trim())) {
      out.set(id, WRONG)
      return
    }
    const price = toNumber(rawPrice)
    if (id == null || price == null || price <= 0) problems.push(`سطر ${i + 2}: مقدار نامعتبر`)
    else out.set(id, price)
  })
  return { audit: out, problems }
}

/**
 * @param decisions [{id,status,finalPrice,confidence,steps,createdAt}]
 * @param opts { audit?: Map<number, number>, useReview?: boolean (پیش‌فرض true), tolerance?: number }
 */
function buildRows(decisions, opts = {}) {
  const audit = opts.audit instanceof Map ? opts.audit : new Map()
  const useReview = opts.useReview !== false
  const tol = opts.tolerance ?? TOLERANCE
  const rows = []
  const skipped = { noFeatures: 0, noLabel: 0 }
  for (const d of decisions) {
    const f = featuresFromSteps(d.steps)
    if (!f) {
      skipped.noFeatures++
      continue
    }
    let label = null
    let labelSource = null
    if (audit.has(Number(d.id))) {
      label = labelFromAudit(d, audit.get(Number(d.id)), tol)
      labelSource = 'audit'
    }
    if (label == null && useReview) {
      label = labelFromReview(d)
      labelSource = label == null ? null : 'review'
    }
    if (label == null) {
      skipped.noLabel++
      continue
    }
    rows.push({
      decisionId: Number(d.id),
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      pRight: f.pRight,
      pNone: f.pNone,
      heuristic: f.heuristic,
      floorBound: f.floorBound,
      confidence: d.confidence == null ? null : num(Number(d.confidence)),
      label,
      labelSource,
    })
  }
  return { rows, skipped }
}

module.exports = { TOLERANCE, WRONG, featuresFromSteps, needsReviewFromSteps, labelFromReview, labelFromAudit, parseAuditCsv, toNumber, buildRows }
