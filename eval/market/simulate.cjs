'use strict'
/**
 * شبیه‌ساز بازار ترب با «حقیقت زمینی».
 *
 * هر «دنیا» = یک محصول با قیمت منصفانه‌ی بازار P0 + N فروشنده با ویژگی‌های واقع‌گرایانه:
 *  - پراکندگی قیمت بین فروشنده‌ها (σ)، رانش قیمت بازار در زمان (μ در روز) ⇒ قیمت‌های کهنه نسبت به امروز جابه‌جا می‌شوند
 *  - کهنگی هر فروشنده (دقت در به‌روزرسانی ⇒ امتیاز بالاتر و تازه‌تر)
 *  - «طعمه‌ها»: قیمت پایینِ غیرقابل‌خرید (تماس بگیرید/ناموجودِ نشان‌داده‌نشده) ← معتبر نیستند
 *  - «تنوع اشتباه»: پیشنهادهای مربوط به مدل/ظرفیت دیگر که ترب در یک کارت ادغام کرده ← معتبر نیستند
 *  - «ارزان‌فروش واقعی»: فروشنده‌ی تنها با قیمت پایین ولی واقعی (تصفیه موجودی) ← معتبر است (مثال نقض حذف بیش‌ازحد)
 *  - ناموجود/تبلیغ/قیمت نامطمئن ترب، حضور فروشگاه خودمان، برش ۳۰تایی خروجی MCP
 *
 * «معتبر» = پیشنهادی که یک خریدار واقعاً می‌تواند با همان قیمت نمایش‌داده‌شده بخرد:
 *   همان محصول ∧ موجود ∧ قیمت ثبت‌شده با قیمت فعلی فروشنده سازگار است (honored).
 * قیمت‌های کهنه: اگر بازار از آخرین تغییر قیمت فروشنده بالا رفته باشد (stale-low) احتمال honored کم می‌شود.
 *
 * تمام فرض‌ها پارامتریک و در PARAMS قابل‌مشاهده‌اند؛ run.cjs حساسیت نتایج را نسبت به آن‌ها گزارش می‌کند.
 */
const NOW = new Date('2026-10-23T08:00:00.000Z')

const DEFAULT_PARAMS = {
  // رژیم تعداد فروشنده (وزن)
  regimes: [
    [[2, 5], 0.2],
    [[6, 15], 0.4],
    [[16, 30], 0.26],
    [[31, 80], 0.14],
  ],
  sigmas: [[0.008, 0.2], [0.015, 0.35], [0.028, 0.3], [0.05, 0.15]], // پراکندگی لگاریتمی قیمت بین فروشنده‌ها
  vols: [[0.0008, 0.4], [0.004, 0.4], [0.011, 0.2]], // انحراف معیار رانش روزانه
  pBait: 0.1, // احتمال حضور حداقل یک طعمه در لیستینگ
  pVariant: 0.06, // احتمال تنوع اشتباه
  pLegitLow: 0.07, // احتمال ارزان‌فروش واقعی تنها
  pPremium: 0.1, // سهم فروشندگان گران‌فروش (+۵..۲۰٪)
  pOutOfStock: 0.06,
  pAd: 0.05,
  pSelf: 0.15,
  pHonoredFloor: 0.08, // حداقل احتمال honored برای کهنه-پایین‌های بسیار عقب‌مانده
  ghostBase: 0.01, // احتمال «لیستینگ شبح» (غیرقابل‌خرید) حتی برای آگهی تازه
  ghostPerDay: 0.004, // افزایش احتمال شبح به‌ازای هر روز کهنگی
  ghostCap: 0.25,
  diligence: [ // دقت فروشنده در به‌روزرسانی: [نام، وزن، میانگین سن (روز)، میانگین امتیاز، sd امتیاز]
    ['high', 0.35, 0.4, 4.55, 0.3],
    ['mid', 0.4, 2.0, 4.2, 0.5],
    ['low', 0.25, 14, 3.7, 0.8],
  ],
}

function withParams(over) {
  return { ...DEFAULT_PARAMS, ...over }
}

