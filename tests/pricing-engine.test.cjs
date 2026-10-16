const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// Portable TypeScript -> CommonJS loader that works on ANY server:
// 1. Project node_modules/typescript (standard after `npm install`)
// 2. Global/system typescript or @babel/core (e.g., Debian / CI containers)
const pricingRoot = path.resolve(__dirname, '..')
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

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const {
  parsePriceToToman,
  parseColleaguePriceListText,
  resolveSupplyCost,
  computeHardFloorPrice,
} = loadTsModule('src/lib/pricing/sourcing.ts')
const { parsePersianRelativeDate, applyValidityFilters } = loadTsModule('src/lib/pricing/filters.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { calibrateCeilingForExactFloor } = loadTsModule('src/lib/pricing/discount.ts')
const { pickCampaign } = loadTsModule('src/lib/pricing/campaigns.ts')
const { selectBestTorobSearchMatch, evaluateTorobCandidate } = loadTsModule('src/lib/pricing/matcher.ts')
const { classifyThreeZoneScore, buildSubqSystemOneRequestBody } = loadTsModule('src/lib/pricing/systemone-supervisor.ts')
const { computeConfidence } = loadTsModule('src/lib/pricing/confidence.ts')
const { parseTorobJson } = loadTsModule('src/lib/sources/torob.ts')
const { convertMcpDetailsToOffers, analyzeMcpPriceHistory } = loadTsModule('src/lib/sources/torob-mcp-client.ts')

const now = new Date('2026-10-14T08:00:00Z')

test('۱. اولویت اول: نرمال‌سازی قیمت همکاران (تومان، ریال با صفر اضافی، ارقام فارسی و ضرایب میلیونی)', () => {
  assert.equal(parsePriceToToman('۲,۴۵۰,۰۰۰ تومان', 'auto'), 2450000)
  assert.equal(parsePriceToToman('24,500,000 ریال', 'auto'), 2450000)
  assert.equal(parsePriceToToman('24500000', 'rial'), 2450000)
  assert.equal(parsePriceToToman(24500000, 'auto', 2400000), 2450000)
  assert.equal(parsePriceToToman('2.45 م', 'auto'), 2450000)
})

test('۲. اولویت اول: انتخاب هوشمند همکار (ترجیح همکار مشهد و محاسبه خط قرمز قطعی فروش)', () => {
  const colleagueText = [
    'پخش شرق مشهد, 2320000, مشهد, 9, in, 0',
    'همکار لاله‌زار تهران, 2295000, تهران, 7, in, 1, 45000',
    'همکار ناموجود, 2100000, مشهد, 8, out, 0',
    'همکار قدیمی, 2050000, تهران, 6, in, 15',
  ].join('\n')

  const quotes = parseColleaguePriceListText(colleagueText, 'auto', now)
  assert.equal(quotes.length, 4)

  const res = resolveSupplyCost({
    supplierQuotes: quotes,
    manualCostPrice: 2300000,
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  assert.equal(res.validQuotesCount, 2)
  assert.equal(res.selectedQuote.supplierName, 'پخش شرق مشهد')
  assert.equal(res.baseBuyPrice, 2320000)
  assert.equal(res.effectiveCostPrice, 2331600)
  assert.equal(res.hardFloorPrice, 2402000)
  assert.ok(res.hardFloorPrice > res.effectiveCostPrice, 'خط قرمز فروش باید اکیداً بزرگتر از قیمت تمام‌شده تامین باشد')
})

test('۳. تضمین ریاضی عدم عبور از خط قرمز حتی با گرد کردن روانی x900', () => {
  const floorX900 = computeHardFloorPrice({
    effectiveCostPrice: 2000000,
    minMarginPct: 3,
    minProfitAmountToman: 10000,
    finalStep: 1000,
    psychological: 'x900',
  })
  assert.equal(floorX900, 2060900)
  assert.ok(floorX900 >= 2060000)
})

test('۴. پارس کردن عبارات زمانی فارسی ترب و استخراج شهر مشهد در Torob MCP', () => {
  const twoHoursAgo = parsePersianRelativeDate('۲ ساعت پیش', now)
  assert.equal(Math.round((now - twoHoursAgo) / 3600000), 2)

  const eightMonthsAgo = parsePersianRelativeDate('۸ ماه و ۹ روز پیش', now)
  assert.ok((now - eightMonthsAgo) / 86400000 > 240)

  const sampleTorobPayload = {
    random_key: 'prk-test-123',
    name1: 'دوربین مداربسته داهوا مدل DH-IPC-HFW1230S',
    products_info: {
      count: 3,
      result: [
        {
          shop_name: 'شرق دیجیتال',
          shop_name2: 'مشهد',
          shop_id: 101,
          shop_score: 4.9,
          shop_votes_count: 42,
          price: 2450000,
          availability: true,
          is_price_unreliable: false,
          last_price_change_date: '۲ ساعت پیش',
        },
        {
          shop_name: 'فروشگاه غیرقابل اعتماد',
          shop_name2: 'تهران',
          shop_id: 102,
          price: 1980000,
          availability: true,
          is_price_unreliable: true,
          last_price_change_date: '۱ ساعت پیش',
        },
      ],
    },
    products_in_store_info: {
      count: 1,
      result: [
        {
          shop_name: 'پاساژ تک مشهد',
          shop_name2: 'مشهد',
          shop_id: 201,
          price: 2460000,
          is_price_unreliable: false,
          last_price_change_date: '۱ روز پیش',
          score_info: { score: 4.8 },
        },
      ],
    },
  }

  const parsed = parseTorobJson(sampleTorobPayload, now)
  assert.equal(parsed.offers.length, 3)
  assert.equal(parsed.offers[0].shopCity, 'مشهد')
  assert.equal(parsed.offers[0].sellerType, 'online')
  assert.equal(parsed.offers[1].priceUnreliable, true)
  assert.equal(parsed.offers[2].shopCity, 'مشهد')
  assert.equal(parsed.offers[2].sellerType, 'in_person')

  const filtered = applyValidityFilters(parsed.offers, DEFAULT_PROFILE_CONFIG.filters, now, DEFAULT_PROFILE_CONFIG.rank1)
  assert.equal(filtered[0].included, true)
  assert.equal(filtered[0].isLocalCity, true)
  assert.equal(filtered[1].included, false)
  assert.equal(filtered[2].included, true)
  assert.equal(filtered[2].isLocalCity, true)
})

test('۵. سناریوی سطح ۱: کسب رتبه ۱ کل ترب و رتبه ۱ مشهد وقتی کف بازار بالای خط قرمز همکار است', () => {
  const source = {
    source: 'torob',
    productTitle: 'دوربین داهوا 2MP',
    offers: [
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'شرق دیجیتال', shopCity: 'مشهد', price: 2470000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ],
    totalSellerCount: 12,
    fetchedAt: now,
    ok: true,
  }

  const result = runPricingPipeline(source, {
    productId: 1,
    productName: 'دوربین داهوا 2MP',
    costPrice: 2300000,
    supplierQuotes: [{ supplierName: 'پخش مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  assert.equal(result.strategy, 'national_rank1_undercut')
  assert.equal(result.position.competitionTier, 'national_rank1')
  assert.ok(result.finalPrice < 2460000, 'باید زیر ارزان‌ترین فروشنده کل ترب باشد')
  assert.ok(result.finalPrice >= result.supply.hardFloorPrice, 'باید بالای خط قرمز سود همکار باشد')
  assert.equal(result.position.projectedNationalRank, 1)
  assert.equal(result.position.projectedLocalRank, 1)
})

test('۶. سناریوی سطح ۲: وقتی رقبای شهرهای دیگر زیر قیمت خرید همکار می‌فروشند → بازگشت هوشمند و کسب رتبه ۱ شهر مشهد', () => {
  const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
  const source = {
    source: 'torob',
    productTitle: 'هارد وسترن بنفش 4TB',
    offers: [
      { shopName: 'بانه استور', shopCity: 'بانه', price: 2380000, lastChangedAt: now, inStock: true, shopScore: 4.1 },
      { shopName: 'لاله‌زار دیجیتال', shopCity: 'تهران', price: 2390000, lastChangedAt: now, inStock: true, shopScore: 4.2 },
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2440000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'پاساژ تک مشهد', shopCity: 'مشهد', price: 2455000, lastChangedAt: now, inStock: true, sellerType: 'in_person', shopScore: 4.8 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2470000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'مقداد آی‌تی', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ],
    totalSellerCount: 15,
    fetchedAt: now,
    ok: true,
  }

  const result = runPricingPipeline(source, {
    productId: 2,
    productName: 'هارد وسترن بنفش 4TB',
    costPrice: 2320000,
    supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    config: cfg,
    now,
  })

  assert.equal(result.strategy, 'local_city_rank1_undercut')
  assert.equal(result.position.competitionTier, 'local_city_rank1')
  assert.equal(result.finalPrice, 2435000)
  assert.ok(result.finalPrice >= result.supply.hardFloorPrice, 'خط قرمز قیمت خرید رعایت شده است')
  assert.equal(result.position.projectedLocalRank, 1, 'رتبه ۱ مطلق در شهر مشهد')
  assert.equal(result.position.projectedNationalRank, 3, 'رتبه ۳ در کل ترب')
})

test('۷. سناریوی سطح ۳: وقتی هم در تهران و هم در مشهد ۱ فروشنده زیر قیمت خرید ماست → قرارگیری در رتبه ۱ گروه فروشندگان قابل رقابت بالای کف', () => {
  const source = {
    source: 'torob',
    productTitle: 'سوئیچ شبکه تی‌پی‌لینک',
    offers: [
      { shopName: 'تهران ارزان (زیر فی همکار)', shopCity: 'تهران', price: 2375000, lastChangedAt: now, inStock: true, shopScore: 4.0 },
      { shopName: 'مشهد حراجی (زیر فی همکار)', shopCity: 'مشهد', price: 2385000, lastChangedAt: now, inStock: true, shopScore: 4.1 },
      { shopName: 'مقداد آی‌تی', shopCity: 'تهران', price: 2450000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    ],
    totalSellerCount: 16,
    fetchedAt: now,
    ok: true,
  }

  const result = runPricingPipeline(source, {
    productId: 3,
    productName: 'سوئیچ شبکه تی‌پی‌لینک',
    costPrice: 2320000,
    supplierQuotes: [{ supplierName: 'پخش مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  assert.equal(result.strategy, 'local_cluster_rank1')
  assert.ok(result.finalPrice >= result.supply.hardFloorPrice)
  assert.ok(result.finalPrice < 2460000, 'باید سرگروه فروشندگان قابل رقابت در مشهد شود')
})

test('۸. سناریوی سطح ۴ (حفاظت مطلق در بازار بحرانی): وقتی تمام رقبا زیر قیمت خرید جدید همکاران می‌فروشند', () => {
  const source = {
    source: 'torob',
    productTitle: 'مودم سیم‌کارتی تی‌پی‌لینک',
    offers: [
      { shopName: 'فروشگاه ۱', shopCity: 'مشهد', price: 2380000, lastChangedAt: now, inStock: true },
      { shopName: 'فروشگاه ۲', shopCity: 'تهران', price: 2400000, lastChangedAt: now, inStock: true },
      { shopName: 'فروشگاه ۳', shopCity: 'مشهد', price: 2420000, lastChangedAt: now, inStock: true },
      { shopName: 'فروشگاه ۴', shopCity: 'تهران', price: 2450000, lastChangedAt: now, inStock: true },
    ],
    totalSellerCount: 10,
    fetchedAt: now,
    ok: true,
  }

  const result = runPricingPipeline(source, {
    productId: 4,
    productName: 'مودم سیم‌کارتی تی‌پی‌لینک',
    costPrice: 2200000,
    currentFinalPrice: 2370000,
    supplierQuotes: [
      { supplierName: 'پخش مرکزی مشهد', rawPrice: '26,000,000 ریال', supplierCity: 'مشهد', priority: 10, inStock: true, updatedAt: now },
    ],
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  assert.equal(result.supply.effectiveCostPrice, 2613000)
  assert.equal(result.supply.hardFloorPrice, 2692000)
  assert.equal(result.finalPrice, 2692000)
  assert.ok(result.finalPrice > result.supply.effectiveCostPrice)
})

test('۹. سناریوی «قیمت‌گذار معیار بازار (Market-Maker Consensus)»: وقتی محصول نه لیست همکار دارد و نه قیمت خرید (costPrice = 0)', () => {
  const source = {
    source: 'torob',
    productTitle: 'دستگاه NVR داهوا 8 کانال',
    offers: [
      { shopName: 'فروشگاه قدیمی ۱', shopCity: 'تهران', price: 1850000, lastChangedAt: new Date(now.getTime() - 20 * 86400000), inStock: true, shopScore: 4.0 },
      { shopName: 'فروشگاه جامانده ۲ (تازه خزش شده اما قیمت قدیم!)', shopCity: 'اصفهان', price: 1920000, lastChangedAt: now, inStock: true, shopScore: 3.9 },
      { shopName: 'تک‌فروش ارزان ریسکی', shopCity: 'بانه', price: 2380000, lastChangedAt: new Date(now.getTime() - 4 * 86400000), inStock: true, shopScore: 4.1 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2530000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'مقداد آی‌تی', shopCity: 'تهران', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'گران‌فروش کاذب', shopCity: 'تهران', price: 3400000, lastChangedAt: now, inStock: true, shopScore: 4.1 },
    ],
    totalSellerCount: 18,
    fetchedAt: now,
    ok: true,
  }

  const result = runPricingPipeline(source, {
    productId: 99,
    productName: 'دستگاه NVR داهوا 8 کانال',
    costPrice: 0,
    supplierQuotes: [],
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  const includedPrices = result.offers.filter((o) => o.included).map((o) => o.price)
  assert.ok(!includedPrices.includes(1850000), 'فروشنده قدیمی باید حذف شود')
  assert.ok(!includedPrices.includes(1920000), 'فروشنده جامانده با اختلاف شدید پایین باید حذف شود')
  assert.ok(!includedPrices.includes(3400000), 'گران‌فروش پرت باید حذف شود')

  assert.equal(result.supply.usedMarketConsensusFloor, true)
  assert.equal(result.supply.costSource, 'market_consensus_safe_floor')
  assert.equal(result.strategy, 'market_maker_consensus')
  assert.equal(result.position.competitionTier, 'market_maker_consensus')
  assert.ok(result.finalPrice >= 2490000 && result.finalPrice <= 2530000)
  assert.ok(result.basePrice > result.finalPrice)
  assert.equal(result.needsReview, false)
})

test('۱۰. تبدیل کامل خروجی ابزارهای torob-mcp (product_details و price_history)', () => {
  const mcpDetails = {
    prk: 'uuid-999',
    name_fa: 'دوربین هایک‌ویژن',
    cheapest_price_toman: 1850000,
    available: true,
    offer_count: 2,
    in_person_count: 1,
    offers: [
      {
        shop_name: 'ایمن تصویر مشهد',
        shop_city: 'مشهد',
        shop_id: '501',
        shop_score: 4.9,
        shop_votes: 80,
        price_toman: 1850000,
        available: true,
        price_unreliable: false,
        is_adv: false,
        postage_fee_toman: 0,
        delivered_price_toman: 1850000,
        last_price_change_date: '۳ ساعت پیش',
      },
    ],
    in_person_sellers: [
      {
        shop_name: 'فروشگاه سعدی مشهد',
        shop_id: '502',
        city: 'مشهد',
        price_toman: 1870000,
        price_unreliable: false,
        last_price_change_date: 'دیروز',
        score: 5,
        url: 'https://torob.com/shop/502/',
      },
    ],
  }

  const converted = convertMcpDetailsToOffers(mcpDetails, now)
  assert.equal(converted.offers.length, 2)
  assert.equal(converted.totalSellerCount, 3)
  assert.equal(converted.inPersonSellerCount, 1)

  const trend = analyzeMcpPriceHistory({
    series: [
      {
        label: 'کمترین قیمت',
        points: [
          { date: '۱ شهریور', value: 2000000 },
          { date: '۱ مهر', value: 1850000 },
        ],
      },
    ],
  })
  assert.equal(trend.direction, 'falling')
  assert.equal(trend.changePct30d, -7.5)
})

test('۱۱. کشف اصولی «سقف واقعی بازار تحت رصد» (بدون قیمت‌های پرت ترب) و کالیبراسیون دقیق درصد تخفیف روی کف', () => {
  // بررسی کالیبراسیون ریاضی سقف به کف:
  const cal = calibrateCeilingForExactFloor(2750000, 2435000, 11)
  assert.equal(Math.round(cal.calibratedCeiling * (1 - cal.discountPct / 100)), 2435000)

  // اجرای پایپلاین با یک گران‌فروش پرت (4,200,000) و بدنه بازار بین 2,460,000 تا 2,680,000:
  const source = {
    source: 'torob',
    productTitle: 'دزدگیر اماکن سایلکس',
    offers: [
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2520000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2580000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2620000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2680000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'گران‌فروش پرت ترب', shopCity: 'تهران', price: 4200000, lastChangedAt: now, inStock: true, shopScore: 4.1 },
    ],
    totalSellerCount: 14,
    fetchedAt: now,
    ok: true,
  }

  const res = runPricingPipeline(source, {
    productId: 10,
    productName: 'دزدگیر اماکن سایلکس',
    costPrice: 2320000,
    supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    config: DEFAULT_PROFILE_CONFIG,
    now,
  })

  // ۱) گران‌فروش پرت 4,200,000 نباید سقف را 오염 کند
  assert.ok(res.floorCeiling.monitoredMarketCeiling < 3000000, 'سقف بازار باید از فروشندگان معتبر و بدون پرت استخراج شود')
  assert.ok(res.floorCeiling.excludedOutliersCount >= 1, 'گران‌فروش پرت باید از رادار سقف حذف شده باشد')

  // ۲) وقتی درصد تخفیف صحیح (discountPct) روی سقف (basePrice) اعمال می‌شود، باید دقیقاً برابر کف (finalPrice) شود!
  const restoredFloor = Math.round(res.basePrice * (1 - res.discountPct / 100))
  assert.equal(restoredFloor, res.finalPrice, 'اعمال درصد تخفیف روی سقف باید دقیقاً کف هدف را بازتولید کند')
})

test('۱۲. کنترل کامل هر ۳ سیستم تخفیف sgeooole (flash, featured, timed_sale) و اعمال روی رنج کارت‌ها', () => {
  const sampleCampaigns = [
    {
      id: 1,
      name: 'پیشنهاد لحظه‌ای صفحه اصلی',
      type: 'flash',
      active: true,
      priority: 15,
      minDiscountPct: 8,
      maxDiscountPct: 40,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 12,
      badgeTheme: 'gold-red',
      showInFeatured: false,
      cardRangeFrom: 1,
      cardRangeTo: 5,
      maxCards: 2,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: true,
      targetProductIds: [],
    },
    {
      id: 2,
      name: 'پیشنهاد شگفت‌انگیز صفحه اصلی',
      type: 'featured',
      active: true,
      priority: 10,
      minDiscountPct: 5,
      maxDiscountPct: 40,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 48,
      badgeTheme: 'red-purple',
      showInFeatured: true,
      cardRangeFrom: 6,
      cardRangeTo: 15,
      maxCards: 10,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: false,
      targetProductIds: [],
    },
    {
      id: 3,
      name: 'فرصت زمان‌دار ویژه مشهد (بخش مالی و تخفیف)',
      type: 'timed_sale',
      active: true,
      priority: 8,
      minDiscountPct: 3,
      maxDiscountPct: 40,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 72,
      badgeTheme: 'green-orange',
      showInFeatured: true,
      cardRangeFrom: 16,
      cardRangeTo: 50,
      maxCards: 0,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: false,
      targetProductIds: [],
    },
  ]

  // کارت #۲ با رتبه ۱ مشهد و ۱۰٪ تخفیف → باید وارد سیستم ۱ (پیشنهاد لحظه‌ای flash) شود
  const c1 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 2,
    projectedLocalRank: 1,
    finalPrice: 2450000,
    now,
  })
  assert.equal(c1.type, 'flash')
  assert.equal(c1.badgeTheme, 'gold-red')

  // کارت #۸ با ۱۰٪ تخفیف → خارج از رنج کارت ۱..۵ است، پس باید وارد سیستم ۲ (پیشنهاد شگفت‌انگیز featured) شود
  const c2 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 8,
    projectedLocalRank: 1,
    finalPrice: 2450000,
    now,
  })
  assert.equal(c2.type, 'featured')
  assert.equal(c2.badgeTheme, 'red-purple')

  // کارت #۲۰ با ۱۰٪ تخفیف → در رنج کارت ۱۶..۵۰ قرار دارد، پس باید وارد سیستم ۳ (فرصت زمان‌دار مالی و تخفیف timed_sale) با showInFeatured=true شود
  const c3 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 20,
    projectedLocalRank: 2,
    finalPrice: 2450000,
    now,
  })
  assert.equal(c3.type, 'timed_sale')
  assert.equal(c3.badgeTheme, 'green-orange')
  assert.equal(c3.showInFeatured, true)
  assert.equal(c3.campaignName, 'فرصت زمان‌دار ویژه مشهد (بخش مالی و تخفیف)')
})


test('۱۳. موتور ۷ لایه تشخیص هویت محصول و انتخاب بدون خطای کارت ترب از بین نتایج شلوغ جستجو', () => {
  const targetProduct = {
    productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 رزولوشن 2 مگاپیکسل',
    sku: 'DH-IPC-HFW1230S-S5',
    anchorPriceToman: 2450000,
  }

  // فرض کنید در جستجوی ترب این ۶ نتیجه برمی‌گردد:
  const noisySearchResults = [
    {
      prk: 'prk-accessory-1',
      titleFa: 'پایه و کاور دوربین مداربسته داهوا مدل DH-IPC-HFW1230S',
      priceToman: 185000,
      sellerCount: 8,
      available: true,
    },
    {
      prk: 'prk-bundle-4x',
      titleFa: 'پک ۴ عددی دوربین مداربسته داهوا مدل DH-IPC-HFW1230S-S5 به همراه هارد',
      priceToman: 11800000,
      sellerCount: 5,
      available: true,
    },
    {
      prk: 'prk-wrong-model',
      titleFa: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1239S-A-LED رزولوشن 2 مگاپیکسل',
      priceToman: 2690000,
      sellerCount: 14,
      available: true,
    },
    {
      prk: 'prk-wrong-mp',
      titleFa: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1431S رزولوشن 4 مگاپیکسل',
      priceToman: 3100000,
      sellerCount: 11,
      available: true,
    },
    {
      prk: 'prk-single-seller-unmerged',
      titleFa: 'دوربین مداربسته داهوا HFW1230S-S5 ظرفیت 2MP',
      priceToman: 2490000,
      sellerCount: 1,
      available: true,
    },
    {
      prk: 'prk-true-merged-main',
      titleFa: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
      priceToman: 2440000,
      sellerCount: 19,
      available: true,
    },
  ]

  const matchOutcome = selectBestTorobSearchMatch(targetProduct, noisySearchResults, 4)

  assert.equal(matchOutcome.confident, true)
  assert.equal(matchOutcome.best.candidate.prk, 'prk-true-merged-main', 'باید دقیقاً لیستینگ ادغام‌شده اصلی همان کد مدل انتخاب شود')
  assert.ok(matchOutcome.best.score >= 85, `امتیاز تطابق باید بالا باشد (${matchOutcome.best.score})`)

  // بررسی اینکه پایه/کاور، پک ۴ عددی، مدل 1239S و مدل 4MP همگی رد شده‌اند:
  const rejectedMap = new Map(matchOutcome.allRanked.map((r) => [r.candidate.prk, r]))
  assert.equal(rejectedMap.get('prk-accessory-1').rejected, true, 'لوازم جانبی باید رد شود')
  assert.equal(rejectedMap.get('prk-bundle-4x').rejected, true, 'پک ۴ عددی باید رد شود')
  assert.equal(rejectedMap.get('prk-wrong-mp').rejected, true, 'مدل ۴ مگاپیکسل به جای ۲ مگاپیکسل باید رد شود')
})


test('۱۴. ناظر بالاسر SubQ SystemOne (مدل subq-snap-preview و نوع noul) با قانون ۳ بازه‌ای شخصی‌سازی‌شده (زیر ۴۵٪ رد، ۴۵ تا ۸۰٪ ریویو، بالای ۸۰٪ تایید خودکار)', () => {
  // ۱) تست تابع ۳ بازه‌ای با آستانه‌های ۴۵٪ و ۸۰٪
  assert.equal(classifyThreeZoneScore(32, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(44.9, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(45, 45, 80), 'review')
  assert.equal(classifyThreeZoneScore(68, 45, 80), 'review')
  assert.equal(classifyThreeZoneScore(79.9, 45, 80), 'review')
  assert.equal(classifyThreeZoneScore(80, 45, 80), 'approve')
  assert.equal(classifyThreeZoneScore(95, 45, 80), 'approve')

  // ۲) تست ساختار دقیق بدنه درخواست SubQ SystemOne مطابق مستندات (/v1/systemone)
  const reqBody = buildSubqSystemOneRequestBody(
    'Product: Dahua DH-IPC-HFW1230S',
    {
      escalate: {
        type: 'noul',
        instructions: 'Should this pricing decision proceed automatically?',
        criteria: {
          true: 'Exact model match and profitable floor price',
          false: 'Mismatch or risk of loss',
        },
      },
    },
    'subq-snap-preview',
  )
  assert.equal(reqBody.model, 'subq-snap-preview')
  assert.equal(reqBody.questions.escalate.type, 'noul')

  // ۳) سناریوی الف: امتیاز بالای ۸۰٪ در هر ۴ مقیاس → تایید قطعی (approve) و ادامه کار خودکار
  const validOffers = [
    { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'تکنولایف', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'کالاتیک', shopCity: 'تهران', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2590000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
  ]

  const approvedRes = runPricingPipeline(
    {
      source: 'torob',
      productTitle: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
      offers: validOffers,
      totalSellerCount: 14,
      fetchedAt: now,
      ok: true,
    },
    {
      productId: 101,
      productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
      costPrice: 2320000,
      supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )

  assert.equal(approvedRes.supervisor.verdict, 'approve')
  assert.ok(approvedRes.supervisor.overallScorePct >= 80, `امتیاز کل باید >= 80 باشد اما ${approvedRes.supervisor.overallScorePct} بود`)
  assert.equal(approvedRes.rejectedBySupervisor, false)
  assert.equal(approvedRes.needsReview, false)

  // ۴) سناریوی ب: امتیاز بین ۴۵٪ تا ۸۰٪ (مثلاً عنوان مبهم در ترب بدون کد کامل که امتیاز ۶۰٪ می‌گیرد) → ارسال به بخش ریویو (review)
  const reviewRes = runPricingPipeline(
    {
      source: 'torob',
      productTitle: 'دوربین مداربسته تحت شبکه داهوا 2 مگاپیکسل بولت فلزی دید در شب',
      offers: validOffers,
      totalSellerCount: 14,
      fetchedAt: now,
      ok: true,
    },
    {
      productId: 102,
      productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
      costPrice: 2320000,
      supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )
  assert.equal(reviewRes.supervisor.verdict, 'review')
  assert.equal(reviewRes.rejectedBySupervisor, false)
  assert.equal(reviewRes.needsReview, true, 'در بازه ۴۵ تا ۸۰/۹۶ درصد باید به بخش ریویو برود')

  // ۵) سناریوی ج: امتیاز زیر ۴۵٪ در ورودی (مثلاً کارت ترب «پایه دوربین» است نه خود دوربین) → رد کامل (reject)
  const rejectedRes = runPricingPipeline(
    {
      source: 'torob',
      productTitle: 'پایه و کاور دوربین مداربسته داهوا مدل DH-IPC-HFW1230S',
      offers: validOffers,
      totalSellerCount: 14,
      fetchedAt: now,
      ok: true,
    },
    {
      productId: 103,
      productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
      costPrice: 2320000,
      supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )
  assert.equal(rejectedRes.supervisor.gates.identity_match.verdict, 'reject')
  assert.ok(rejectedRes.supervisor.gates.identity_match.scorePct < 45)
  assert.equal(rejectedRes.supervisor.verdict, 'reject')
  assert.equal(rejectedRes.rejectedBySupervisor, true)
})

test('۱۵. مقاوم‌سازی ناظر بالاسر (Fail-Closed): امتیاز نامعتبر NaN/Infinity هرگز نباید تایید خودکار یا ریویو بگیرد', () => {
  // ورودی خراب (NaN، بی‌نهایت، undefined، رشته غیرعددی) باید قطعاً «رد» شود تا هیچ تصمیم مخربی عبور نکند
  assert.equal(classifyThreeZoneScore(NaN, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(Infinity, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(-Infinity, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(undefined, 45, 80), 'reject')
  assert.equal(classifyThreeZoneScore(Number('abc'), 45, 80), 'reject')
  // ورودی سالم هم مثل قبل کار می‌کند
  assert.equal(classifyThreeZoneScore(90, 45, 80), 'approve')
  assert.equal(classifyThreeZoneScore(60, 45, 80), 'review')
})

test('۱۶. اعتماد (Confidence) با ورودی‌های خراب مالی/بازاری هیچ‌گاه NaN تولید نمی‌کند', () => {
  const bad = computeConfidence(
    { count: NaN, dispersion: Infinity },
    { totalSellerCount: NaN, offersTotal: Infinity },
    DEFAULT_PROFILE_CONFIG,
  )
  assert.ok(Number.isFinite(bad.score), 'امتیاز اعتماد باید عدد متناهی باشد')
  assert.equal(bad.score, 0)
  Object.values(bad.breakdown).forEach((v) => assert.ok(Number.isFinite(v)))
})

test('۱۷. حریم ایمنی «بدون داده»: نه قیمت ساختگی، نه رد جعلی ناظر، نه کرش با قیمت‌های غیرمثبت', () => {
  // الف) نبود کامل داده بازار و نبود قیمت خرید: خروجی no_data است، هیچ رد «ناظر» ثبت نمی‌شود
  const cfgDisabledSupervisor = {
    ...DEFAULT_PROFILE_CONFIG,
    supervisor: { ...DEFAULT_PROFILE_CONFIG.supervisor, enabled: false },
  }
  const noData = runPricingPipeline(
    { source: 'torob', productTitle: 'کالای تستی بدون داده', offers: [], totalSellerCount: 0, fetchedAt: now, ok: false },
    { productId: 0, productName: 'کالای تستی بدون داده', costPrice: 0, supplierQuotes: [], config: cfgDisabledSupervisor, now },
  )
  assert.equal(noData.finalPrice, null)
  assert.equal(noData.rejectedBySupervisor, false, 'بدون فعال بودن ناظر، هیچ «رد توسط ناظر» جعلی نباید ثبت شود')
  assert.equal(noData.needsReview, true)

  // ب) پیشنهادهای با قیمت صفر/منفی (داده خراب منبع): به‌جای Math.min(...[]) → Infinity، باید null برگردد
  const zeroPriced = runPricingPipeline(
    {
      source: 'torob',
      productTitle: 'کالای تستی قیمت صفر',
      offers: [
        { shopName: 'فروشگاه خراب الف', price: 0, inStock: true },
        { shopName: 'فروشگاه خراب ب', price: -5000, inStock: true },
      ],
      totalSellerCount: 2,
      fetchedAt: now,
      ok: true,
    },
    { productId: 0, productName: 'کالای تستی قیمت صفر', costPrice: 1000000, supplierQuotes: [], config: cfgDisabledSupervisor, now },
  )
  assert.equal(zeroPriced.lowestRaw, null, 'کمترین قیمت خام باید null باشد نه Infinity')
  const allNumbers = [zeroPriced.lowestRaw, zeroPriced.lowestValid, zeroPriced.marketMedian, zeroPriced.finalPrice]
  allNumbers.forEach((v) => assert.ok(v === null || Number.isFinite(v), 'هیچ عددی نباید Infinity/NaN باشد'))
})
