'use strict'
/**
 * تست‌های پایداری پنل و مسیرهای SSR/API:
 *  - بارگذاری تنبل @/db هنگام build بدون DATABASE_URL و شکست صریح در زمان کوئری واقعی
 *  - اعتبارسنجی شناسه‌های عددی برای جلوگیری از خطای 500 Postgres روی مقادیر نامعتبر
 *  - تبدیل امن تاریخ‌ها و نبود eval/Function/inline script در error boundaryهای پنل
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTsModule, pricingRoot } = require('./helpers/ts-loader.cjs')

test('P1. @/db در زمان import بدون DATABASE_URL کرش نمی‌کند ولی هنگام کوئری صریحاً خطا می‌دهد', async () => {
  const prevUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  delete globalThis.__arenaNextJsPostgresqlPool
  delete globalThis.__arenaNextJsPostgresqlDb

  // پاک‌سازی کش داخلی ts-loader با اجرای ایزوله در زیرفرایند
  const { execFileSync } = require('node:child_process')
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `
      const assert = require('node:assert/strict');
      const { loadTsModule } = require('./tests/helpers/ts-loader.cjs');
      const mod = loadTsModule('src/db/index.ts');
      assert.ok(mod.db && mod.pool);
      assert.throws(() => mod.pool.query('select 1'), /DATABASE_URL is required/);
      assert.throws(() => mod.db.select(), /DATABASE_URL is required/);
      console.log('LAZY_DB_OK');
      `,
    ],
    { cwd: pricingRoot, encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } },
  )
  assert.match(out, /LAZY_DB_OK/)
  if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl
})

test('P2. parsePositiveInt و توابع تاریخ ورودی‌های مخدوش را بدون کرش مدیریت می‌کنند', () => {
  const { parsePositiveInt, faDate, toIsoString } = loadTsModule('src/lib/format.ts')
  assert.equal(parsePositiveInt('1'), 1)
  assert.equal(parsePositiveInt(' 42 '), 42)
  assert.equal(parsePositiveInt(123), 123)
  assert.equal(parsePositiveInt('0'), null)
  assert.equal(parsePositiveInt('-5'), null)
  assert.equal(parsePositiveInt('1.5'), null)
  assert.equal(parsePositiveInt('abc'), null)
  assert.equal(parsePositiveInt('999999999999'), null)
  assert.equal(parsePositiveInt(NaN), null)
  assert.equal(parsePositiveInt(null), null)

  assert.equal(faDate('not-a-date'), '—')
  assert.equal(faDate(null), '—')
  assert.equal(toIsoString('not-a-date'), '')
  assert.equal(toIsoString(null), '')
  assert.equal(toIsoString(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z')
})

test('P3. مسیرهای داینامیک [id] برای شناسه غیرعددی قبل از Postgres پاسخ 400 می‌دهند', async () => {
  const prevBypass = process.env.ALLOW_INSECURE_DEV_AUTH
  const prevEnv = process.env.NODE_ENV
  process.env.ALLOW_INSECURE_DEV_AUTH = 'true'
  process.env.NODE_ENV = 'test'
  try {
    const productsRoute = loadTsModule('src/app/api/products/[id]/route.ts')
    const decisionsRoute = loadTsModule('src/app/api/decisions/[id]/route.ts')

    for (const badId of ['abc', '0', '-1', '999999999999']) {
      const pGet = await productsRoute.GET(new Request(`http://localhost/api/products/${badId}`), {
        params: Promise.resolve({ id: badId }),
      })
      assert.equal(pGet.status, 400)

      const pPatch = await productsRoute.PATCH(
        new Request(`http://localhost/api/products/${badId}`, { method: 'PATCH', body: '{}' }),
        { params: Promise.resolve({ id: badId }) },
      )
      assert.equal(pPatch.status, 400)

      const pDel = await productsRoute.DELETE(
        new Request(`http://localhost/api/products/${badId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: badId }) },
      )
      assert.equal(pDel.status, 400)

      const dGet = await decisionsRoute.GET(new Request(`http://localhost/api/decisions/${badId}`), {
        params: Promise.resolve({ id: badId }),
      })
      assert.equal(dGet.status, 400)
    }
  } finally {
    if (prevBypass === undefined) delete process.env.ALLOW_INSECURE_DEV_AUTH
    else process.env.ALLOW_INSECURE_DEV_AUTH = prevBypass
    if (prevEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevEnv
  }
})

test('P4. صفحات error.tsx و global-error.tsx بدون eval/Function/script مخرب تعریف شده‌اند', () => {
  for (const rel of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
    const full = path.join(pricingRoot, rel)
    assert.ok(fs.existsSync(full), `${rel} باید وجود داشته باشد`)
    const src = fs.readFileSync(full, 'utf8')
    assert.match(src, /^"use client";/m)
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(|<script\b/i.test(src), `${rel} نباید eval یا اسکریپت تزریقی داشته باشد`)
  }
})
