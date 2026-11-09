'use strict'
/**
 * تست «بهداشت انتشار» (۴.۲.۰)
 *
 * خطاهایی که تست‌های رفتاری نمی‌گیرند ولی در عمل بی‌صدا پول یا اعتماد را می‌سوزانند:
 *  - کش کامپایل کهنه ⇒ تست‌ها روی کد قدیمی سبز می‌شوند.
 *  - تست جدید که در اسکریپت test / verify-release ثبت نشده ⇒ هرگز اجرا نمی‌شود.
 *  - نسخهٔ package.json و موتور ناهمخوان.
 *  - ایمپورتر که فیلد select:false (قیمت خرید) را نمی‌خواند ⇒ costPrice=0 برای همه و خاموش شدن بی‌صدای auto-apply.
 *  - پیش‌فرض‌های حریم‌خصوصی/ایمنی که باید «بسته» بمانند.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { checkFreshness } = require(path.join(root, 'scripts', 'build-test-cache.cjs'))

test('H1. کش کامپایل تست با منبع فعلی همگام است (وگرنه: node scripts/build-test-cache.cjs)', () => {
  const res = checkFreshness()
  assert.ok(res.ok, res.problems.slice(0, 8).join('\n'))
})

test('H2. هر فایل tests/*.test.cjs در اسکریپت test و در verify-release (که از package.json می‌خواند) ثبت است', () => {
  const pkg = JSON.parse(read('package.json'))
  const listed = new Set(String(pkg.scripts.test).split(/\s+/).filter((t) => /^tests\/.+\.test\.cjs$/.test(t)))
  const onDisk = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.cjs'))
  const missing = onDisk.filter((f) => !listed.has(`tests/${f}`))
  assert.deepEqual(missing, [], `تست‌های ثبت‌نشده در package.json: ${missing.join(', ')}`)
  const ghost = [...listed].filter((t) => !fs.existsSync(path.join(root, t)))
  assert.deepEqual(ghost, [], `فایل‌های ناموجود در اسکریپت test: ${ghost.join(', ')}`)
  // verify-release نباید فهرست دستی جداگانه‌ای داشته باشد که از package.json عقب بیفتد
  const vr = read('scripts/verify-release.cjs')
  assert.ok(vr.includes('pkg.scripts.test'), 'verify-release باید فهرست تست‌ها را از package.json بخواند')
})

test('H3. نسخهٔ package.json با نسخهٔ موتور (DEFAULT_PROFILE_CONFIG.engine.version) یکی است', () => {
  const pkg = JSON.parse(read('package.json'))
  const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
  assert.equal(pkg.version, DEFAULT_PROFILE_CONFIG.engine.version)
})

test('H4. ایمپورتر Mongo صراحتاً قیمت خرید (select:false در مدل فروشگاه) و برند را می‌خواند', () => {
  const src = read('scripts/import-mongo-products.cjs')
  assert.match(src, /\.select\(\s*["']\+costPrice["']\s*\)/, 'بدون .select("+costPrice") همهٔ محصولات costPrice=0 می‌گیرند')
  assert.match(src, /\.populate\(\s*["']brand["']/, 'ایمپورتر باید فیلد brand را از MongoDB بخواند (v4.2.0+)')
})

test('H5. .env.example کلید همگام‌سازی را مستند می‌کند و .env در gitignore است', () => {
  const env = read('.env.example')
  assert.match(env, /^SGEOOOLE_PRICING_SECRET=/m)
  assert.match(env, /^CRON_SECRET=/m)
  const ignore = read('.gitignore').split(/\r?\n/).map((l) => l.trim())
  assert.ok(ignore.includes('.env'), '.env باید در .gitignore باشد')
  // مقدار نمونه نباید کلید واقعی باشد
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^(?:AI_API_KEY|SUBQ_API_KEY|ADMIN_PASSWORD|AUTH_SECRET)=(.*)$/)
    if (m) assert.equal(m[1].trim(), '', `${line.split('=')[0]} در .env.example باید خالی باشد`)
  }
})

test('H6. پیش‌فرض‌های حریم‌خصوصی و ایمنی بسته‌اند', () => {
  const { DEFAULT_PROFILE_CONFIG: cfg } = loadTsModule('src/lib/pricing/types.ts')
  assert.equal(cfg.supervisor.shareCostWithApi, false, 'قیمت خرید/کف نباید به صورت پیش‌فرض به API ناظر برود')
  assert.equal(cfg.estimator.mode, 'v2')
  assert.ok(cfg.estimator.minCalibratedConfidence >= 0.9, 'حد اعتماد کالیبرهٔ خودکار نباید پایین‌تر از ۰٫۹ باشد')
  assert.equal(cfg.estimator.calibratedConfidence, true)
  assert.equal(cfg.estimator.truncationAware, true)
})

test('H7. فایل‌های eval به مسیر مطلق ماشین وابسته نیستند و خروجی‌های مرجع ارزیابی همراه بسته‌اند', () => {
  for (const rel of ['eval/market/run.cjs', 'eval/market/ablate.cjs', 'eval/market/risk.cjs', 'eval/matching/run.cjs']) {
    const src = read(rel)
    assert.ok(!/\/home\/claude|\/tmp\/claude/.test(src), `${rel}: مسیر مطلق محیط ساخت`)
  }
  assert.ok(fs.existsSync(path.join(root, 'eval', 'results', 'market_baseline.json')))
})
