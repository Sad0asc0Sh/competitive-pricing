'use strict'
/**
 * ارزیابی موتور قیمت‌گذاری روی دنیاهای شبیه‌سازی‌شده با حقیقت زمینی.
 *   node eval/market/run.cjs [--root DIR] [--baseline DIR] [--n 400] [--seed 7] [--scenarios mix,bait,...] [--out FILE]
 *
 * اوراکل‌ها:
 *   oracleA: «رتبه ۱ نسبت به ارزان‌ترین پیشنهاد واقعاً معتبر» = max(کف سود، کمترینِ معتبر − پله‌ی undercut) با گرد کردن به پایین
 *   oracleB: خروجی موتور «اصلی (baseline)» وقتی فقط پیشنهادهای معتبرِ کامل (بدون برش ۳۰تایی، بدون کهنگی) را ببیند
 *   oracleC: «بهترین رتبهٔ شدنی با بیشترین حاشیه» (مستقل از سیاست و از موتور): max(کف، اولین معتبرِ بالای کف − پله)؛
 *            وقتی کف مانع رتبه ۱ است، همان قیمتی است که بالاترین رتبهٔ ممکن را با بیشترین سود نگه می‌دارد
 *   oracleS: «خودِ موتورِ تحت ارزیابی» روی دادهٔ کاملاً درست ⇒ فقط خطای تخمین (نه تفاوت سیاست) را می‌سنجد
 * خطا: (final − oracle)/oracle ؛ مثبت = گران‌تر از لازم (غیررقابتی)، منفی = ارزان‌تر از لازم (از دست دادن حاشیه).
 */
