import type { RawOffer, SourceResult } from "@/lib/pricing/types";
import type { PriceSourceAdapter, SourceProduct } from "./types";

const SHOPS = [
  "دیجی‌کالا", "تکنولایف", "موبایل کمک", "زنبیل", "ایران‌بین", "کالاپلاس", "مقداد آی‌تی", "سناتور استور",
  "الوپیک شاپ", "بانه دات کام", "کالاتیک", "پلازا دیجیتال", "دی‌جی استایل", "همراه سنتر", "نوین‌کالا",
  "تیمچه", "شهر لوازم", "میکرو لپ", "کالا مارکت", "بازار آنلاین", "دیجی استور", "پارس کالا", "کیان تک",
  "آی‌سیتی", "مگا استور", "فروشگاه ۲۴", "لپ‌تاپ سنتر", "تک‌شاپ", "زودکالا", "کالا برتر",
];

/** تولید کننده تصادفی قطعی بر اساس seed (تا هر محصول همیشه یک بازار مشابه داشته باشد + نویز زمانی) */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * شبیه‌ساز بازار ترب:
 *  - ~۲۵ تا ۳۰ فروشنده
 *  - چند قیمت قدیمی (۱۰–۴۰ روز) که «به ظاهر ارزان» اما آپدیت نیستند (سناریوی مشکل‌ساز واقعی)
 *  - چند پرت بالا/پایین، چند آگهی تبلیغاتی، چند ناموجود
 */
export const mockAdapter: PriceSourceAdapter = {
  id: "mock",
  label: "شبیه‌ساز بازار",
  async fetchOffers(product: SourceProduct): Promise<SourceResult> {
    const daySeed = Math.floor(Date.now() / 3600000 / 6); // هر ۶ ساعت نویز جدید
    const rnd = mulberry32(product.id * 7919 + daySeed);
    const center = product.costPrice > 0 ? product.costPrice * (1.12 + rnd() * 0.1) : 1_000_000 + rnd() * 5_000_000;
    const n = 24 + Math.floor(rnd() * 7);
    const now = Date.now();
    const offers: RawOffer[] = [];
    const shops = [...SHOPS].sort(() => rnd() - 0.5).slice(0, n);

    shops.forEach((shop, i) => {
      let price = center * (0.97 + rnd() * 0.07); // بدنه اصلی: ±۳.۵٪
      let ageDays = rnd() * 4;
      let isAd = false;
      let inStock = true;

      const roll = rnd();
      if (i < 3) {
        // ۳ فروشگاه اول: قیمت پایین و قدیمی (تله!)
        price = center * (0.82 + rnd() * 0.06);
        ageDays = 12 + rnd() * 30;
      } else if (roll < 0.08) {
        price = center * (1.25 + rnd() * 0.2); // پرت بالا
      } else if (roll < 0.13) {
        price = center * (0.7 + rnd() * 0.08); // پرت پایین (اشتباه تایپی/کالای غیراصل)
        ageDays = rnd() * 2;
      } else if (roll < 0.2) {
        isAd = true;
      } else if (roll < 0.25) {
        inStock = false;
      }

      offers.push({
        shopName: shop,
        shopId: `shop-${i}`,
        price: Math.round(price / 1000) * 1000,
        lastChangedAt: new Date(now - ageDays * 86400000),
        isAd,
        inStock,
        url: `https://example-shop.ir/${i}`,
      });
    });

    return {
      source: "mock",
      productTitle: product.name,
      offers,
      totalSellerCount: offers.length,
      fetchedAt: new Date(),
      ok: true,
      meta: { simulated: true },
    };
  },
};
