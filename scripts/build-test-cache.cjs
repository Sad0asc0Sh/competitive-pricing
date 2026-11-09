#!/usr/bin/env node
'use strict'
/**
 * بازتولید «کش کامپایل‌شدهٔ تست‌ها» (tests/.compiled-cache) از روی src
 *
 * کش برای محیط‌های ایزوله‌ای است که هنوز `npm install` نشده‌اند (تست‌ها TypeScript را به CommonJS تبدیل می‌کنند؛ اگر
 * کامپایلر نبود از این کش می‌خوانند). خطرِ کش قدیمی این است که تست‌ها بی‌صدا روی «کد قدیمی» اجرا شوند؛ بنابراین:
 *   - این اسکریپت کش را از روی همین src دوباره می‌سازد و کنار آن `manifest.json` (SHA-256 هر فایل منبع) می‌نویسد؛
 *   - بارگذار تست (tests/helpers/ts-loader.cjs) هنگام استفاده از کش، هش منبع را با manifest مقایسه می‌کند و در صورت
 *     ناهمخوانی «با پیام روشن» خطا می‌دهد (به‌جای اجرای کد کهنه)؛
 *   - تست tests/release-hygiene.test.cjs تازگی کش را در CI بررسی می‌کند.
 *
 * استفاده:
 *   node scripts/build-test-cache.cjs           # بازتولید کش + manifest
 *   node scripts/build-test-cache.cjs --check   # فقط بررسی تازگی (کد خروج ۱ اگر کهنه باشد؛ بدون نیاز به کامپایلر)
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'src')
const cacheDir = path.join(root, 'tests', '.compiled-cache')
const manifestPath = path.join(cacheDir, 'manifest.json')

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

function listSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out.sort()
}

const rel = (full) => path.relative(root, full).split(path.sep).join('/')

/** بررسی تازگی بدون نیاز به کامپایلر: manifest در برابر محتوای فعلی src */
function checkFreshness() {
  const problems = []
  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return { ok: false, problems: ['manifest.json وجود ندارد یا خراب است — `node scripts/build-test-cache.cjs` را اجرا کنید'] }
  }
  const files = listSources(srcDir)
  const seen = new Set()
  for (const full of files) {
    const r = rel(full)
    seen.add(r)
    const want = manifest.files && manifest.files[r]
    if (!want) {
      problems.push(`فایل جدید در کش نیست: ${r}`)
      continue
    }
    const have = sha256(fs.readFileSync(full, 'utf8'))
    if (have !== want) problems.push(`کش کهنه است: ${r}`)
    if (!fs.existsSync(path.join(cacheDir, r + '.cjs'))) problems.push(`خروجی کش گم شده است: ${r}.cjs`)
  }
  for (const r of Object.keys(manifest.files || {})) {
    if (!seen.has(r)) problems.push(`فایل منبع حذف شده ولی در کش مانده: ${r}`)
  }
  return { ok: problems.length === 0, problems }
}

function loadCompiler() {
  const candidates = [
    'typescript',
    path.join(root, 'node_modules/typescript'),
    path.resolve(root, '../sgeooole/frontend/node_modules/typescript'),
    '/usr/share/nodejs/typescript',
    '/usr/local/lib/node_modules/typescript',
  ]
  for (const id of candidates) {
    try {
      return require(id)
    } catch {
      // next
    }
  }
  return null
}

/** همان بازنویسی مسیر «@/lib» و «@/db» که بارگذار تست انجام می‌دهد */
function rewriteAliases(code, fullPath) {
  const toImportPath = (fromFile, target) => {
    let r = path.relative(path.dirname(fromFile), target).split(path.sep).join('/')
    if (!r.startsWith('.')) r = './' + r
    return r
  }
  code = code.replace(/from\s+["']@\/lib\/([^"']+)["']/g, (_, p1) => `from "${toImportPath(fullPath, path.resolve(root, 'src/lib', p1))}"`)
  code = code.replace(/from\s+["']@\/db\/([^"']+)["']/g, (_, p1) => `from "${toImportPath(fullPath, path.resolve(root, 'src/db', p1))}"`)
  return code
}

function build() {
  const ts = loadCompiler()
  if (!ts || typeof ts.transpileModule !== 'function') {
    console.error('کامپایلر typescript پیدا نشد؛ ابتدا `npm install` را اجرا کنید.')
    process.exit(2)
  }
  fs.rmSync(cacheDir, { recursive: true, force: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  const files = {}
  for (const full of listSources(srcDir)) {
    const original = fs.readFileSync(full, 'utf8')
    const out = ts.transpileModule(rewriteAliases(original, full), {
      fileName: full,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    const dest = path.join(cacheDir, rel(full) + '.cjs')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out.outputText)
    files[rel(full)] = sha256(original)
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ generatedBy: 'scripts/build-test-cache.cjs', compiler: ts.version, files }, null, 2) + '\n',
  )
  console.log(`کش کامپایل: ${Object.keys(files).length} فایل (typescript ${ts.version})`)
}

if (process.argv.includes('--check')) {
  const res = checkFreshness()
  if (res.ok) {
    console.log('کش کامپایل تازه است.')
  } else {
    console.error(res.problems.join('\n'))
    process.exit(1)
  }
} else {
  build()
}

module.exports = { checkFreshness, listSources, sha256 }
