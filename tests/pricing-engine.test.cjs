const assert = require('node:assert/strict')
const test = require('node:test')

// Loader مشترک TypeScript -> CommonJS (قابل‌حمل روی هر سرور)
const { loadTsModule } = require('./helpers/ts-loader.cjs')

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
const { selectBestTorobSearchMatch, evaluateTorobCandidate, extractModelAndSpecTokens, isInternalOrDatabaseId } = loadTsModule('src/lib/pricing/matcher.ts')
const { classifyThreeZoneScore, buildSubqSystemOneRequestBody } = loadTsModule('src/lib/pricing/systemone-supervisor.ts')
const { computeConfidence } = loadTsModule('src/lib/pricing/confidence.ts')
const { parseTorobJson } = loadTsModule('src/lib/sources/torob.ts')
const { convertMcpDetailsToOffers, analyzeMcpPriceHistory, extractSellerCountFromMcpCard } = loadTsModule('src/lib/sources/torob-mcp-client.ts')

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
  assert.equal(result.finalPrice, 2438000)
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

test('۹. مسیر Provisional بازار بدون قیمت خرید (costPrice = 0): صدک امن بازار + ریویو اجباری + کشف تعارض suspect_low', () => {
  const source = {
    source: 'torob',
    productTitle: 'دستگاه NVR داهوا 8 کانال',
    offers: [
      { shopName: 'فروشگاه قدیمی ۱', shopCity: 'تهران', price: 1850000, lastChangedAt: new Date(now.getTime() - 20 * 86400000), inStock: true, shopScore: 4.0 },
      { shopName: 'ف2 (تازه خزش شده اما ارزان مشکوک!)', shopCity: 'اصفهان', price: 1920000, lastChangedAt: now, inStock: true, shopScore: 3.9 },
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
  assert.ok(!includedPrices.includes(1920000), 'فروشنده ارزانِ مشکوکِ منفرد (suspect_low) باید از داده خوب حذف شود')
  assert.ok(!includedPrices.includes(3400000), 'گران‌فروش پرت باید حذف شود')

  // مسیر Provisional: قیمت = صدک امن پول به‌روز و معتبر، بدون ساخت قیمت خرید و بدون اعمال خودکار
  assert.equal(result.isProvisional, true)
  assert.equal(result.strategy, 'provisional_market_percentile')
  assert.equal(result.position.competitionTier, 'provisional_market_percentile')
  assert.equal(result.supply.usedMarketConsensusFloor, false)
  assert.equal(result.supply.effectiveCostPrice, 0)
  assert.ok(result.finalPrice != null && result.finalPrice > 2400000 && result.finalPrice <= 2530000)
  assert.equal(result.needsReview, true)
  assert.equal(result.rejectedBySupervisor, false)
  assert.ok(
    result.reviewReasons.some((r) => r.includes('قیمت Provisional')),
    'ریویو اجباری برای مسیر Provisional ثبت نشده است',
  )
  assert.ok(
    result.reviewReasons.some((r) => r.includes('تعارض بازار')),
    'فروشنده suspect_low زیر قیمت ما باید به عنوان تعارض بازار گزارش شود',
  )
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

test('۱۲. کنترل هر ۳ سیستم تخفیف sgeooole در نسخه ۴.۱ (گیت flash، صراحت timed_sale و بی‌اثر شدن رنج کارت در انتخاب خودکار)', () => {
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

  // ۱) flash با گیت واقعی بودن افت: مرجع own_price_7d + افت واقعی 11.9% نسبت به میانگین ۷ روزه خودی
  const c1 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 2,
    projectedLocalRank: 1,
    finalPrice: 2290000,
    discountKind: 'own_price_7d',
    ownAvg7d: 2600000,
    now,
  })
  assert.equal(c1.type, 'flash')
  assert.equal(c1.badgeTheme, 'gold-red')
  assert.ok(c1.reason.includes('افت واقعی'), 'لاگ flash باید افت واقعی میانگین ۷ روزه را ثبت کند')

  // ۲) مرجع wrong (market_p75) هرگز flash نمی‌شود → می‌رود سراغ featured
  const c2 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 8,
    projectedLocalRank: 1,
    finalPrice: 2290000,
    discountKind: 'market_p75',
    ownAvg7d: 2600000,
    now,
  })
  assert.equal(c2.type, 'featured')
  assert.equal(c2.showInFeatured, true)

  // ۳) افت واقعی خوب (فقط 2.1%) گیت flash را پاس نمی‌زند → featured
  const c3 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 2,
    projectedLocalRank: 1,
    finalPrice: 2290000,
    discountKind: 'own_price_7d',
    ownAvg7d: 2340000,
    now,
  })
  assert.equal(c3.type, 'featured')

  // ۴) رنج کارت دیگر انتخاب خودکار را کنترل نمی‌کند (P2-6/M8): کارت #۲۰ هم‌چنان featured است
  const c4 = pickCampaign(sampleCampaigns, {
    discountPct: 10,
    cardIndex: 20,
    projectedLocalRank: 2,
    finalPrice: 2290000,
    discountKind: 'market_p75',
    ownAvg7d: 2600000,
    now,
  })
  assert.equal(c4.type, 'featured', 'رنج کارت نباید مانع انتخاب خودکار featured شود')

  // ۵) timed_sale هرگز خودکار انتخاب نمی‌شود؛ فقط تخصیص صریح با targetProductIds (P2-6)
  const withTargetedTimed = sampleCampaigns.map((c) =>
    c.id === 3 ? { ...c, targetProductIds: [77] } : c,
  )
  const c5 = pickCampaign(withTargetedTimed, {
    discountPct: 6,
    cardIndex: 20,
    projectedLocalRank: 2,
    finalPrice: 2290000,
    discountKind: 'market_p75',
    ownAvg7d: 2600000,
    productId: 77,
    now,
  })
  assert.equal(c5.type, 'timed_sale')
  assert.equal(c5.campaignId, 3)
  assert.equal(c5.showInFeatured, true)
  assert.ok(c5.reason.includes('نمایش در منتخب‌های صفحه اصلی'))
  assert.ok(c5.endsAt instanceof Date && !Number.isNaN(c5.endsAt.getTime()), 'تایمر ۷۲ ساعته timed_sale صریح تعیین می‌شود')

  // ۶) همان کارت #۲۰ بدون تخصیص صریح، هرگز timed_sale نمی‌گیرد
  const c6 = pickCampaign(sampleCampaigns, {
    discountPct: 6,
    cardIndex: 20,
    projectedLocalRank: 2,
    finalPrice: 2290000,
    discountKind: 'market_p75',
    ownAvg7d: 2600000,
    productId: 77,
    now,
  })
  assert.notEqual(c6.type, 'timed_sale', 'timed_sale بدون صراحت انتخاب نمی‌شود')
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

  // ۳) سناریوی الف: سوددهی خوب (حاشیه بالای ~۱۹٪ گیت ۳ جدید) با هر ۴ گیت سالم → تایید قطعی (approve) و اعمال خودکار
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
      //supplierList: 1,950,000 → effective 1,959,750 → حاشیه ~۲۰٪ گیت سود را approve می‌کند
      costPrice: 1950000,
      supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 1950000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )

  assert.equal(approvedRes.supervisor.verdict, 'approve')
  assert.ok(approvedRes.supervisor.overallScorePct >= 80, `امتیاز کل باید >= 80 باشد اما ${approvedRes.supervisor.overallScorePct} بود`)
  assert.equal(approvedRes.supervisor.gates.profit_and_rank_safety.verdict, 'approve', 'گیت سود تازه باید با حاشیه ~۲۰٪ approve شود')
  assert.equal(approvedRes.rejectedBySupervisor, false)
  assert.equal(approvedRes.needsReview, false)

  // ۴) سناریوی ب: حاشیه سود کم (~۵٪ گیت ۳ → ~۵۸%) اما امتیاز کل در بازه ریویو (۴۵..۸۰) → ارسال به ریویو (بدون خاموشی پیشنهاد)
  const reviewRes = runPricingPipeline(
    {
      source: 'torob',
      productTitle: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل',
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


test('۱۸. گارد ضد تشخیص اشتباه کارت: نادیده گرفتن شناسه مونگو (_id) و KY-XXXX و عدم تایید خودکار کالای بدون کد مدل روی کارت مدل‌دار ترب', () => {
  assert.equal(isInternalOrDatabaseId('67f8a9b0c1d2e3f4a5b6c7d8'), true)
  assert.equal(isInternalOrDatabaseId('KY-408129'), true)
  assert.equal(isInternalOrDatabaseId('DH-IPC-HFW1230S'), false)

  const fp = extractModelAndSpecTokens('دوربین مداربسته دام دید در شب رنگی', '67f8a9b0c1d2e3f4a5b6c7d8')
  assert.equal(fp.modelTokens.length, 0, 'شناسه ۲۴ کاراکتری مونگو هرگز نباید به عنوان کد مدل فنی استخراج شود')

  // کالای صرفاً فارسی بدون کد مدل در برابر کارت ترب با مدل خاص -> نباید تایید خودکار (>= 80) بگیرد؛ باید به ریویو یا رد برود
  const evalRes = evaluateTorobCandidate(
    {
      productName: 'دوربین مداربسته دام دید در شب',
      sku: 'KY-102030',
      anchorPriceToman: 1500000,
    },
    {
      prk: 'prk-random-cam',
      titleFa: 'دوربین مداربسته دام هایک ویژن مدل DS-2CE56D0T-IRMF دید در شب',
      priceToman: 1480000,
      sellerCount: 9,
      available: true,
    },
    4,
  )
  assert.notEqual(evalRes.verdict, 'approve', 'کالای بدون کد مدل نباید روی یک مدل خاص ترب تایید خودکار بگیرد')
  assert.ok(evalRes.score < 80, `امتیاز باید زیر 80 باشد ولی ${evalRes.score} بود`)
})

test('۱۹. استخراج دقیق تعداد فروشنده از متن فارسی کارت جستجوی Torob MCP', () => {
  assert.equal(
    extractSellerCountFromMcpCard({
      prk: 'p1',
      name_fa: 'تست',
      name_en: null,
      price_toman: 1000,
      available: true,
      shop_name: 'در ۱۴ فروشگاه',
      url: 'https://torob.com/p/p1/',
      details_url: null,
    }),
    14,
  )
})

// ==================================================================
// نسخه ۴.۱ — تست‌های جدید (M1..M8)
// ==================================================================
const { removeOutliers } = loadTsModule('src/lib/pricing/outliers.ts')
const { summarizeMarket } = loadTsModule('src/lib/pricing/aggregate.ts')
const { buildDiscount } = loadTsModule('src/lib/pricing/discount.ts')
const { applyGuards } = loadTsModule('src/lib/pricing/guards.ts')
const { weightedMedian } = loadTsModule('src/lib/pricing/stats.ts')

test('۲۰. آمار وزنی (میانه وزنی) و هیسترزیس متقارن محافظ‌ها + گرد کردن جهت‌دار (P1/P2-1)', () => {
  // میانه وزنی: با وزن‌های بالا، عضو سبک بالای لیست جابه‌جا نمی‌کند
  assert.equal(weightedMedian([10, 20, 30], [5, 2, 1]), 10)
  assert.equal(weightedMedian([10, 20, 30, 40], [1, 1, 1, 1]), 20, 'میانه وزنی با عضو مرزی (بدون میان‌یابی — سازگار با weightedMedianInt outliers)')

  const g = DEFAULT_PROFILE_CONFIG.guards
  const r = DEFAULT_PROFILE_CONFIG.rounding

  // هیسترزیس متقارن ۴.۱: تغییر جزئی صعودی دیگر خودکار اعمال نمی‌شود
  const hyst = applyGuards(2501900, { costPrice: 2400000, minMarginPct: 3, minProfitAmountToman: 10000, currentPrice: 2500000 }, g, r)
  assert.equal(hyst.price, 2500000, 'تغییر 0.08% صعودی باید توسط هیسترزیس متقارن نادیده گرفته شود')
  assert.ok(hyst.notes.some((n) => n.includes('هیسترزیس متقارن')))

  // undercut-anchor → گرد کردن به پایین (هرگز بالای رقیب نرویم)
  const floored = applyGuards(2501900, { costPrice: 2000000, minMarginPct: 3, minProfitAmountToman: 10000, currentPrice: 2410000 }, g, r, { direction: 'floor' })
  assert.equal(floored.price, 2501000)

  // گرد کردن پیش‌فرض (نزدیک) → به بالا
  const ceiled = applyGuards(2501900, { costPrice: 2000000, minMarginPct: 3, minProfitAmountToman: 10000, currentPrice: 2410000 }, g, r)
  assert.equal(ceiled.price, 2502000)

  // جهش زیر کف: سقف تغییر نباید جلوی فرار از فروش زیان‌ده را بگیرد
  const jump = applyGuards(2600000, { costPrice: 2400000, minMarginPct: 3, minProfitAmountToman: 10000, currentPrice: 2000000 }, g, r)
  assert.equal(jump.price, 2472000)
  assert.equal(jump.floorEnforced, true)
  assert.equal(jump.needsReview, true)
})

test('۲۱. سیاست تقاطع قیمت انبار/ریپلیس (M2): replacement_floor هشدار می‌دهد ولی ملاک ریپلیس است', () => {
  const q = [{ supplierName: 'پخش شرق مشهد', rawPrice: '23,200,000 ریال', supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }]
  const manualCost = 2500000 // انبار گران‌تر از بازار

  const x0 = resolveSupplyCost({ supplierQuotes: q, manualCostPrice: manualCost, config: DEFAULT_PROFILE_CONFIG, now })
  assert.equal(x0.costPolicyUsed, 'replacement_floor')
  assert.equal(x0.effectiveCostPrice, 2331600, 'ملاک = ریپلیس ارزان‌تر')
  assert.equal(x0.selectedQuote.supplierName, 'پخش شرق مشهد')
  assert.ok(x0.inventoryReplacementWarning != null, 'گذار به قیمت زیر هزینه انبار باید هشدار جایگزینی بدهد')
  assert.ok(x0.explanation.includes('ریپلیس') || x0.explanation.includes('انبار'))

  const legacyCfg = {
    ...DEFAULT_PROFILE_CONFIG,
    sourcing: { ...DEFAULT_PROFILE_CONFIG.sourcing, costPolicy: 'legacy_never_below_manual' },
  }
  const leg = resolveSupplyCost({ supplierQuotes: q, manualCostPrice: manualCost, config: legacyCfg, now })
  assert.equal(leg.costPolicyUsed, 'legacy_never_below_manual')
  assert.equal(leg.effectiveCostPrice, 2500000, 'رفتار قدیمی: قیمت انبار ملاک است')
  assert.ok(leg.warnings.some((w) => w.includes('برای جلوگیری از ضرر روی موجودی فعلی')))

  const maxCfg = {
    ...DEFAULT_PROFILE_CONFIG,
    sourcing: { ...DEFAULT_PROFILE_CONFIG.sourcing, costPolicy: 'max_inventory_replacement' },
  }
  const mx = resolveSupplyCost({ supplierQuotes: q, manualCostPrice: manualCost, config: maxCfg, now })
  assert.equal(mx.costPolicyUsed, 'max_inventory_replacement')
  assert.equal(mx.effectiveCostPrice, 2500000, 'کف از بیشینه انبار/ریپلیس')
  assert.ok(mx.warnings.some((w) => w.includes('max_inventory_replacement')))
})

test('۲۲. طبقه‌بندی R0/R1 فروشندگان پرت پایین (M2): خوشه واقعی می‌ماند، تکی مشکوک حذف و ثبت می‌شود', () => {
  const offers = [
    { shopName: 'خوشه الف', shopCity: 'تهران', price: 2150000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    { shopName: 'خوشه ب', shopCity: 'تهران', price: 2155000, lastChangedAt: now, inStock: true, shopScore: 4.5 },
    { shopName: 'کهنه', shopCity: 'تهران', price: 1980000, lastChangedAt: new Date(now.getTime() - 6 * 86400000), inStock: true, shopScore: 4.6 },
    { shopName: 'تک ارزان', shopCity: 'بانه', price: 2000000, lastChangedAt: now, inStock: true, shopScore: 4.2 },
    { shopName: 'نرمال ۱', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'نرمال ۲', shopCity: 'مشهد', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'نرمال ۳', shopCity: 'تهران', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    { shopName: 'نرمال ۴', shopCity: 'مشهد', price: 2600000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
  ]
  const filtered = applyValidityFilters(offers, DEFAULT_PROFILE_CONFIG.filters, now, DEFAULT_PROFILE_CONFIG.rank1)
  const report = removeOutliers(filtered, DEFAULT_PROFILE_CONFIG.outliers, {
    now,
    highTrustScoreThreshold: DEFAULT_PROFILE_CONFIG.rank1.highTrustScoreThreshold,
  })

  assert.equal(report.stableRefPrice, 2480000, 'مرجع پایدار باید مرکز فروشندگان پایدار باشد')
  assert.equal(report.removed, 2, 'دو فروشنده مشکوک/کهنه پایین حذف شدند')

  const byKind = new Map(
    filtered.map((o) => [o.shopName, { cls: o.cls, inc: o.included, reason: o.excludeReason ?? null }]),
  )
  assert.equal(byKind.get('خوشه الف').cls, 'confirmed_low', 'خوشه ۲ عضوی واقعی و به‌روز زیر مرجع = confirmed_low')
  assert.equal(byKind.get('خوشه ب').cls, 'confirmed_low')
  assert.equal(byKind.get('خوشه الف').inc, true)
  assert.equal(byKind.get('تک ارزان').cls, 'suspect_low')
  assert.equal(byKind.get('تک ارزان').inc, false)
  assert.equal(byKind.get('کهنه').cls, 'stale_low')

  assert.deepEqual(
    report.suspectLows.map((s) => s.cls).sort(),
    ['stale_low', 'suspect_low'],
    'گزارش suspectLows برای مغز بازار باید کامل باشد',
  )

  // خلاصه بازار: سقف باید از پول پاک استخراج شود (بدون نفوذ خوشه پایین)
  const sum = summarizeMarket(filtered, DEFAULT_PROFILE_CONFIG, now, { suspectLows: report.suspectLows })
  assert.ok(sum.ceiling != null && sum.ceiling > 2500000 && sum.ceiling < 2700000, `سقف معیار باید باند مطلوب باشد (${sum.ceiling})`)
})

test('۲۳. سیاست رهبر منفرد (leader_sole_gap، M4): بازار خلوت و رهبر منفرد → رهبر × (1 + 4%)', () => {
  const offers = [
    { shopName: 'رهبر ارزان منفرد', shopCity: 'تهران', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'پیگیر ۲', shopCity: 'تهران', price: 2620000, lastChangedAt: now, inStock: true, shopScore: 4.5 },
    { shopName: 'پیگیر ۳', shopCity: 'مشهد', price: 2700000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
  ]
  const res = runPricingPipeline(
    { source: 'torob', productTitle: 'کارت آداپتور شبکه', offers, totalSellerCount: 8, fetchedAt: now, ok: true },
    {
      productId: 55,
      productName: 'کارت آداپتور شبکه',
      costPrice: 2300000,
      supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2300000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )
  assert.equal(res.strategy, 'leader_sole_gap')
  assert.equal(res.position.competitionTier, 'leader_sole_gap')
  // رهبر 2,500,000 × 1.04 = 2,600,000 (پرش ۴٪ بدون undercut چشی)
  assert.equal(res.finalPrice, 2600000)
  assert.equal(res.marketConflict, false)
  assert.ok(res.finalPrice >= res.supply.hardFloorPrice)
})

test('۲۴. پله‌های undercut بر اساس انکر (M3): انکر ~۱۲.۵ میلیون → پله ۵,۰۰۰ تومان', () => {
  const offers = [
    { shopName: 'الف', shopCity: 'تهران', price: 12500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'ب', shopCity: 'تهران', price: 12600000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    { shopName: 'ج', shopCity: 'مشهد', price: 12750000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'د', shopCity: 'تهران', price: 12900000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
  ]
  const res = runPricingPipeline(
    { source: 'torob', productTitle: 'دوربین 4 کانال', offers, totalSellerCount: 12, fetchedAt: now, ok: true },
    {
      productId: 56,
      productName: 'دوربین 4 کانال',
      costPrice: 11800000,
      supplierQuotes: [{ supplierName: 'پ', rawPrice: 11800000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )
  assert.equal(res.strategy, 'national_rank1_undercut')
  assert.equal(res.position.projectedNationalRank, 1)
  assert.equal(res.position.projectedLocalRank, 1)
  // انکر 12,500,000 (بازه 10..30M) → undercut = 5000
  assert.equal(res.finalPrice, 12495000)
  assert.ok(res.finalPrice >= res.supply.hardFloorPrice, 'پله undercut هرگز خط قرمز را نمی‌شکند')
})

test('۲۵. مرجع تخفیف own_price_7d (P3): شکاف با تاریخچه خودی → تخفیف ۱۰٪ با کف قطعی بازشده‌ی دقیق', () => {
  const offers = [
    { shopName: 'الف', shopCity: 'تهران', price: 2450000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'ب', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'ج', shopCity: 'مشهد', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'د', shopCity: 'تهران', price: 2530000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
  ]
  const res = runPricingPipeline(
    { source: 'torob', productTitle: 'روتر صنعتی', offers, totalSellerCount: 9, fetchedAt: now, ok: true },
    {
      productId: 61,
      productName: 'روتر صنعتی',
      costPrice: 2320000,
      supplierQuotes: [{ supplierName: 'پ', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
      discountContext: { ownStableHigh7d: 2750000, ownAvg7d: 2600000, hasOwnPriceHistory: true },
    },
  )
  // کف = انکر 2,450,000 − پله 2000 → 2,448,000؛ مرجع خودی 2,750,000 → تخفیف واقعی ۱۰٪
  assert.equal(res.discountReferenceKind, 'own_price_7d')
  assert.equal(res.discountReferencePrice, 2750000)
  assert.equal(res.discountPct, 10)
  assert.equal(res.floorConfirmed, true, 'تخفیف باید دقیقاً روی کف کالیبره و تایید شود')
  const restored = Math.round(res.basePrice * (1 - res.discountPct / 100))
  assert.equal(restored, res.finalPrice, 'بازگردانی درصد تخفیف روی سقف باید دقیقاً کف هدف را بسازد')
})

test('۲۶. مرجع تخفیف بدون تاریخچه خودی → market_p75 (صدک ۷۵ معتبر) و شکاف زیر threshold = بدون تخفیف', () => {
  const offers = [
    { shopName: 'الف', shopCity: 'تهران', price: 2520000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    { shopName: 'ب', shopCity: 'تهران', price: 2550000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    { shopName: 'ج', shopCity: 'مشهد', price: 2570000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    { shopName: 'د', shopCity: 'تهران', price: 2600000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
  ]
  const res = runPricingPipeline(
    { source: 'torob', productTitle: 'روتر صنعتی', offers, totalSellerCount: 9, fetchedAt: now, ok: true },
    {
      productId: 57,
      productName: 'روتر صنعتی',
      costPrice: 2400000,
      supplierQuotes: [{ supplierName: 'پ', rawPrice: 2400000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      config: DEFAULT_PROFILE_CONFIG,
      now,
    },
  )
  assert.equal(res.discountReferenceKind, 'market_p75')
  assert.equal(res.discountReferencePrice, 2577500, 'صدک ۷۵ بازار معتبر = 2,577,500')
  assert.equal(res.discountPct, 0, 'شکاف 2.3% زیر حداقل ۵٪ → تخفیف اعمال نشد')
  assert.equal(res.floorConfirmed, false)
  assert.equal(res.finalPrice, 2518000, 'آخر انکر = ارزان‌ترین معتبر − پله 2000')
})

test('۲۷. ماژول تخفیف (P3): کالیبراسیون exact-floor، سقف با decl مرجع، ورود حداقل و بدون مرجع', () => {
  const discOffers = [
    { shopName: 'مرجع', shopCity: 'تهران', price: 2750000, lastChangedAt: now, inStock: true, shopScore: 4.8, included: true, weight: 1 },
    { shopName: 'ف2', shopCity: 'تهران', price: 2650000, lastChangedAt: now, inStock: true, shopScore: 4.6, included: true, weight: 1 },
  ]
  const cfgD = DEFAULT_PROFILE_CONFIG.discount
  const cfgR = DEFAULT_PROFILE_CONFIG.rounding

  const a = buildDiscount(2435000, discOffers, cfgD, cfgR, { ownStableHigh7d: 2750000, ownAvg7d: 2680000, hasOwnPriceHistory: true })
  assert.equal(a.referenceKind, 'own_price_7d')
  assert.equal(a.discountPct, 11)
  assert.equal(Math.round(a.basePrice * (1 - a.discountPct / 100)), 2435000, 'بازگردانی دقیق کف')
  assert.equal(a.floorConfirmed, true)

  const b = buildDiscount(2435000, discOffers, cfgD, cfgR, {})
  assert.equal(b.referenceKind, 'market_p75')
  assert.equal(b.discountPct, 10)
  assert.equal(b.floorConfirmed, true)

  // کف بالاتر از مرجع معتبر → بدون کمپین (نه درصد منفی و نه کالک فیک)
  const c = buildDiscount(2740000, discOffers, cfgD, cfgR, {})
  assert.equal(c.referenceKind, 'none')
  assert.equal(c.discountPct, 0)
  assert.equal(c.floorConfirmed, false)
  assert.ok(c.explanation.includes('بدون مرجع معتبر'))

  // شکاف عمق (مرجع خیلی بالاتر) → پله‌برنامه از کف وارد می‌شود تا سقف maxDiscount
  const d = buildDiscount(2000000, discOffers, cfgD, cfgR, { ownStableHigh7d: 2750000, ownAvg7d: 2680000, hasOwnPriceHistory: true })
  assert.equal(d.referenceKind, 'own_price_7d')
  assert.equal(d.discountPct, 27, 'floor((2750000-2000000)/2750000*100)=27 در سقف 35 مجاز')
  assert.equal(d.floorConfirmed, true)
})

test('۲۸. گیت‌های کمپین (M8): flash با افت واقعی، مرجع نادرست → featured، احساس صراحت timed_sale', () => {
  const campaigns = [
    { id: 1, name: 'فلش', type: 'flash', active: true, priority: 15, minDiscountPct: 8, maxDiscountPct: 40, activeHours: [], activeDays: [], categories: [], durationHours: 12, badgeTheme: 'gold-red', showInFeatured: false, cardRangeFrom: 1, cardRangeTo: 5, maxCards: 2, minPriceToman: 0, maxPriceToman: 0, onlyTopRanked: true, targetProductIds: [] },
    { id: 2, name: 'شگفت', type: 'featured', active: true, priority: 10, minDiscountPct: 5, maxDiscountPct: 40, activeHours: [], activeDays: [], categories: [], durationHours: 48, badgeTheme: 'red-purple', showInFeatured: true, cardRangeFrom: 6, cardRangeTo: 15, maxCards: 10, minPriceToman: 0, maxPriceToman: 0, onlyTopRanked: false, targetProductIds: [] },
  ]
  const flashInput = { discountPct: 10, cardIndex: 2, projectedLocalRank: 1, finalPrice: 2290000, discountKind: 'own_price_7d', ownAvg7d: 2600000 }
  const p1 = pickCampaign(campaigns, { ...flashInput, now })
  assert.equal(p1.type, 'flash')

  const p2 = pickCampaign(campaigns, { ...flashInput, ownAvg7d: 2340000, now })
  assert.equal(p2.type, 'featured', 'افت 2.1% باید گیت flash را پاس نکند')

  // رنج کارت هیچ انتخاب خودکاری را کنترل نمی‌کند (P2-6/M8): کارت #۴۰ هم سرعت flash را از دست نمی‌دهد
  const p3 = pickCampaign(campaigns, { ...flashInput, cardIndex: 40, now })
  assert.equal(p3.type, 'flash', 'رنج کارت نباید مانع انتخاب خودکار flash (با گیت افت) شود')
})

test('۲۹. شبیه‌ساز رگرسیون ۱۰ سناریو (واحد: هیچ فروش کمتر از قیمت خرید و هیچ قیمتی نان، قیمت Provisional بدون ریویو ممنوع)', () => {
  const scenarios = [
    { name: 'rank1 ملی', source: { source: 'torob', productTitle: 'دوربین داهوا 2MP', offers: [
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'شرق دیجیتال', shopCity: 'مشهد', price: 2470000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ], totalSellerCount: 12, fetchedAt: now, ok: true }, ctx: {
      productId: 1, productName: 'دوربین داهوا 2MP', costPrice: 2300000, supplierQuotes: [{ supplierName: 'پخش مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'بازگشت شهری', source: { source: 'torob', productTitle: 'هارد وسترن 4TB', offers: [
      { shopName: 'بانه استور', shopCity: 'بانه', price: 2380000, lastChangedAt: now, inStock: true, shopScore: 4.1 },
      { shopName: 'لاله‌زار دیجیتال', shopCity: 'تهران', price: 2390000, lastChangedAt: now, inStock: true, shopScore: 4.2 },
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2440000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'پاساژ تک مشهد', shopCity: 'مشهد', price: 2455000, lastChangedAt: now, inStock: true, sellerType: 'in_person', shopScore: 4.8 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2470000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'مقداد آی‌تی', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ], totalSellerCount: 15, fetchedAt: now, ok: true }, ctx: {
      productId: 2, productName: 'هارد وسترن 4TB', costPrice: 2320000, supplierQuotes: [{ supplierName: 'پخش شرق مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'بازار یوزه‌های پایین واقعی', source: { source: 'torob', productTitle: 'ایستگاه NVR', offers: [
      { shopName: 'خوشه الف', shopCity: 'تهران', price: 2150000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'خوشه ب', shopCity: 'تهران', price: 2155000, lastChangedAt: now, inStock: true, shopScore: 4.5 },
      { shopName: 'نرمال ۱', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'نرمال ۲', shopCity: 'مشهد', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'نرمال ۳', shopCity: 'تهران', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ], totalSellerCount: 11, fetchedAt: now, ok: true }, ctx: {
      productId: 3, productName: 'ایستگاه NVR', costPrice: 2300000, supplierQuotes: [{ supplierName: 'پ', rawPrice: 2300000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'بحرانی: همه زیر فی همکار', source: { source: 'torob', productTitle: 'مودم سیم‌کارتی', offers: [
      { shopName: 'فار ۱', shopCity: 'مشهد', price: 2380000, lastChangedAt: now, inStock: true },
      { shopName: 'فار ۲', shopCity: 'تهران', price: 2400000, lastChangedAt: now, inStock: true },
      { shopName: 'فار ۳', shopCity: 'مشهد', price: 2420000, lastChangedAt: now, inStock: true },
      { shopName: 'فار ۴', shopCity: 'تهران', price: 2450000, lastChangedAt: now, inStock: true },
    ], totalSellerCount: 10, fetchedAt: now, ok: true }, ctx: {
      productId: 4, productName: 'مودم سیم‌کارتی', costPrice: 2200000, supplierQuotes: [{ supplierName: 'پخش', rawPrice: '26,000,000 ریال', supplierCity: 'مشهد', priority: 10, inStock: true, updatedAt: now }],
    } },
    { name: 'بدون هزینه (Provisional)', source: { source: 'torob', productTitle: 'NVR ۸ کانال', offers: [
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'شرق مشهد', shopCity: 'مشهد', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'مقداد', shopCity: 'تهران', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    ], totalSellerCount: 14, fetchedAt: now, ok: true }, ctx: {
      productId: 99, productName: 'NVR ۸ کانال', costPrice: 0, supplierQuotes: [],
    } },
    { name: 'رهبر منفرد', source: { source: 'torob', productTitle: 'آداپتور شبکه', offers: [
      { shopName: 'رهبر', shopCity: 'تهران', price: 2500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'پ۲', shopCity: 'تهران', price: 2620000, lastChangedAt: now, inStock: true, shopScore: 4.5 },
      { shopName: 'پ۳', shopCity: 'مشهد', price: 2700000, lastChangedAt: now, inStock: true, shopScore: 4.6 },
    ], totalSellerCount: 6, fetchedAt: now, ok: true }, ctx: {
      productId: 55, productName: 'آداپتور شبکه', costPrice: 2300000, supplierQuotes: [{ supplierName: 'پ', rawPrice: 2300000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'حرکت انکر بالا', source: { source: 'torob', productTitle: 'دوربین 4K', offers: [
      { shopName: 'الف', shopCity: 'تهران', price: 12500000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'ب', shopCity: 'تهران', price: 12600000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'ج', shopCity: 'مشهد', price: 12750000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
    ], totalSellerCount: 9, fetchedAt: now, ok: true }, ctx: {
      productId: 56, productName: 'دوربین 4K', costPrice: 11800000, supplierQuotes: [{ supplierName: 'پ', rawPrice: 11800000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'سودده بالا (تایید خودکار)', source: { source: 'torob', productTitle: 'دوربین داهوا 1230S-S5', offers: [
      { shopName: 'شرق دیجیتال مشهد', shopCity: 'مشهد', price: 2460000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'تکنولایف', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'کالاتیک', shopCity: 'تهران', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
      { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2590000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
    ], totalSellerCount: 14, fetchedAt: now, ok: true }, ctx: {
      productId: 101, productName: 'دوربین داهوا 1230S-S5', costPrice: 1950000, supplierQuotes: [{ supplierName: 'پخش', rawPrice: 1950000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'تعارض suspect_low', source: { source: 'torob', productTitle: 'NVR داهوا', offers: [
      { shopName: 'مفرد مشکوک', shopCity: 'اصفهان', price: 1920000, lastChangedAt: now, inStock: true, shopScore: 3.9 },
      { shopName: 'نه', shopCity: 'تهران', price: 2490000, lastChangedAt: now, inStock: true, shopScore: 4.8 },
      { shopName: 'دو', shopCity: 'تهران', price: 2480000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'سه', shopCity: 'مشهد', price: 2510000, lastChangedAt: now, inStock: true, shopScore: 4.9 },
      { shopName: 'چهار', shopCity: 'تهران', price: 2540000, lastChangedAt: now, inStock: true, shopScore: 4.7 },
    ], totalSellerCount: 12, fetchedAt: now, ok: true }, ctx: {
      productId: 110, productName: 'NVR داهوا', costPrice: 2350000, supplierQuotes: [{ supplierName: 'پ', rawPrice: 2350000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    } },
    { name: 'نه هیچ داده و نه هزینه', source: { source: 'torob', productTitle: 'کالای تستی', offers: [], totalSellerCount: 0, fetchedAt: now, ok: false }, ctx: {
      productId: 0, productName: 'کالای تستی', costPrice: 0, supplierQuotes: [],
    } },
  ]

  let approvals = 0
  for (const s of scenarios) {
    const res = runPricingPipeline(s.source, { ...s.ctx, config: DEFAULT_PROFILE_CONFIG, now })
    if (res.finalPrice == null) {
      // بدون پیشنهاد → ریویو/رد، نباید هیچ قیمت ساختگی سلطنت مشکل
      assert.equal(res.needsReview, true, `${s.name}: خروجی بدون کف حتماً ریویو است`)
      continue
    }
    if (res.isProvisional) {
      // مسیر Provisional: همیشه ریویو، بدون درمان فیک قیمت خرید، بدون اعمال خودکار
      assert.equal(res.needsReview, true, `${s.name}: Provisional بدون ریویو ممنوع`)
      assert.equal(res.supply.effectiveCostPrice, 0)
      assert.equal(res.rejectedBySupervisor, false, 'مسیر Provisional نباید به «رد ساختگی ناظر» برسد')
      continue
    }
    // قانون ریاضی مطلق: کف نهایی بالای خط قرمز و فوق تمام‌شده
    assert.ok(res.finalPrice >= res.supply.hardFloorPrice, `${s.name}: فروش زیر خط قرمز (${res.finalPrice} < ${res.supply.hardFloorPrice})`)
    if (res.supply.effectiveCostPrice > 0) {
      assert.ok(res.finalPrice > res.supply.effectiveCostPrice, `${s.name}: فروش کمتر/مساوی تمام‌شده تامین (${res.finalPrice} ≤ ${res.supply.effectiveCostPrice})`)
    }
    if (res.rejectedBySupervisor) {
      assert.equal(res.needsReview, true, `${s.name}: رد ناظر یعنی نیازمند بازبینی`)
    } else if (!res.needsReview) {
      approvals++
    }
  }
  assert.ok(approvals >= 1, 'باید حداقل یک سناریوی تایید خودکار ناظر (approve) در لجر ثبت شود')
  assert.ok(approvals <= scenarios.length, 'sanity')
})
