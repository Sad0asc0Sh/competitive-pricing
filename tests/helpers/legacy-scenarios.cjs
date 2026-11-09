// سناریوهای تصادفی ولی «قطعی» (seeded) برای مقایسهٔ حالت legacy موتور جدید با خروجی‌های ثبت‌شدهٔ ۴.۱.۲
'use strict'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SHOPS = [
  'دیجی‌کالا', 'تکنولایف', 'شرق دیجیتال', 'کالاتیک', 'پلازا مشهد', 'ایران‌الکترونیک', 'سیستم‌پلاس', 'آرین‌رایان',
  'نواندیشان', 'امین‌کالا', 'ماهان‌شاپ', 'کیان‌نت', 'دنیای امنیت', 'بازار تهران', 'ویژن‌شاپ', 'آوا‌نت', 'طلوع‌کالا',
  'پارس‌دوربین', 'سامانه‌شاپ', 'گلدن‌مارکت', 'رایان‌مال', 'نت‌پرداز', 'امنیت‌گستر', 'هایپرتک',
]
const CITIES = ['تهران', 'مشهد', 'اصفهان', 'شیراز', 'تبریز', 'کرج', 'قم', 'اهواز']
const REL_TEXTS = ['۲ ساعت پیش', '۱ روز پیش', '۳ روز پیش', '۶ روز پیش', '۹ روز پیش', '۲ ماه پیش', 'چند لحظه پیش']

function makeScenarios(n, seed, now) {
  const rnd = mulberry32(seed)
  const U = (a, b) => a + (b - a) * rnd()
  const I = (a, b) => Math.floor(U(a, b + 1))
  const N = () => {
    // Box-Muller
    const u = Math.max(1e-9, rnd())
    const v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const pick = (arr) => arr[I(0, arr.length - 1)]
  const out = []
  for (let s = 0; s < n; s++) {
    const P = Math.round(Math.exp(U(Math.log(4e5), Math.log(6e7))) / 1000) * 1000
    const count = rnd() < 0.06 ? I(0, 2) : I(3, 24)
    const sigma = pick([0.01, 0.02, 0.04, 0.07])
    const offers = []
    const used = new Set()
    for (let i = 0; i < count; i++) {
      let price = P * Math.exp(sigma * N())
      const r = rnd()
      if (r < 0.1) price = P * U(0.5, 0.85)
      else if (r < 0.18) price = P * U(1.2, 2.0)
      price = Math.max(1000, Math.round(price / 1000) * 1000)
      let shopName = pick(SHOPS)
      while (used.has(shopName) && used.size < SHOPS.length) shopName = pick(SHOPS)
      used.add(shopName)
      const useText = rnd() < 0.25
      const ageDays = Math.min(40, -Math.log(1 - rnd()) * 3)
      const offer = {
        shopName,
        shopCity: pick(CITIES.concat(['مشهد', 'مشهد'])),
        sellerType: rnd() < 0.08 ? 'in_person' : 'online',
        shopScore: rnd() < 0.15 ? null : Math.round(U(3, 5) * 10) / 10,
        shopVotes: I(0, 400),
        price,
        guarantee: pick(['enabled', 'disabled', 'disabled', null, 'enabled']),
        priceUnreliable: rnd() < 0.04,
        isAd: rnd() < 0.05,
        inStock: rnd() < 0.92,
      }
      if (useText) offer.lastChangedText = pick(REL_TEXTS)
      else offer.lastChangedAt = new Date(now.getTime() - ageDays * 86400000)
      offers.push(offer)
    }
    offers.sort(() => rnd() - 0.5)
    const cost = Math.round((P * U(0.7, 1.02)) / 1000) * 1000
    const withQuotes = rnd() < 0.4
    const supplierQuotes = withQuotes
      ? [
          {
            supplierName: 'پخش مشهد',
            rawPrice: Math.round((cost * U(0.97, 1.03)) / 1000) * 1000,
            supplierCity: pick(['مشهد', 'تهران']),
            priority: I(1, 10),
            inStock: true,
            updatedAt: new Date(now.getTime() - U(0, 5) * 86400000),
          },
        ]
      : []
    // نام واقعی‌نما با کد مدل: هویت در هر دو تطبیق‌دهندهٔ v1/v2 «تایید» می‌شود تا مقایسهٔ rollback فقط به تخمین‌گر وابسته باشد
    const modelName = `دوربین مداربسته داهوا مدل DH-HAC-${1000 + s}T`
    out.push({
      id: s,
      source: {
        source: 'torob',
        productTitle: modelName,
        offers,
        totalSellerCount: count + I(0, 10),
        fetchedAt: now,
        ok: true,
      },
      ctx: {
        productId: s + 1,
        productName: modelName,
        costPrice: cost,
        supplierQuotes,
        currentFinalPrice: rnd() < 0.5 ? Math.round((P * U(0.9, 1.1)) / 1000) * 1000 : null,
        now,
      },
    })
  }
  return out
}

/** فیلدهایی که برای بازگشت امن (rollback) باید با ۴.۱.۲ یکی باشند */
function pickComparable(r) {
  return {
    finalPrice: r.finalPrice ?? null,
    basePrice: r.basePrice ?? null,
    discountPct: r.discountPct ?? null,
    strategy: r.strategy ?? null,
    needsReview: Boolean(r.needsReview),
    confidence: r.confidence ?? null,
    isProvisional: Boolean(r.isProvisional),
    rejectedBySupervisor: Boolean(r.rejectedBySupervisor),
    supervisorPct: r.supervisor ? r.supervisor.overallScorePct : null,
    supervisorVerdict: r.supervisor ? r.supervisor.verdict : null,
    nationalRank: r.position ? r.position.projectedNationalRank ?? null : null,
    localRank: r.position ? r.position.projectedLocalRank ?? null : null,
    tier: r.position ? r.position.competitionTier ?? null : null,
  }
}

module.exports = { makeScenarios, pickComparable, mulberry32 }
