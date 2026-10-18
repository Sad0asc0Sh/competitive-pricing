#!/usr/bin/env node
/**
 * ۴.۱.۲ — صحت‌سنجی قابل‌تطبیق پیش از استقرار.
 *
 * بدون وابستگی به مسیر/سیستم‌عامل خاص:
 *  - typecheck موتور قیمت‌گذاری
 *  - تست موتور (node --test)
 *  - تست فروشگاه (npm test) اگر ریپوی فروشگاه پیدا شود
 *  - اختیاری: dry-run مهاجرت PostgreSQL و گزارش کف‌های کهنه MongoDB
 *
 * استفاده:
 *   node scripts/verify-release.cjs                 # همه‌ی بررسی‌های کد
 *   node scripts/verify-release.cjs --quick         # بدون تست فروشگاه
 *   node scripts/verify-release.cjs --db            # + dry-run مهاجرت
 *   node scripts/verify-release.cjs --mongo         # + گزارش کف‌های کهنه
 *   node scripts/verify-release.cjs --store-dir=/path/to/ekgkala-backend
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const ROOT = path.resolve(__dirname, '..')
const argv = new Set(process.argv.slice(2))
const QUICK = argv.has('--quick')
const WITH_DB = argv.has('--db')
const WITH_MONGO = argv.has('--mongo')
const storeArg = [...argv].find((a) => a.startsWith('--store-dir='))
const STORE_CANDIDATES = [
  storeArg ? storeArg.split('=')[1] : null,
  process.env.EKGKALA_BACKEND_DIR,
  path.resolve(ROOT, '..', 'sgeooole', 'ekgkala-backend'),
  path.resolve(ROOT, '..', 'ekgkala-project', 'ekgkala-backend'),
  '/home/debian/apps/ekgkala-project/ekgkala-backend',
].filter(Boolean)
const STORE_DIR = STORE_CANDIDATES.find((dir) => fs.existsSync(path.join(dir, 'package.json')))

const results = []
function run(name, command, args, options = {}) {
  const started = Date.now()
  const res = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: 'inherit',
    // فقط npm (که روی ویندوز npm.cmd است) به shell نیاز دارد؛ node.exe مسیرش فاصله دارد
    // و با shell=true تکه‌تکه می‌شود.
    shell: Boolean(options.shell),
    env: { ...process.env, ...(options.env || {}) },
  })
  const ok = res.status === 0
  results.push({ name, ok, ms: Date.now() - started, code: res.status })
  return ok
}

function note(name, ok, detail = '') {
  results.push({ name, ok, ms: 0, detail })
}

function main() {
  console.log('=== ۴.۱.۲ verify-release ===')
  console.log(`ریپوی موتور: ${ROOT}`)
  console.log(`ریپوی فروشگاه: ${STORE_DIR || 'پیدا نشد (با --store-dir بدهید)'}`)

  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tsc)) {
    note('pricing typecheck', false, 'typescript نصب نیست (npm install)')
  } else {
    run('pricing typecheck', process.execPath, [tsc, '--noEmit', '--pretty', 'false'])
  }

  if (!run('pricing tests', process.execPath, ['--test', 'tests/pricing-engine.test.cjs', 'tests/cleanup-script-safety.test.cjs', 'tests/migration-safety.test.cjs'])) {
    // ادامه می‌دهیم تا همه‌ی خرابی‌ها یک‌جا دیده شوند
  }

  if (!QUICK && STORE_DIR && fs.existsSync(path.join(STORE_DIR, 'tests'))) {
    if (process.platform === 'win32') {
      // npm.cmd با shell=true هشدار deprecation می‌دهد؛ cmd مستقیم امن‌تر است.
      run('store tests', process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm test'], { cwd: STORE_DIR })
    } else {
      run('store tests', 'npm', ['test'], { cwd: STORE_DIR })
    }
  } else if (!QUICK) {
    note('store tests', false, 'ریپوی فروشگاه پیدا نشد')
  }

  if (WITH_DB) {
    if (!process.env.DATABASE_URL) note('db migrate dry-run', false, 'DATABASE_URL تنظیم نشده')
    else run('db migrate dry-run', process.execPath, ['scripts/migrate.cjs', '--dry-run'])
  }

  if (WITH_MONGO && STORE_DIR) {
    const script = path.join(STORE_DIR, 'scripts', 'report-stale-floors.cjs')
    if (!fs.existsSync(script)) note('stale floors', false, 'اسکریپت گزارش کف‌های کهنه پیدا نشد')
    else run('stale floors', process.execPath, [script, '--json'], { cwd: STORE_DIR })
  }

  console.log('\n=== خلاصه ===')
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ms ? ` (${r.ms}ms)` : ''}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.error(`\n${failed.length} بررسی ناموفق.`)
    process.exit(1)
  }
  console.log('\nهمه‌ی بررسی‌ها سبز شد ✅')
}

main()
