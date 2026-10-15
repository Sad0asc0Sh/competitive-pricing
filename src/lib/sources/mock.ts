import type { RawOffer, SourceResult } from "@/lib/pricing/types";
import type { PriceSourceAdapter, SourceProduct } from "./types";

const SHOPS: { name: string; city: string; score: number; sellerType: "online" | "in_person" }[] = [
  { name: "دیجی‌کالا", city: "تهران", score: 4.8, sellerType: "online" },
  { name: "تکنولایف", city: "تهران", score: 4.9, sellerType: "online" },
  { name: "مقداد آی‌تی", city: "تهران", score: 4.6, sellerType: "online" },
  { name: "شرق دیجیتال مشهد", city: "مشهد", score: 4.9, sellerType: "online" },
  { name: "تک‌شاپ مشهد", city: "مشهد", score: 4.7, sellerType: "online" },
  { name: "خراسان مارکت", city: "مشهد", score: 4.5, sellerType: "online" },
  { name: "پاساژ تک مشهد (حضوری)", city: "مشهد", score: 4.8, sellerType: "in_person" },
  { name: "موبایل کمک", city: "تهران", score: 4.4, sellerType: "online" },
  { name: "زنبیل", city: "تهران", score: 4.6, sellerType: "online" },
  { name: "ایران‌بین", city: "تهران", score: 4.3, sellerType: "online" },
  { name: "کالاپلاس", city: "اصفهان", score: 4.7, sellerType: "online" },
  { name: "سناتور استور", city: "شیراز", score: 4.5, sellerType: "online" },
  { name: "بانه دات کام", city: "بانه", score: 4.1, sellerType: "online" },
  { name: "کالاتیک", city: "تهران", score: 4.8, sellerType: "online" },
  { name: "پلازا دیجیتال", city: "مشهد", score: 4.6, sellerType: "online" },
  { name: "همراه سنتر", city: "تهران", score: 4.5, sellerType: "online" },
  { name: "نوین‌کالا", city: "تبریز", score: 4.4, sellerType: "online" },
  { name: "تیمچه", city: "تهران", score: 4.7, sellerType: "online" },
  { name: "شهر لوازم", city: "تهران", score: 4.2, sellerType: "online" },
  { name: "میکرو لپ", city: "مشهد", score: 4.8, sellerType: "online" },
  { name: "کالا مارکت", city: "تهران", score: 4.5, sellerType: "online" },
  { name: "پارس کالا", city: "اصفهان", score: 4.6, sellerType: "online" },
  { name: "کیان تک", city: "تهران", score: 4.4, sellerType: "online" },
  { name: "فروشگاه ۲۴", city: "تهران", score: 4.3, sellerType: "online" },
  { name: "زودکالا", city: "مشهد", score: 4.7, sellerType: "online" },
];

/** تولید کننده تصادفی قطعی بر اساس seed */
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
 * شبیه‌ساز بازار ترب (کشوری + شهر مشهد):
 *  - ~۲۰ تا ۲۵ فروشنده از شهرهای مختلف (شامل فروشندگان اینترنتی و حضوری مشهد)
 *  - چند قیمت قدیمی که آپدیت نیستند
 *  - چند پرت بالا/پایین، آگهی تبلیغاتی و ناموجود
 */
export const mockAdapter: PriceSourceAdapter = {
  id: "mock",
  label: "شبیه‌ساز بازار ترب (کشوری + مشهد)",
  async fetchOffers(product: SourceProduct): Promise<SourceResult> {
    const daySeed = Math.floor(Date.now() / 3600000 / 6);
    const rnd = mulberry32(product.id * 7919 + daySeed);
    const center =
      product.costPrice > 0
        ? product.costPrice * (1.07 + rnd() * 0.08)
        : 1_000_000 + rnd() * 5_000_000;
    const n = 20 + Math.floor(rnd() * 5);
    const now = Date.now();
    const offers: RawOffer[] = [];
    const shops = [...SHOPS].sort(() => rnd() - 0.5).slice(0, n);

    shops.forEach((shop, i) => {
      let price = center * (0.97 + rnd() * 0.07);
      let ageDays = rnd() * 3;
      let isAd = false;
      let inStock = true;
      let priceUnreliable = false;

      const roll = rnd();
      if (i < 2) {
        // ۲ فروشگاه قدیمی که قیمتشان آپدیت نشده (تله!)
        price = center * (0.84 + rnd() * 0.05);
        ageDays = 14 + rnd() * 25;
      } else if (roll < 0.07) {
        price = center * (1.25 + rnd() * 0.15); // پرت بالا
      } else if (roll < 0.12) {
        price = center * (0.72 + rnd() * 0.06); // پرت پایین یا مشکوک
        priceUnreliable = roll < 0.09;
      } else if (roll < 0.18) {
        isAd = true;
      } else if (roll < 0.22) {
        inStock = false;
      }

      const roundedPrice = Math.round(price / 1000) * 1000;
      const daysInt = Math.round(ageDays);

      offers.push({
        shopName: shop.name,
        shopId: `shop-${i}`,
        shopCity: shop.city,
        sellerType: shop.sellerType,
        shopScore: shop.score,
        shopVotes: 15 + Math.floor(rnd() * 120),
        price: roundedPrice,
        deliveredPrice: roundedPrice,
        lastChangedAt: new Date(now - ageDays * 86400000),
        lastChangedText: daysInt === 0 ? "۲ ساعت پیش" : `${daysInt} روز پیش`,
        priceUnreliable,
        isAd,
        inStock,
        url: `https://torob.com/shop/${1000 + i}/`,
      });
    });

    return {
      source: "mock",
      productTitle: product.name,
      offers,
      totalSellerCount: offers.length,
      inPersonSellerCount: offers.filter((o) => o.sellerType === "in_person").length,
      fetchedAt: new Date(),
      ok: true,
      meta: { simulated: true },
    };
  },
};
