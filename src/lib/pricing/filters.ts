import type { OfferEvaluation, PricingProfileConfig, RawOffer } from "./types";

/**
 * مرحله ۱: فیلترهای اعتبار داده
 * - حذف آگهی‌های تبلیغاتی
 * - حذف ناموجودها
 * - حذف قیمت‌های قدیمی (فروشگاه‌هایی که آپدیت نیستند)
 * - حذف لیست سیاه و فروشگاه خودمان
 * - حذف قیمت‌های صفر/نامعتبر
 */
export function applyValidityFilters(
  offers: RawOffer[],
  cfg: PricingProfileConfig["filters"],
  now: Date,
): OfferEvaluation[] {
  const maxAgeMs = cfg.maxOfferAgeDays * 24 * 3600 * 1000;
  const blacklist = new Set(cfg.shopBlacklist.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const own = new Set(cfg.ownShopNames.map((s) => s.trim().toLowerCase()).filter(Boolean));

  return offers.map((o) => {
    const ev: OfferEvaluation = { ...o, included: true, weight: 1 };
    const nameKey = o.shopName.trim().toLowerCase();
    const idKey = (o.shopId ?? "").trim().toLowerCase();

    if (!Number.isFinite(o.price) || o.price <= 0) {
      return exclude(ev, "قیمت نامعتبر/صفر");
    }
    if (own.has(nameKey) || (idKey && own.has(idKey))) {
      return exclude(ev, "فروشگاه خودمان");
    }
    if (blacklist.has(nameKey) || (idKey && blacklist.has(idKey))) {
      return exclude(ev, "لیست سیاه");
    }
    if (cfg.excludeAds && o.isAd) {
      return exclude(ev, "آگهی تبلیغاتی");
    }
    if (cfg.excludeOutOfStock && o.inStock === false) {
      return exclude(ev, "ناموجود");
    }
    if (o.lastChangedAt) {
      const age = now.getTime() - o.lastChangedAt.getTime();
      if (age > maxAgeMs) {
        const days = Math.round(age / 86400000);
        return exclude(ev, `قیمت قدیمی (${days} روز بدون آپدیت)`);
      }
    }
    return ev;
  });
}

function exclude(ev: OfferEvaluation, reason: string): OfferEvaluation {
  ev.included = false;
  ev.excludeReason = reason;
  ev.weight = 0;
  return ev;
}

/**
 * وزن تازگی: هر پیشنهاد بر اساس زمان آخرین تغییر قیمت وزن می‌گیرد.
 * weight = 0.5 ^ (ageDays / halfLife) — پیشنهاد امروز وزن ۱، پیشنهاد به قدمت نیمه‌عمر وزن ۰.۵
 */
export function applyRecencyWeights(offers: OfferEvaluation[], halfLifeDays: number, now: Date): void {
  for (const o of offers) {
    if (!o.included) continue;
    if (!o.lastChangedAt || halfLifeDays <= 0) {
      o.weight = 1;
      continue;
    }
    const ageDays = Math.max(0, (now.getTime() - o.lastChangedAt.getTime()) / 86400000);
    o.weight = Math.max(0.05, Math.pow(0.5, ageDays / halfLifeDays));
  }
}
