#!/usr/bin/env node
'use strict'
/**
 * جدول‌های ۱–۴ سند docs/EVALUATION.md را «مستقیماً» از خروجی eval/market/final.cjs می‌سازد (بدون رونویسی دستی عدد).
 *
 *   node eval/market/format-final.cjs [--in eval/results/final_heldout.json] [> tables.md]
 *
 * اگر `final.cjs` را با بذرهای تازه اجرا کردید (مثلاً --seeds 9101,9102,9103 --out /tmp/f.json)، همین ابزار با --in جدول‌های
 * تازه را می‌سازد؛ مقایسهٔ آن‌ها با جدول‌های سند یعنی «تأیید مستقل» (قاعدهٔ بذر سوخته در سند).
 */
const fs = require('node:fs')
const path = require('node:path')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const LABELS = {
  mix: 'mix (آمیخته)',
  clean: 'clean (تمیز)',
  bait: 'bait (طعمهٔ قیمتی ۳۵٪)',
  variant: 'variant (نسخهٔ دیگر ۲۵٪)',
  legit: 'legit (ارزان‌فروش واقعی ۲۵٪)',
  volatile: 'volatile (پرنوسان)',
  thin: 'thin (۲–۵ فروشنده)',
  big: 'big (۳۱–۹۰ فروشنده)',
  wide: 'wide (پراکندگی زیاد)',
  stress_ghost: 'stress_ghost (شبح ×۳)',
  stress_noghost: 'stress_noghost (بدون شبح)',
  stress_norep: 'stress_norep (شهرت بی‌اطلاع)',
  stress_all: 'stress_all (همه با هم)',
}

const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : (x * 100).toFixed(d) + '%')
const signed = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1)
const ciText = (c) => {
  if (!c || c[0] == null || c[1] == null) return 'n/a'
  const zero = c[0] <= 0 && c[1] >= 0
  return `[${signed(c[0])}, ${signed(c[1])}]${zero ? ' ⚠ شامل ۰' : ''}`
}
// علامت «−» ریاضی در خروجی مطلوب نیست؛ همان «-» ASCII برای هم‌خوانی با جدول‌های سند
const fix = (s) => s.replace(/\+-/g, '-')

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => ':--').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

function main() {
  const file = path.resolve(arg('in', path.join(__dirname, '..', 'results', 'final_heldout.json')))
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const names = Object.keys(j.scenarios)
  const ref = j.meta.ref || 'C'
  const out = []

  const t1 = []
  const t2 = []
  const t3 = []
  const t4 = []
  let floorTotal = 0
  for (const sc of names) {
    const P = j.scenarios[sc].perOracle
    const c = P[ref]
    const s = P.S
    const label = LABELS[sc] || sc
    floorTotal += (c.floorViolations.baseline || 0) + (c.floorViolations.v2 || 0)
    t1.push([
      label,
      `${pct(c.baseline.errAuto ?? c.baseline.silentGivenAuto)} → **${pct(c.v2.errAuto ?? c.v2.silentGivenAuto)}**`,
      fix(ciText(c.deltaCI.errAuto)),
      `${pct(c.baseline.within2)} → ${pct(c.v2.within2)}`,
      fix(ciText(c.deltaCI.within2)),
      `${pct(c.baseline.p90APE, 2)} → ${pct(c.v2.p90APE, 2)}`,
    ])
    t2.push([
      label,
      `${pct(c.baseline.autoRate)} → ${pct(c.v2.autoRate)}`,
      `${pct(c.baseline.giveaway2)} → ${pct(c.v2.giveaway2)}`,
      fix(ciText(c.deltaCI.giveaway2)),
      `${pct(c.baseline.uncomp2)} → ${pct(c.v2.uncomp2)}`,
      fix(ciText(c.deltaCI.uncomp2)),
      `${pct(c.baseline.rankHit)} → ${pct(c.v2.rankHit)}`,
      `${pct(c.baseline.silentErr)} → ${pct(c.v2.silentErr)}`,
    ])
    if (s) {
      t3.push([label, `${pct(s.baseline.errAuto)} → ${pct(s.v2.errAuto)}`, fix(ciText(s.deltaCI.errAuto)), `${pct(s.baseline.within2)} → ${pct(s.v2.within2)}`])
    }
    const m = c.v2MatchedCoverage
    t4.push([
      label,
      `${pct(c.baseline.autoRate)} / ${pct(c.baseline.errAuto)}`,
      m ? `${m.threshold.toFixed(2)} / ${pct(m.autoRate)} / **${pct(m.errAuto)}**` : 'n/a',
      `${(c.baseline.confAUC ?? NaN).toFixed(3)} → ${(c.v2.confAUC ?? NaN).toFixed(3)}`,
    ])
  }

  out.push(`### جدول ۱ — دقت (مرجع: اوراکل ${ref}؛ Δ = v2 − baseline، به نقطهٔ درصدی؛ CI ۹۵٪ بوت‌استرپ جفتی)\n`)
  out.push(table(['سناریو', 'خطای >۲٪ در میان خودکارها: قبل → بعد', 'Δ [CI]', 'درصد در ±۲٪: قبل → بعد', 'Δ [CI]', 'صدک ۹۰ خطا: قبل → بعد'], t1))
  out.push(`\n### جدول ۲ — سیاست و معامله (مرجع ${ref})\n`)
  out.push(
    table(
      ['سناریو', 'نرخ اعمال خودکار', '«ارزان‌تر از لازم» >۲٪ (سود از دست رفته)', 'Δ [CI]', '«گران‌تر از لازم» >۲٪ (غیررقابتی)', 'Δ [CI]', 'رتبهٔ بهینه', 'خطای بی‌صدا (از کل)'],
      t2,
    ),
  )
  if (t3.length) {
    out.push('\n### جدول ۳ — اوراکل S (فقط «خطای تخمین»؛ خودِ موتور روی دادهٔ کاملاً درست)\n')
    out.push(table(['سناریو', 'خطای >۲٪ در میان خودکارها: قبل → بعد', 'Δ [CI]', 'درصد در ±۲٪: قبل → بعد'], t3))
  }
  out.push(`\n### جدول ۴ — خطا «در پوشش برابر» (آستانهٔ اعتماد v2 تا رسیدن نرخ خودکار به baseline بالا می‌رود؛ مرجع ${ref})\n`)
  out.push(table(['سناریو', 'baseline: خودکار / خطا', 'v2 در پوشش برابر: آستانه / خودکار / خطا', 'confAUC: قبل → بعد'], t4))
  out.push(`\nنقض کف سود (floor violations) در همهٔ سناریوها و هر دو موتور: ${floorTotal}`)
  console.log(out.join('\n'))
}

main()
