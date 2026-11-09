// بارگذار قابل‌حمل TypeScript -> CommonJS (مشترک بین تست‌ها و فایل‌های probe)
// ۱. Project node_modules/typescript (standard after `npm install`)
// ۲. Global/system typescript or @babel/core (e.g., Debian / CI containers)
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const pricingRoot = path.resolve(__dirname, '..', '..')
const cache = new Map()

function tryRequire(candidates) {
  for (const id of candidates) {
    try {
      return require(id)
    } catch {
      // try next candidate
    }
  }
  return null
}

const tsCompiler = tryRequire([
  'typescript',
  path.join(pricingRoot, 'node_modules/typescript'),
  path.resolve(pricingRoot, '../sgeooole/frontend/node_modules/typescript'),
  '/usr/share/nodejs/typescript',
  '/usr/local/lib/node_modules/typescript',
])

const babelCore = tryRequire([
  '@babel/core',
  path.join(pricingRoot, 'node_modules/@babel/core'),
  '/usr/share/nodejs/@babel/core',
])
const babelPresetTs = tryRequire([
  '@babel/preset-typescript',
  path.join(pricingRoot, 'node_modules/@babel/preset-typescript'),
  '/usr/share/nodejs/@babel/preset-typescript',
])
const babelPluginCjs = tryRequire([
  '@babel/plugin-transform-modules-commonjs',
  path.join(pricingRoot, 'node_modules/@babel/plugin-transform-modules-commonjs'),
  '/usr/share/nodejs/@babel/plugin-transform-modules-commonjs',
])

/**
 * کش کامپایل فقط وقتی معتبر است که با «همین» فایل منبع ساخته شده باشد؛ وگرنه تست‌ها بی‌صدا روی کد کهنه اجرا می‌شوند
 * (و نتیجهٔ سبز بی‌ارزش می‌شود). هش منبع با tests/.compiled-cache/manifest.json مقایسه می‌شود (ساخت: scripts/build-test-cache.cjs).
 */
function assertCacheFresh(relPath, fullPath) {
  const manifestFile = path.join(pricingRoot, 'tests', '.compiled-cache', 'manifest.json')
  const key = relPath.split(path.sep).join('/')
  let want
  try {
    want = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).files[key]
  } catch {
    want = undefined
  }
  const have = require('node:crypto').createHash('sha256').update(fs.readFileSync(fullPath, 'utf8'), 'utf8').digest('hex')
  if (want !== have) {
    throw new Error(
      `کش کامپایل تست برای ${key} با منبع فعلی هم‌خوان نیست (کهنه یا بدون manifest). ` +
        'یا `npm install` کنید (تا از کامپایلر استفاده شود) یا `node scripts/build-test-cache.cjs` را اجرا کنید.',
    )
  }
}

function transpileTsToCjs(code, fullPath) {
  if (!process.env.FORCE_PRECOMPILED_CACHE) {
    if (tsCompiler && typeof tsCompiler.transpileModule === 'function') {
      const out = tsCompiler.transpileModule(code, {
        fileName: fullPath,
        compilerOptions: {
          module: tsCompiler.ModuleKind.CommonJS,
          target: tsCompiler.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      })
      return out.outputText
    }
    if (babelCore && babelPresetTs && babelPluginCjs) {
      const out = babelCore.transformSync(code, {
        filename: fullPath,
        presets: [[babelPresetTs, { allExtensions: true }]],
        plugins: [babelPluginCjs],
      })
      return out.code
    }
  }
  // Fallback for isolated test environments before `npm install` (loads pre-transpiled CJS snapshot)
  const relPath = path.relative(pricingRoot, fullPath)
  const cachedFile = path.join(pricingRoot, 'tests', '.compiled-cache', relPath + '.cjs')
  if (fs.existsSync(cachedFile)) {
    assertCacheFresh(relPath, fullPath)
    return fs.readFileSync(cachedFile, 'utf8')
  }
  throw new Error(
    'برای اجرای تست‌های TypeScript، ابتدا دستور `npm install` را در پوشه پروژه اجرا کنید تا پکیج `typescript` نصب شود.'
  )
}

function loadTsModule(relPath) {
  const fullPath = path.resolve(pricingRoot, relPath)
  if (cache.has(fullPath)) return cache.get(fullPath).exports

  let code = fs.readFileSync(fullPath, 'utf8')
  const toImportPath = (fromFile, target) => {
    let rel = path.relative(path.dirname(fromFile), target).split(path.sep).join('/')
    if (!rel.startsWith('.')) rel = './' + rel
    return rel
  }
  code = code.replace(/from\s+["']@\/lib\/([^"']+)["']/g, (_, p1) => {
    const target = path.resolve(pricingRoot, 'src/lib', p1)
    return `from "${toImportPath(fullPath, target)}"`
  })
  code = code.replace(/from\s+["']@\/db\/([^"']+)["']/g, (_, p1) => {
    const target = path.resolve(pricingRoot, 'src/db', p1)
    return `from "${toImportPath(fullPath, target)}"`
  })

  const transformed = { code: transpileTsToCjs(code, fullPath) }

  const mod = { exports: {} }
  cache.set(fullPath, mod)

  const customRequire = (id) => {
    if (id.startsWith('.')) {
      const resolvedBase = path.resolve(path.dirname(fullPath), id)
      const candidates = [
        resolvedBase,
        resolvedBase + '.ts',
        resolvedBase + '.tsx',
        path.join(resolvedBase, 'index.ts'),
      ]
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          return loadTsModule(path.relative(pricingRoot, c))
        }
      }
    }
    return require(id)
  }

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transformed.code)
  fn(mod.exports, customRequire, mod, fullPath, path.dirname(fullPath))
  return mod.exports
}

module.exports = { loadTsModule, pricingRoot }