function persianAgeText(ageDays) {
  const toFa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
  const mins = Math.round(ageDays * 1440)
  if (mins < 60) return `${toFa(Math.max(1, mins))} دقیقه پیش`
  const hours = Math.round(ageDays * 24)
  if (hours < 24) return `${toFa(hours)} ساعت پیش`
  const days = Math.round(ageDays)
  if (days < 30) return `${toFa(days)} روز پیش`
  const months = Math.floor(days / 30)
  const rem = days - months * 30
  return rem > 0 ? `${toFa(months)} ماه و ${toFa(rem)} روز پیش` : `${toFa(months)} ماه پیش`
}

function ageFromText(ageDays) {
  // قیمت در آینه‌ی «متن ترب»: کوانتیزه‌شده مثل چیزی که موتور واقعاً می‌بیند
  const mins = Math.round(ageDays * 1440)
  if (mins < 60) return Math.max(1, mins) / 1440
  const hours = Math.round(ageDays * 24)
  if (hours < 24) return hours / 24
  const days = Math.round(ageDays)
  if (days < 30) return days
  const months = Math.floor(days / 30)
  return months * 30 + (days - months * 30)
}

function pickRegimeN(rng, P) {
  const [lo, hi] = rng.pickW(P.regimes)
  return rng.int(lo, hi)
}

function sampleSeller(rng, P) {
  const [dname, , meanAge, meanScore, sdScore] = rng.pickW(P.diligence.map((d) => [d, d[1]]))
  let age
  if (dname === 'high') age = rng.chance(0.85) ? rng.float(0.01, 1.2) * rng.float(0.2, 1) : rng.float(1, 4)
  else if (dname === 'mid') age = rng.chance(0.3) ? rng.float(0.05, 1) : -Math.log(1 - rng.next()) * meanAge
  else age = rng.chance(0.15) ? rng.float(0.2, 3) : Math.min(400, -Math.log(1 - rng.next()) * meanAge)
  const votes = Math.max(0, Math.round(rng.logNormal(3.6, 1.3)))
  let score = Math.min(5, Math.max(1, rng.normal(meanScore, sdScore)))
  score = Math.round(score * 10) / 10
  const scoreNull = votes < 6 && rng.chance(0.8)
  return { dname, ageDays: age, shopScore: scoreNull ? null : score, shopVotes: votes }
}

const CITIES = [['تهران', 0.4], ['مشهد', 0.07], ['اصفهان', 0.1], ['شیراز', 0.07], ['تبریز', 0.07], ['کرج', 0.05], ['قم', 0.04], ['اهواز', 0.04], ['رشت', 0.04], ['کرمانشاه', 0.03], ['یزد', 0.03], ['ارومیه', 0.02], ['اراک', 0.04]]

