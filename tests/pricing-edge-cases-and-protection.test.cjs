const assert = require('node:assert/strict')
const test = require('node:test')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { resolveSupplyCost } = loadTsModule('src/lib/pricing/sourcing.ts')
const guards = loadTsModule('src/lib/pricing/guards.ts')
const { pickCampaign } = loadTsModule('src/lib/pricing/campaigns.ts')
const { computeECE, computeCalibrationMetrics } = loadTsModule('src/lib/pricing/confidence.ts')
const stats = loadTsModule('src/lib/pricing/stats.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')

const { applyGuards, validateBelowCostAuthorization, evaluateDecisionFloorSafety } = guards

test('P1. resolveSupplyCost: هزینه انبار/ریپلیس هرگز به صفر نمی‌افتد', () => {
  const r = resolveSupplyCost({ manualCostPrice: 0, inventoryCost: 1000000, replacementCost: 1200000, config: DEFAULT_PROFILE_CONFIG })
  assert.ok(r.effectiveCostPrice >= 1200000)
  const r2 = resolveSupplyCost({ manualCostPrice: 0, inventoryCost: 1000000, config: DEFAULT_PROFILE_CONFIG })
  assert.ok(r2.effectiveCostPrice >= 1000000)
  const r3 = resolveSupplyCost({ manualCostPrice: 0, replacementCost: 900000, config: DEFAULT_PROFILE_CONFIG })
  assert.ok(r3.effectiveCostPrice > 0)
})

test('P2. force عادی هرگز کف هزینه را دور نمی‌زند', () => {
  const res = evaluateDecisionFloorSafety({
    finalPrice: 900000,
    effectiveCostPrice: 1000000,
    inventoryCost: 1000000,
    force: true,
  })
  assert.equal(res.ok, false)
  assert.equal(res.isBelowCost, true)
})

test('P3. فروش زیر قیمت خرید حتی با مجوز قبلی مسدود است', () => {
  const base = { finalPrice: 950000, effectiveCostPrice: 1000000, force: true }
  assert.equal(evaluateDecisionFloorSafety({ ...base, allowBelowCost: true }).ok, false)
  assert.equal(
    evaluateDecisionFloorSafety({ ...base, authorization: { allowBelowCost: true, reason: 'ab', authorizedBy: 'ali' } }).ok,
    false,
  )
  assert.equal(
    evaluateDecisionFloorSafety({ ...base, authorization: { allowBelowCost: true, reason: 'clearance sale', authorizedBy: '' } }).ok,
    false,
  )
  const ok = evaluateDecisionFloorSafety({
    ...base,
    authorization: { allowBelowCost: true, reason: 'clearance sale', authorizedBy: 'manager-ali' },
  })
  assert.equal(ok.ok, false)
  assert.equal(ok.status, "blocked_below_cost")
  assert.equal(ok.auditRecord, null)
  const tooBig = evaluateDecisionFloorSafety({
    finalPrice: 400000,
    effectiveCostPrice: 1000000,
    authorization: { allowBelowCost: true, reason: 'clearance sale', authorizedBy: 'manager-ali', maxLossPct: 10 },
  })
  assert.equal(tooBig.ok, false)
  assert.equal(validateBelowCostAuthorization(null).valid, false)
})

test('P4. هزینه نامشخص بدون سیاست صریح مسدود است', () => {
  const res = evaluateDecisionFloorSafety({ finalPrice: 1000000, effectiveCostPrice: 0 })
  assert.equal(res.ok, false)
  assert.equal(res.status, 'blocked_unknown_cost')
})

test('P5. گرد کردن هرگز قیمت را زیر کف نمی‌برد', () => {
  for (const mode of ['floor', 'ceil', 'nearest']) {
    for (const finalStep of [1000, 5000, 10000]) {
      const out = applyGuards(
        1234567,
        { costPrice: 1000003, minMarginPct: 5 },
        DEFAULT_PROFILE_CONFIG.guards,
        { ...DEFAULT_PROFILE_CONFIG.rounding, finalStep, psychological: 'none' },
        { direction: mode },
      )
      const price = typeof out === 'number' ? out : out.price ?? out.finalPrice
      assert.ok(price >= 1000003 * 1.05 - 1e-6, `${mode}/${finalStep}: ${price}`)
    }
  }
})

test('P6. هیچ‌یک از سه کمپین با ترجیح دستی از شروط مرجع، درصد و زمان عبور نمی‌کند', () => {
  for (const type of ['flash', 'featured', 'timed_sale']) {
    const campaign = { id: 1, name: type, type, active: true, durationHours: 12, priority: 1,
      minDiscountPct: 5, maxDiscountPct: 30, activeHours: [], activeDays: [], categories: [] }
    const input = { preferredCampaignType: type, finalPrice: 900, discountPct: 10, discountKind: 'own_price_7d', ownAvg7d: 1000 }
    assert.equal(pickCampaign([campaign], input).type, type)
    for (const patch of [{ discountPct: 0 }, { discountPct: 4 }, { discountKind: 'entry_min' }, { discountKind: null }]) {
      assert.equal(pickCampaign([campaign], { ...input, ...patch }).type, 'none')
    }
    for (const patch of [{ active: false }, { endsAt: '2020-01-01' }, { startsAt: '2100-01-01' }]) {
      assert.equal(pickCampaign([{ ...campaign, ...patch }], input).type, 'none')
    }
    if (type === 'flash') assert.equal(pickCampaign([campaign], { ...input, ownAvg7d: 920 }).type, 'none')
  }
})

test('P7. آمار: ورودی‌های خراب NaN تولید نمی‌کنند', () => {
  assert.ok(Number.isFinite(stats.trimmedMean([1, 2, 3, 100], 200)))
  assert.ok(Number.isFinite(stats.weightedMean([1, 2, 3], [0, 0, 0])))
  assert.ok(Number.isFinite(stats.weightedMedian([1, 2, 3], [0, 0, 0])))
  assert.ok(Number.isFinite(stats.clamp(5, 10, 1)))
  assert.ok(Number.isFinite(stats.clamp(NaN, 1, 10)) || Number.isNaN(stats.clamp(NaN, 1, 10)) === false)
})

test('P8. ECE: کالیبره کامل = ۰؛ ورودی خالی/NaN امن', () => {
  assert.equal(computeECE([], []), 0)
  const e = computeECE([1, 1, 0, 0], [1, 1, 0, 0])
  assert.ok(Math.abs(e) < 1e-9)
  const bad = computeECE([0.9, 0.1], [0, 1])
  assert.ok(bad > 0.5)
  assert.ok(Number.isFinite(computeECE([NaN, 0.5], [1, 0])))
  assert.ok(computeCalibrationMetrics([], []))
})