const fs = require('fs')
const path = require('path')
const { makeRng, hashStr } = require('../lib/rng.cjs')
const { simulateWorld, withParams, NOW } = require('./simulate.cjs')
const T = require('../lib/titles.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

function loadEngine(root) {
  const { loadTsModule } = require(path.join(root, 'tests/helpers/ts-loader.cjs'))
  return {
    engine: loadTsModule('src/lib/pricing/engine.ts'),
    types: loadTsModule('src/lib/pricing/types.ts'),
    strategy: loadTsModule('src/lib/pricing/strategy.ts'),
  }
}

const SCENARIOS = {
  mix: {},
  clean: { pBait: 0, pVariant: 0, pLegitLow: 0, vols: [[0.0005, 1]], pOutOfStock: 0.02 },
  bait: { pBait: 0.35 },
  variant: { pVariant: 0.25 },
  legit: { pLegitLow: 0.25 },
  volatile: { vols: [[0.012, 1]] },
  big: { regimes: [[[31, 90], 1]] },
  thin: { regimes: [[[2, 5], 1]] },
  wide: { sigmas: [[0.06, 1]] },
  // ---- سناریوهای فشار (پارامترهای شبیه‌ساز عمداً با مفروضات مدل ناهمخوان‌اند؛ مدل‌ها دوباره آموزش داده نمی‌شوند)
  stress_ghost: { ghostBase: 0.03, ghostPerDay: 0.012, ghostCap: 0.5 }, // لیستینگ‌های شبح ۳ برابر
  stress_noghost: { ghostBase: 0, ghostPerDay: 0, ghostCap: 0, pHonoredFloor: 0.3 }, // کهنه‌ها تقریباً همه واقعی
  stress_norep: {
    // امتیاز فروشنده هیچ اطلاعاتی دربارهٔ دقت به‌روزرسانی نمی‌دهد
    diligence: [['high', 0.35, 0.4, 4.0, 0.8], ['mid', 0.4, 2.0, 4.0, 0.8], ['low', 0.25, 14, 4.0, 0.8]],
  },
  stress_all: { ghostBase: 0.03, ghostPerDay: 0.012, ghostCap: 0.5, pBait: 0.25, pVariant: 0.15, pLegitLow: 0.15, vols: [[0.012, 1]] },
  // لیستینگ اشتباه (خواهرِ مدل) بدون حضور فروشگاه خودمان
  wronglisting: { wrong: true, pSelf: 0 },
  // لیستینگ اشتباه که ترب فروشگاه ما را هم در آن ادغام کرده (خطای ادغام خودِ ترب)
  wrongself: { wrong: true, pSelf: 1 },
}

const PRODUCT_NAME = 'دوربین مداربسته تحت شبکه بولت هایک ویژن مدل DS-2CD1023G0E-I'
const PRODUCT_SKU = 'DS-2CD1023G0E-I'

function cloneCfg(types) {
  return JSON.parse(JSON.stringify(types.DEFAULT_PROFILE_CONFIG))
}

function siblingTitle(rng) {
  const base = T.CATALOG.find((c) => c.id === 'hik-1023')
  const m = T.mutateCode(base.code, rng)
  const clone = { ...base, code: m.code }
  return T.renderProduct(clone, rng, 'torob', { includeCode: true, brandForm: 'fa' }).titleFa
}

function runOne(eng, world, cfgOverride, wrong) {
  const cfg = cloneCfg(eng.types)
  if (cfgOverride) cfgOverride(cfg)
  const ctx = {
    productId: 1,
    productName: PRODUCT_NAME,
    sku: PRODUCT_SKU,
    costPrice: world.costPrice,
    supplierQuotes: [],
    currentFinalPrice: world.currentFinalPrice,
    config: cfg,
    now: NOW,
  }
  const source = {
    source: 'torob',
    productTitle: wrong ? wrong.title : PRODUCT_NAME,
    prk: 'p1',
    offers: wrong ? world.offers.map((o) => ({ ...o, price: Math.round((o.price * wrong.factor) / 100) * 100 })) : world.offers,
    totalSellerCount: world.totalSellerCount,
    fetchedAt: NOW,
    ok: true,
    meta: { offersTruncated: world.truncated },
  }
  return eng.engine.runPricingPipeline(source, ctx)
}

function oracleA(eng, world, hardFloor) {
  const L = world.truth.lowestValid
  if (L == null) return null
  const cfg = cloneCfg(eng.types)
  const u = eng.strategy.computeUndercutDelta(L, cfg.rank1)
  let t = Math.max(hardFloor, L - u)
  let f = Math.floor(t / 1000) * 1000
  if (hardFloor > 0 && f < hardFloor) f = Math.ceil(hardFloor / 1000) * 1000
  return f
}

function oracleB(base, world) {
  // «موتور اصلی روی دادهٔ کاملاً درست»: فقط پیشنهادهای واقعاً معتبر، با شهر واقعی هر فروشنده، تازه و معتبر
  const valid = world.truth.validOffers
  if (!valid || !valid.length) return null
  const offers = valid.map((v, i) => ({
    shopName: `صحیح ${i}`, shopId: `v${i}`, shopCity: v.city, sellerType: 'online',
    shopScore: 4.7, shopVotes: 100, price: v.price, guarantee: 'enabled', priceUnreliable: false, lastChangedText: '۱ ساعت پیش', lastChangedAt: new Date(NOW.getTime() - 3600000), isAd: false, inStock: true,
  }))
  const cfg = cloneCfg(base.types)
  const ctx = { productId: 1, productName: PRODUCT_NAME, sku: PRODUCT_SKU, costPrice: world.costPrice, supplierQuotes: [], currentFinalPrice: world.currentFinalPrice, config: cfg, now: NOW }
  const res = base.engine.runPricingPipeline({ source: 'torob', productTitle: PRODUCT_NAME, prk: 'p1', offers, totalSellerCount: offers.length, fetchedAt: NOW, ok: true }, ctx)
  return res.finalPrice
}

/** بهترین رتبهٔ شدنی با بیشترین حاشیه (مستقل از سیاست): max(کف، اولین معتبرِ بالای کف − پله) */
function oracleC(eng, world, hardFloor) {
  const V = world.truth.validPrices
  if (!V || !V.length) return null
  const cfg = cloneCfg(eng.types)
  const vr = V.find((v) => v >= hardFloor)
  if (vr == null) return null
  const u = eng.strategy.computeUndercutDelta(vr, cfg.rank1)
  let f = Math.floor(Math.max(hardFloor, vr - u) / 1000) * 1000
  if (hardFloor > 0 && f < hardFloor) f = Math.ceil(hardFloor / 1000) * 1000
  return f
}

/** رتبهٔ قیمت F در میان پیشنهادهای واقعاً معتبر و بهترین رتبهٔ شدنی (قیمت = کف) */
function ranks(world, F, hardFloor) {
  const V = world.truth.validPrices || []
  const rank = 1 + V.filter((v) => v < F).length
  const best = 1 + V.filter((v) => v < hardFloor).length
  return { rank, best, loss: rank - best }
}

/** خودِ موتور (با همان پیکربندی) روی دادهٔ کاملاً درست: «قیمتِ درستِ سازگار با سیاست» */
function oracleSelf(eng, world, cfgOverride) {
  const valid = world.truth.validOffers
  if (!valid || !valid.length) return null
  const offers = valid.map((v, i) => ({
    shopName: `صحیح ${i}`, shopId: `v${i}`, shopCity: v.city, sellerType: 'online',
    shopScore: 4.7, shopVotes: 100, price: v.price, guarantee: 'enabled', priceUnreliable: false, lastChangedText: '۱ ساعت پیش', lastChangedAt: new Date(NOW.getTime() - 3600000), isAd: false, inStock: true,
  }))
  const cfg = cloneCfg(eng.types)
  if (cfgOverride) cfgOverride(cfg)
  const ctx = { productId: 1, productName: PRODUCT_NAME, sku: PRODUCT_SKU, costPrice: world.costPrice, supplierQuotes: [], currentFinalPrice: world.currentFinalPrice, config: cfg, now: NOW }
  const res = eng.engine.runPricingPipeline({ source: 'torob', productTitle: PRODUCT_NAME, prk: 'p1', offers, totalSellerCount: offers.length, fetchedAt: NOW, ok: true }, ctx)
  return res.finalPrice
}

const q = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const r = (p / 100) * (s.length - 1)
  const lo = Math.floor(r)
  const hi = Math.ceil(r)
  return s[lo] + (s[hi] - s[lo]) * (r - lo)
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function auroc(pos, neg) {
  if (!pos.length || !neg.length) return null
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

function aggregate(rows, key) {
  const withO = rows.filter((r) => r[key] != null)
  const prod = withO.filter((r) => r.final != null)
  const errs = prod.map((r) => (r.final - r[key]) / r[key])
  const ape = errs.map(Math.abs)
  const auto = prod.filter((r) => !r.review)
  const within = (x) => ape.filter((e) => e <= x).length / Math.max(1, prod.length)
  const silent = auto.filter((r) => Math.abs((r.final - r[key]) / r[key]) > 0.02)
  const good = prod.map((r) => (Math.abs((r.final - r[key]) / r[key]) <= 0.02 ? 1 : 0))
  const goodConf = prod.filter((r, i) => good[i]).map((r) => r.conf)
  const badConf = prod.filter((r, i) => !good[i]).map((r) => r.conf)
  return {
    n: rows.length,
    nOracle: withO.length,
    coverage: withO.length ? prod.length / withO.length : null,
    mdAPE: q(ape, 50),
    p90APE: q(ape, 90),
    meanAPE: mean(ape),
    exact: ape.filter((e) => e <= 0.002).length / Math.max(1, prod.length),
    within1: within(0.01),
    within2: within(0.02),
    biasMedian: q(errs, 50),
    giveaway2: errs.filter((e) => e < -0.02).length / Math.max(1, prod.length), // ارزان‌تر از لازم
    giveaway10: errs.filter((e) => e < -0.1).length / Math.max(1, prod.length),
    uncompetitive2: errs.filter((e) => e > 0.02).length / Math.max(1, prod.length),
    uncompetitive10: errs.filter((e) => e > 0.1).length / Math.max(1, prod.length),
    autoRate: prod.length ? auto.length / prod.length : null,
    silentErr: prod.length ? silent.length / prod.length : null, // اعمال خودکار + خطای >۲٪ (نسبت به کل)
    silentGivenAuto: auto.length ? silent.length / auto.length : null,
    confAUC: auroc(goodConf, badConf),
    floorViolations: rows.filter((r) => r.final != null && r.floor > 0 && r.final < r.floor).length,
    // معیارهای رتبه‌ای (فقط وقتی rankLoss موجود باشد)
    rankHit: prod.filter((r) => r.rankLoss != null).length ? prod.filter((r) => r.rankLoss === 0).length / prod.filter((r) => r.rankLoss != null).length : null,
    rankLossMean: prod.filter((r) => r.rankLoss != null).length ? mean(prod.filter((r) => r.rankLoss != null).map((r) => r.rankLoss)) : null,
    meanOver: mean(errs.map((e) => Math.max(0, e))), // میانگین گران‌تر از لازم
    meanUnder: mean(errs.map((e) => Math.max(0, -e))), // میانگین ارزان‌تر از لازم (سود از دست رفته)
  }
}

function evalEngine(eng, base, worlds, opts) {
  const rows = []
  for (const w of worlds) {
    const wrong = w.wrong
    let res
    try {
      res = runOne(eng, w.world, opts.cfgOverride, wrong)
    } catch (e) {
      rows.push({ final: null, error: String(e && e.message) })
      continue
    }
    const floor = res.supply.hardFloorPrice
    const guardStep = res.steps.find((s) => s.step === 'guards')
    const reviewNoConf = res.reviewReasons.some((r) => !/^اعتماد (کالیبره|آماری)/.test(r))
    const rk = !wrong && res.finalPrice != null ? ranks(w.world, res.finalPrice, floor) : null
    rows.push({
      final: res.finalPrice,
      review: res.needsReview,
      reviewNoConf: reviewNoConf || !res.finalPrice || res.rejectedBySupervisor,
      reasons: res.reviewReasons,
      conf: res.confidence,
      pRight: res.decisionScenarios ? res.decisionScenarios.pRight : null,
      heuristic: res.confidenceBreakdown ? res.confidenceBreakdown.heuristic ?? null : null,
      pNone: res.decisionScenarios ? res.decisionScenarios.pNoneValid : null,
      floorBound: Boolean(guardStep && guardStep.data && guardStep.data.floorEnforced),
      floor,
      strategy: res.strategy,
      oA: wrong ? null : oracleA(eng, w.world, floor),
      oB: wrong ? null : oracleB(base, w.world),
      oC: wrong ? null : oracleC(eng, w.world, floor),
      oS: wrong ? null : oracleSelf(eng, w.world, opts.cfgOverride),
      rankLoss: rk ? rk.loss : null,
      wrong: Boolean(wrong),
      rejectedBySup: Boolean(res.rejectedBySupervisor),
      idScoreGate: (res.steps.find((s) => s.step === 'identity') || {}).data,
    })
  }
  return rows
}

/** مثل evalEngine ولی برای هر ردیف «علت» خطا را هم برمی‌گرداند (برای ریشه‌یابی) */
function classifyCause(res, w, oA, final) {
  const labels = new Map(w.world.truth.offerLabels.map((l) => [l.shopName, l]))
  const incl = (res.offers || []).filter((o) => o.included)
  const engLow = incl.length ? Math.min(...incl.map((o) => o.price)) : null
  const trueLow = w.world.truth.lowestValid
  const trueLowVisible = w.world.truth.lowestValidVisible
  const invalidLows = incl.filter((o) => {
    const l = labels.get(o.shopName)
    return l && !l.valid && trueLow != null && o.price < trueLow
  })
  if (trueLow != null && trueLowVisible != null && trueLowVisible > trueLow * 1.0005) return 'truncated_hidden'
  if (invalidLows.length) {
    const kinds = [...new Set(invalidLows.map((o) => (labels.get(o.shopName) || {}).kind))].sort().join('+')
    return `invalid_included(${kinds})`
  }
  const trueLowOffer = (res.offers || []).find((o) => {
    const l = labels.get(o.shopName)
    return l && l.valid && trueLow != null && o.price === trueLow
  })
  if (trueLowOffer && !trueLowOffer.included) {
    return `valid_low_excluded(${(trueLowOffer.cls || trueLowOffer.excludeReason || '?').toString().replace(/\s*\(.*$/, '').slice(0, 24)})`
  }
  if (res.strategy && !/^(national_rank1_undercut)$/.test(res.strategy)) return `strategy:${res.strategy}`
  if (final != null && oA != null && Math.abs(final - oA) / oA > 0.02) return 'guard_or_rounding_or_floor'
  return 'other'
}

function evalEngineDetailed(eng, base, worlds, opts) {
  const rows = []
  for (const w of worlds) {
    let res
    try {
      res = runOne(eng, w.world, opts.cfgOverride, w.wrong)
    } catch (e) {
      rows.push({ final: null, error: String(e && e.message) })
      continue
    }
    const floor = res.supply.hardFloorPrice
    const oA = w.wrong ? null : oracleA(eng, w.world, floor)
    rows.push({ final: res.finalPrice, review: res.needsReview, conf: res.confidence, floor, strategy: res.strategy, oA, cause: classifyCause(res, w, oA, res.finalPrice), res })
  }
  return rows
}

function buildWorlds(seed, name, n) {
  const sc = SCENARIOS[name]
  const P = withParams(sc)
  const worlds = []
  for (let i = 0; i < n; i++) {
    const rng = makeRng(hashStr(`${seed}:${name}:${i}`))
    const world = simulateWorld(rng, P)
    let wrong = null
    if (sc.wrong) {
      const factor = rng.chance(0.2) ? rng.float(0.93, 1.07) : rng.chance(0.5) ? rng.float(0.5, 0.8) : rng.float(1.25, 2.2)
      wrong = { factor, title: siblingTitle(rng) }
    }
    worlds.push({ world, wrong })
  }
  return worlds
}

function pct(x, d = 1) {
  return x == null ? '  n/a' : (x * 100).toFixed(d).padStart(5) + '%'
}

function printTable(title, aggs) {
  console.log(`\n--- ${title}`)
  const head = ['engine', 'cov', 'mdAPE', 'p90APE', 'within1', 'within2', 'giveaway>2', 'uncomp>2', 'giveaway>10', 'auto', 'silentErr', 'errAuto', 'rankHit', 'confAUC']
  console.log(head.map((h, i) => h.padEnd(i === 0 ? 30 : 11)).join(' '))
  for (const [name, a] of aggs) {
    console.log([name, pct(a.coverage), pct(a.mdAPE, 2), pct(a.p90APE, 2), pct(a.within1), pct(a.within2), pct(a.giveaway2), pct(a.uncompetitive2), pct(a.giveaway10), pct(a.autoRate), pct(a.silentErr), pct(a.silentGivenAuto), pct(a.rankHit), a.confAUC == null ? '  n/a' : a.confAUC.toFixed(3)].map((x, i) => String(x).padEnd(i === 0 ? 30 : 11)).join(' '))
  }
}

module.exports = { evalEngine, evalEngineDetailed, buildWorlds, aggregate, loadEngine, SCENARIOS, printTable, pct, runOne, oracleA, oracleB, oracleC, oracleSelf, ranks, cloneCfg, auroc, q, mean }

if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
  const n = Number(arg('n', 400))
  const seed = Number(arg('seed', 7))
  const names = (arg('scenarios', Object.keys(SCENARIOS).join(','))).split(',')
  const label = arg('label', path.basename(root))
  const eng = loadEngine(root)
  const base = root === baseRoot ? eng : loadEngine(baseRoot)
  const out = {}
  for (const name of names) {
    const worlds = buildWorlds(seed, name, n)
    const rows = evalEngine(eng, base, worlds, {})
    if (name === 'wronglisting' || name === 'wrongself') {
      const prod = rows.filter((r) => r.final != null)
      const auto = prod.filter((r) => !r.review)
      const rej = rows.filter((r) => r.rejectedBySup)
      console.log(`\n--- ${name} [${label}] : ${rows.length} لیستینگ اشتباه | قیمت داده شد ${pct(prod.length / rows.length)} | اعمال خودکار (خطرناک) ${pct(auto.length / rows.length)} | ریویو ${pct(prod.filter((r) => r.review).length / rows.length)} | رد توسط ناظر ${pct(rej.length / rows.length)}`)
      out[name] = { n: rows.length, autoApplied: auto.length / rows.length, withPrice: prod.length / rows.length }
      continue
    }
    const aA = aggregate(rows, 'oA')
    const aB = aggregate(rows, 'oB')
    printTable(`${name} [${label}] vs oracleA (رتبه ۱ نسبت به ارزان‌ترین معتبر)  n=${rows.length}`, [['A:' + label, aA]])
    printTable(`${name} [${label}] vs oracleB (موتور اصلی با دادهٔ تمیز)`, [['B:' + label, aB]])
    out[name] = { vsA: aA, vsB: aB }
  }
  const o = arg('out', null)
  if (o) fs.writeFileSync(o, JSON.stringify(out, null, 2))
}