/** یک دنیا (محصول + بازار) را می‌سازد. خروجی شامل مشاهده‌ی ترب و حقیقت زمینی است. */
function simulateWorld(rng, P = DEFAULT_PARAMS, opts = {}) {
  const P0 = Math.min(8e7, Math.max(3e5, Math.round(rng.logNormal(Math.log(3.6e6), 0.95) / 1000) * 1000))
  const N = opts.nOverride ?? pickRegimeN(rng, P)
  const sigma = rng.pickW(P.sigmas)
  const vol = rng.pickW(P.vols)
  const mu = rng.normal(0, vol) // رانش روزانه (مثبت = بازار تا امروز بالا رفته)
  const sellers = []
  let shopId = 1000 + rng.int(0, 5000)

  const mk = (o) => ({
    shopName: `فروشگاه ${shopId}`,
    shopId: String(shopId++),
    shopCity: rng.pickW(CITIES),
    ...o,
  })

  // ---- فروشندگان عادی
  for (let i = 0; i < N; i++) {
    const s = sampleSeller(rng, P)
    const isPremium = rng.chance(P.pPremium)
    const premium = rng.normal(0, sigma) + (isPremium ? rng.float(0.05, 0.2) : 0) + (rng.chance(0.08) ? -rng.float(0.01, 0.03) : 0)
    const quantAge = ageFromText(s.ageDays)
    const wouldBeNow = P0 * Math.exp(premium)
    const displayed = P0 * Math.exp(-mu * quantAge) * Math.exp(premium) * (1 + rng.float(-0.002, 0.002))
    const gap = (wouldBeNow - displayed) / wouldBeNow // مثبت = کهنه-پایین
    const honorP = gap <= 0.015 ? 1 : Math.max(P.pHonoredFloor, 1 - (gap - 0.015) / 0.085)
    // «لیستینگ شبح»: هرچه آخرین تغییر قیمت قدیمی‌تر، احتمال اینکه آگهی در عمل قابل‌خرید نباشد بیشتر است
    const ghost = rng.chance(Math.min(P.ghostCap, P.ghostBase + P.ghostPerDay * quantAge))
    const honored = rng.chance(honorP) && !ghost
    const inStock = !rng.chance(P.pOutOfStock)
    const isAd = rng.chance(P.pAd)
    const unreliableP = !honored && gap > 0.05 ? 0.25 : 0.01
    sellers.push(
      mk({
        kind: 'normal',
        price: Math.round(displayed / 100) * 100,
        ageDays: quantAge,
        shopScore: s.shopScore,
        shopVotes: s.shopVotes,
        inStock,
        isAd,
        priceUnreliable: rng.chance(unreliableP),
        guarantee: rng.pickW([['enabled', 0.35], ['disabled', 0.5], [null, 0.15]]),
        valid: honored && inStock,
        honored,
      }),
    )
  }

  const validNow = sellers.filter((s) => s.valid && !s.isAd && !s.priceUnreliable).map((s) => s.price)
  const refLow = validNow.length ? Math.min(...validNow) : P0

  // ---- طعمه‌ها
  if (rng.chance(P.pBait)) {
    const k = rng.chance(0.7) ? 1 : 2
    for (let i = 0; i < k; i++) {
      const fresh = rng.chance(0.5)
      const age = fresh ? rng.float(0.01, 1) : -Math.log(1 - rng.next()) * 10
      const qa = ageFromText(age)
      sellers.push(
        mk({
          kind: 'bait',
          price: Math.round((refLow * (1 - rng.float(0.08, 0.45))) / 100) * 100,
          ageDays: qa,
          shopScore: rng.chance(0.2) ? null : Math.round(Math.min(5, Math.max(1, rng.normal(3.5, 1.0))) * 10) / 10,
          shopVotes: Math.round(rng.logNormal(2.4, 1.1)),
          inStock: true,
          isAd: false,
          priceUnreliable: rng.chance(0.3),
          guarantee: rng.pickW([['enabled', 0.1], ['disabled', 0.6], [null, 0.3]]),
          valid: false,
        }),
      )
    }
  }
  // ---- تنوع اشتباه (کارت ادغام‌شده)
  if (rng.chance(P.pVariant)) {
    const k = rng.chance(0.7) ? 1 : 2
    for (let i = 0; i < k; i++) {
      const ratio = rng.chance(0.5) ? rng.float(0.45, 0.8) : rng.float(1.2, 2.2)
      const s = sampleSeller(rng, P)
      sellers.push(
        mk({
          kind: 'variant',
          price: Math.round((P0 * ratio) / 100) * 100,
          ageDays: ageFromText(Math.min(s.ageDays, 3)),
          shopScore: s.shopScore,
          shopVotes: s.shopVotes,
          inStock: true,
          isAd: false,
          priceUnreliable: false,
          guarantee: rng.pickW([['enabled', 0.35], ['disabled', 0.5], [null, 0.15]]),
          valid: false,
        }),
      )
    }
  }
  // ---- ارزان‌فروش واقعی و تنها
  if (rng.chance(P.pLegitLow)) {
    const s = sampleSeller(rng, P)
    sellers.push(
      mk({
        kind: 'legit_low',
        price: Math.round((refLow * (1 - rng.float(0.08, 0.25))) / 100) * 100,
        ageDays: ageFromText(rng.float(0.05, 6)),
        shopScore: s.shopScore == null ? null : Math.min(5, Math.max(3, s.shopScore)),
        shopVotes: Math.max(10, s.shopVotes),
        inStock: true,
        isAd: false,
        priceUnreliable: false,
        guarantee: rng.pickW([['enabled', 0.4], ['disabled', 0.45], [null, 0.15]]),
        valid: true,
        honored: true,
      }),
    )
  }

  // ---- فروشگاه خودمان
  const ourPrev = Math.round((P0 * Math.exp(rng.normal(0, 0.012))) / 1000) * 1000
  const hasSelf = rng.chance(P.pSelf)
  if (hasSelf) {
    sellers.push({ kind: 'self', shopName: 'sgeooole', shopId: 'self', shopCity: 'مشهد', price: ourPrev, ageDays: 0.3, shopScore: 4.6, shopVotes: 120, inStock: true, isAd: false, priceUnreliable: false, guarantee: 'enabled', valid: false })
  }

  // ---- مشاهده‌ی ترب: «موجودها اول، ارزان‌ترین اول» و برش ۳۰تایی
  const ordered = [...sellers].sort((a, b) => (a.inStock !== b.inStock ? (a.inStock ? -1 : 1) : a.price - b.price))
  const MAX = opts.maxOffers ?? 30
  const shown = ordered.slice(0, MAX)
  const truncated = ordered.length > MAX
  const offers = shown.map((s) => ({
    shopName: s.shopName,
    shopId: s.shopId,
    shopCity: s.shopCity,
    sellerType: 'online',
    shopScore: s.shopScore,
    shopVotes: s.shopVotes,
    price: s.price,
    guarantee: s.guarantee ?? null,
    priceUnreliable: Boolean(s.priceUnreliable),
    lastChangedText: persianAgeText(s.ageDays),
    lastChangedAt: new Date(NOW.getTime() - s.ageDays * 86400000),
    isAd: Boolean(s.isAd),
    inStock: s.inStock !== false,
    deliveredPrice: s.price,
  }))

  // ---- حقیقت زمینی
  const policyOk = (s) => s.kind !== 'self' && s.valid && !s.isAd && !s.priceUnreliable && s.inStock !== false
  const trueValid = sellers.filter(policyOk).sort((a, b) => a.price - b.price)
  const lowestValid = trueValid.length ? trueValid[0].price : null
  const visibleValid = shown.filter(policyOk)
  const kinds = {
    bait: sellers.filter((s) => s.kind === 'bait').length,
    variant: sellers.filter((s) => s.kind === 'variant').length,
    legit_low: sellers.filter((s) => s.kind === 'legit_low').length,
    staleLowInvalid: sellers.filter((s) => s.kind === 'normal' && !s.honored).length,
  }
  const costPrice = Math.round((P0 * rng.float(0.8, 0.95)) / 1000) * 1000
  return {
    P0,
    N: sellers.length,
    sigma,
    vol,
    mu,
    costPrice,
    currentFinalPrice: ourPrev,
    hasSelf,
    truncated,
    totalSellerCount: sellers.length,
    offers,
    truth: {
      lowestValid,
      validCount: trueValid.length,
      validPrices: trueValid.map((s) => s.price),
      // پیشنهادهای واقعاً معتبر با شهر واقعی (برای oracleB که باید سیاست شهری را بر دادهٔ درست اجرا کند)
      validOffers: trueValid.map((s) => ({ shopName: s.shopName, price: s.price, city: s.shopCity })),
      kinds,
      visibleValidCount: visibleValid.length,
      lowestValidVisible: visibleValid.length ? Math.min(...visibleValid.map((s) => s.price)) : null,
      // برچسب هر پیشنهاد نمایش‌داده‌شده (برای ارزیابی مدل اعتبار)
      offerLabels: shown.map((s) => ({ shopName: s.shopName, kind: s.kind, valid: policyOk(s), price: s.price })),
    },
  }
}

module.exports = { simulateWorld, DEFAULT_PARAMS, withParams, NOW, persianAgeText }
