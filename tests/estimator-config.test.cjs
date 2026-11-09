'use strict'
/**
 * اعمال امن تنظیمات estimator روی پروفایل (۴.۲.۰): اعتبارسنجی، ادغام فقط-زیرشاخه، پروفایل‌های ریسک.
 * بدون دیتابیس و شبکه؛ CLI (scripts/apply-estimator-config.cjs) فقط همین توابع خالص را صدا می‌زند.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { makeScenarios } = require('./helpers/legacy-scenarios.cjs')
const lib = require(path.join(__dirname, '..', 'scripts', 'lib', 'estimator-config.cjs'))

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')

test('C1. خروجی fit-confidence (با meta) و پروفایل‌های ریسک معتبرند؛ meta نادیده گرفته می‌شود', () => {
  const fitted = { estimator: { confidenceModel: { intercept: -0.5882, wLogitRight: 0.6616, wHeuristic: 0, wNoneValid: 0, wFloorBound: 0 } }, meta: { source: 'rows.json' } }
  const r = lib.validateEstimatorPatch(fitted)
  assert.equal(r.ok, true, r.errors.join(' | '))
  assert.deepEqual(Object.keys(r.patch), ['confidenceModel'])
  for (const [name, p] of Object.entries(lib.PRESETS)) {
    const v = lib.validateEstimatorPatch({ estimator: p })
    assert.equal(v.ok, true, `${name}: ${v.errors.join(' | ')}`)
  }
})

test('C2. کلید ناشناخته، نوع نادرست، خارج از بازه، NaN/Infinity و ورودی بی‌شکل رد می‌شوند', () => {
  const bad = (est) => lib.validateEstimatorPatch({ estimator: est })
  assert.equal(bad({ nope: 1 }).ok, false)
  assert.equal(bad({ minCalibratedConfidence: '0.9' }).ok, false, 'رشته به‌جای عدد')
  assert.equal(bad({ minCalibratedConfidence: 9 }).ok, false, 'خارج از بازه')
  assert.equal(bad({ minCalibratedConfidence: 0.1 }).ok, false, 'پایین‌تر از کف مجاز')
  assert.equal(bad({ minCalibratedConfidence: NaN }).ok, false)
  assert.equal(bad({ competitivenessCostRatio: Infinity }).ok, false)
  assert.equal(bad({ competitivenessCostRatio: 0 }).ok, false)
  assert.equal(bad({ mode: 'v3' }).ok, false)
  assert.equal(bad({ mode: 'legacy' }).ok, true)
  assert.equal(bad({ conflictGateWhenCalibrated: 'yes' }).ok, false, 'بولی باید بولی باشد')
  assert.equal(lib.validateEstimatorPatch(null).ok, false)
  assert.equal(lib.validateEstimatorPatch({}).ok, false, 'بدون کلید estimator')
  assert.equal(lib.validateEstimatorPatch({ estimator: [] }).ok, false)
  assert.equal(bad({ minCalibratedConfidence: 9, nope: 1 }).errors.length, 2, 'همهٔ خطاها یک‌جا گزارش می‌شوند')
})

test('C3. کلیدهای تودرتو با پیش‌فرض‌های خودِ کد سنجیده می‌شوند (نه فهرست دستی)', () => {
  const bad = (est) => lib.validateEstimatorPatch({ estimator: est })
  assert.equal(bad({ validity: { baseLogit: 3.0 } }).ok, true)
  assert.equal(bad({ validity: { notAParam: 1 } }).ok, false)
  assert.equal(bad({ validity: { baseLogit: 'x' } }).ok, false)
  assert.equal(bad({ scenario: { maxScenarios: 100 } }).ok, false)
  assert.equal(bad({ scenario: { tolerancePct: 3 } }).ok, true)
  assert.equal(bad({ confidenceModel: { intercept: 50 } }).ok, false, 'ضریب غیرمنطقی')
  assert.equal(bad({ confidenceModel: 5 }).ok, false)
  // هر کلیدِ پیش‌فرضِ تودرتو باید قابل‌تنظیم باشد (کلیدی که فقط در کد اضافه شود خودکار پوشش داده می‌شود)
  const d = lib.loadDefaults()
  for (const k of Object.keys(d.validity)) {
    const r = bad({ validity: { [k]: d.validity[k] } })
    assert.equal(r.ok, true, `validity.${k}: ${r.errors.join(' | ')}`)
  }
  for (const k of Object.keys(d.confidenceModel)) assert.equal(bad({ confidenceModel: { [k]: d.confidenceModel[k] } }).ok, true, k)
  for (const k of Object.keys(d.scenario)) assert.equal(bad({ scenario: { [k]: d.scenario[k] } }).ok, true, k)
})

test('C4. ترکیب غیرممکن لنگر (τ>0.95) رد می‌شود؛ پیش‌فرض و مقادیر معقول معتبرند', () => {
  const eff = (patch, stored) => lib.validateEffective(lib.effectiveEstimator(stored, lib.validateEstimatorPatch({ estimator: patch }).patch))
  const def = eff({})
  assert.equal(def.ok, true)
  const expectedTau = Math.min(0.8, Math.max(0.2, 1 / (1 + DEFAULT_PROFILE_CONFIG.estimator.competitivenessCostRatio)))
  assert.ok(Math.abs(def.tau - expectedTau) < 1e-9, `τ پیش‌فرض باید ${expectedTau.toFixed(4)} باشد: ${def.tau}`)
  assert.equal(eff({ competitivenessCostRatio: 2 }).ok, true)
  // ratio کم ⇒ τ پایه ۰٫۶۷؛ با anchorCumProb=0.8 ⇒ ۱٫۰۷ ⇒ هرگز لنگر نمی‌شود
  const imp = eff({ competitivenessCostRatio: 0.5, validity: { anchorCumProb: 0.8 } })
  assert.equal(imp.ok, false)
  assert.match(imp.errors[0], /لنگر/)
  // ترکیب با مقدار «ذخیره‌شده» هم دیده می‌شود (وصله به‌تنهایی بی‌خطر است ولی با پروفایل موجود نه)
  const withStored = eff({ competitivenessCostRatio: 0.5 }, { validity: { anchorCumProb: 0.8 } })
  assert.equal(withStored.ok, false)
})

test('C5. ادغام: فقط estimator تغییر می‌کند، بقیهٔ config دست‌نخورده، پیش‌فرض‌ها پین نمی‌شوند، ورودی تغییر نمی‌کند', () => {
  const stored = {
    sourcing: { costPolicy: 'replacement_floor', neverBelowManualCost: false },
    rank1: { undercutAmount: 3000 },
    estimator: { minCalibratedConfidence: 0.8, confidenceModel: { intercept: 0.1 } },
  }
  const snapshot = JSON.parse(JSON.stringify(stored))
  const patch = lib.validateEstimatorPatch({ estimator: { confidenceModel: { wLogitRight: 0.7 }, competitivenessCostRatio: 1.4 } }).patch
  const next = lib.mergeEstimatorPatch(stored, patch)
  assert.deepEqual(stored, snapshot, 'ورودی نباید تغییر کند')
  assert.deepEqual(next.sourcing, stored.sourcing)
  assert.deepEqual(next.rank1, stored.rank1)
  assert.deepEqual(next.estimator, { minCalibratedConfidence: 0.8, competitivenessCostRatio: 1.4, confidenceModel: { intercept: 0.1, wLogitRight: 0.7 } })
  // پروفایل قدیمی بدون estimator: فقط کلیدهای وصله نوشته می‌شود (بقیه از پیش‌فرض کد می‌آید)
  const old = lib.mergeEstimatorPatch({ sourcing: {} }, { minCalibratedConfidence: 0.7 })
  assert.deepEqual(old.estimator, { minCalibratedConfidence: 0.7 })
  assert.deepEqual(lib.mergeEstimatorPatch(null, { mode: 'legacy' }), { estimator: { mode: 'legacy' } })
})

test('C6. diff: مقدار قبلی از ذخیره‌شده، در نبودش از پیش‌فرض کد؛ بدون تغییر علامت نمی‌خورد', () => {
  const rows = lib.diffEstimator({ minCalibratedConfidence: 0.8 }, { minCalibratedConfidence: 0.7, conflictGateWhenCalibrated: false, confidenceModel: { intercept: -0.5 } })
  const by = Object.fromEntries(rows.map((r) => [r.path, r]))
  assert.equal(by['estimator.minCalibratedConfidence'].before, 0.8)
  assert.equal(by['estimator.minCalibratedConfidence'].beforeFrom, 'ذخیره‌شده')
  assert.equal(by['estimator.minCalibratedConfidence'].changed, true)
  assert.equal(by['estimator.conflictGateWhenCalibrated'].beforeFrom, 'پیش‌فرض')
  assert.equal(by['estimator.conflictGateWhenCalibrated'].changed, false, 'برابر پیش‌فرض ⇒ بدون تغییر')
  assert.equal(by['estimator.confidenceModel.intercept'].before, 0)
  assert.equal(by['estimator.confidenceModel.intercept'].changed, true)
})

test('C7. هر پروفایل ریسک هر سه دستگیره را صریحاً می‌گذارد و «balanced» با پیش‌فرض کد یکی است (هشدار اگر پیش‌فرض عوض شد)', () => {
  const knobs = ['conflictGateWhenCalibrated', 'supervisorMarketCalibrated', 'minCalibratedConfidence']
  for (const [name, p] of Object.entries(lib.PRESETS)) assert.deepEqual(Object.keys(p).sort(), [...knobs].sort(), name)
  for (const k of knobs) {
    assert.equal(lib.PRESETS.balanced[k], DEFAULT_PROFILE_CONFIG.estimator[k], `پیش‌فرض ${k} عوض شده؛ PRESETS و docs/ESTIMATOR_V2.md §۷ را هم به‌روز کنید`)
  }
  // بازگشت از محافظه‌کار به متعادل واقعاً دستگیره‌ها را به پیش‌فرض برمی‌گرداند
  const cons = lib.mergeEstimatorPatch({}, lib.PRESETS.conservative)
  const back = lib.mergeEstimatorPatch(cons, lib.PRESETS.balanced)
  for (const k of knobs) assert.equal(back.estimator[k], DEFAULT_PROFILE_CONFIG.estimator[k])
})

test('C8. پروفایل‌ها روی موتور واقعی همان‌طور رفتار می‌کنند که سند می‌گوید: محافظه‌کار ≥ متعادل ≥ جسور در سهم بازبینی', () => {
  const scenarios = makeScenarios(300, 4120, new Date('2026-10-14T08:00:00Z'))
  const reviewRate = (patch) => {
    const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
    cfg.estimator = { ...cfg.estimator, ...patch }
    let review = 0
    let priced = 0
    for (const sc of scenarios) {
      const r = runPricingPipeline(sc.source, { ...sc.ctx, config: structuredClone(cfg) })
      if (r.finalPrice == null) continue
      priced++
      if (r.needsReview) review++
    }
    return { review, priced, rate: review / Math.max(1, priced) }
  }
  const cons = reviewRate(lib.PRESETS.conservative)
  const bal = reviewRate(lib.PRESETS.balanced)
  const agg = reviewRate(lib.PRESETS.aggressive)
  assert.ok(cons.priced > 50, 'سناریوی قیمت‌گذاری‌شدهٔ کافی نیست')
  assert.ok(cons.rate >= bal.rate - 1e-9, `محافظه‌کار (${cons.rate.toFixed(3)}) باید ≥ متعادل (${bal.rate.toFixed(3)}) بازبینی بدهد`)
  assert.ok(bal.rate >= agg.rate - 1e-9, `متعادل (${bal.rate.toFixed(3)}) باید ≥ جسور (${agg.rate.toFixed(3)}) بازبینی بدهد`)
  assert.ok(cons.rate > agg.rate, 'پروفایل‌ها باید واقعاً متفاوت باشند')
})

// ---- مسیر CLI با pg جعلی (tests/helpers/fake-pg.cjs): منطق جاوااسکریپت را می‌سنجد، نه معنای واقعی SQL را ----
const PRELOAD = path.join(__dirname, 'helpers', 'fake-pg-preload.cjs')
const CLI = path.join(__dirname, '..', 'scripts', 'apply-estimator-config.cjs')

function withFakeDb(profiles, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'))
  const file = path.join(dir, 'db.json')
  fs.writeFileSync(file, JSON.stringify({ profiles, logs: [], queries: [] }))
  const run = (...args) =>
    spawnSync(process.execPath, ['--require', PRELOAD, CLI, ...args], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, DATABASE_URL: 'postgres://fake/db', FAKE_PG_FILE: file },
    })
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  try {
    return fn({ dir, run, state })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('C9. CLI (pg جعلی): بدون --apply فقط SELECT می‌زند، چیزی نمی‌نویسد و تفاوت‌ها را چاپ می‌کند (dry-run)', () => {
  const stored = { sourcing: { costPolicy: 'replacement_floor' }, rank1: { undercutAmount: 3000 }, estimator: { minCalibratedConfidence: 0.8 } }
  withFakeDb([{ id: 1, name: 'پیش‌فرض', is_default: true, config: stored }], ({ dir, run, state }) => {
    const r = run('--preset', 'aggressive', '--default')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /dry-run/)
    assert.match(r.stdout, /estimator\.minCalibratedConfidence: 0\.8 \(ذخیره‌شده\) → 0\.7/)
    const s = state()
    assert.deepEqual(s.profiles[0].config, stored, 'dry-run نباید config را عوض کند')
    assert.deepEqual(s.logs, [])
    assert.ok(s.queries.length >= 1 && s.queries.every((q) => /^SELECT /.test(q.sql)), 'dry-run فقط باید SELECT بزند: ' + JSON.stringify(s.queries.map((q) => q.sql)))
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('profile-')), [], 'dry-run نباید بک‌آپ بسازد')
  })
})

test('C10. CLI (pg جعلی): --apply فقط estimator پروفایل هدف را می‌نویسد؛ بقیهٔ config و پروفایل دیگر دست‌نخورده؛ بک‌آپ و لاگ ساخته می‌شود', () => {
  const stored = {
    sourcing: { costPolicy: 'replacement_floor', neverBelowManualCost: false },
    rank1: { undercutAmount: 3000 },
    estimator: { minCalibratedConfidence: 0.8, confidenceModel: { intercept: 0.1 } },
  }
  const other = { rank1: { undercutAmount: 1 } }
  withFakeDb(
    [
      { id: 7, name: 'اصلی', is_default: true, config: stored },
      { id: 8, name: 'دیگر', is_default: false, config: other },
    ],
    ({ dir, run, state }) => {
      const r = run('--preset', 'conservative', '--default', '--apply')
      assert.equal(r.status, 0, r.stdout + r.stderr)
      const s = state()
      const next = s.profiles[0].config
      assert.deepEqual(next.sourcing, stored.sourcing)
      assert.deepEqual(next.rank1, stored.rank1)
      assert.deepEqual(next.estimator, { minCalibratedConfidence: 0.9, confidenceModel: { intercept: 0.1 }, conflictGateWhenCalibrated: true, supervisorMarketCalibrated: false })
      assert.deepEqual(s.profiles[1].config, other, 'پروفایل دیگر نباید لمس شود')
      const upd = s.queries.filter((q) => /^UPDATE /.test(q.sql))
      assert.equal(upd.length, 1)
      assert.equal(upd[0].params[1], 7, 'UPDATE باید روی پروفایل پیش‌فرض (id=7) باشد')
      assert.equal(s.logs.length, 1)
      assert.ok(s.logs[0].meta.changes.some((c) => c.path === 'estimator.minCalibratedConfidence' && c.from === 0.8 && c.to === 0.9))
      const backups = fs.readdirSync(dir).filter((f) => /^profile-7-config-backup-.*\.json$/.test(f))
      assert.equal(backups.length, 1)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).config, stored, 'بک‌آپ باید config قبلیِ کامل باشد')
      // اجرای دوباره با همان پروفایل: «هیچ تغییری لازم نیست» و هیچ UPDATE دیگری
      const again = run('--preset', 'conservative', '--default', '--apply')
      assert.equal(again.status, 0, again.stdout + again.stderr)
      assert.match(again.stdout, /هیچ تغییری لازم نیست/)
      assert.equal(state().queries.filter((q) => /^UPDATE /.test(q.sql)).length, 1)
    },
  )
})

test('C11. CLI (pg جعلی): وصلهٔ نامعتبر پیش از اتصال رد می‌شود (کد ۲)؛ ترکیب غیرممکن با پروفایل ذخیره‌شده رد می‌شود؛ آرگومان‌های متناقض/پروفایل ناموجود خطا می‌دهند', () => {
  const stored = { estimator: { validity: { anchorCumProb: 0.8 } } }
  withFakeDb([{ id: 1, name: 'p', is_default: true, config: stored }], ({ dir, run, state }) => {
    const badFile = path.join(dir, 'bad.json')
    fs.writeFileSync(badFile, JSON.stringify({ estimator: { minCalibratedConfidence: 9 } }))
    const bad = run('--file', badFile, '--default', '--apply')
    assert.equal(bad.status, 2, bad.stdout + bad.stderr)
    assert.match(bad.stderr, /خارج از بازه/)
    assert.deepEqual(state().queries, [], 'وصلهٔ نامعتبر نباید حتی به دیتابیس وصل شود')

    const impFile = path.join(dir, 'imp.json')
    fs.writeFileSync(impFile, JSON.stringify({ estimator: { competitivenessCostRatio: 0.5 } }))
    const imp = run('--file', impFile, '--default', '--apply')
    assert.equal(imp.status, 2, imp.stdout + imp.stderr)
    assert.match(imp.stderr, /لنگر/)
    assert.deepEqual(state().profiles[0].config, stored, 'ترکیب غیرممکن نباید نوشته شود')
    assert.ok(state().queries.every((q) => /^SELECT /.test(q.sql)))

    const missing = run('--preset', 'balanced', '--profile-id', '99')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /پروفایل پیدا نشد/)

    assert.equal(run('--preset', 'balanced', '--file', badFile, '--default').status, 1, 'هم --file هم --preset')
    assert.equal(run('--preset', 'balanced').status, 1, 'بدون --default و --profile-id')
    assert.equal(run('--preset', 'nope', '--default').status, 1, 'پروفایل ریسک ناشناخته')
  })
})
