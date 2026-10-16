"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeConfidence = computeConfidence;
/**
 * امتیاز اعتماد (0..1) — ترکیب چند سیگنال:
 *  - تعداد فروشنده کل (لیستینگ ادغام‌شده؟)
 *  - تعداد پیشنهاد معتبر بعد از فیلترها
 *  - پراکندگی قیمت‌ها (هرچه کمتر، مطمئن‌تر)
 *  - نسبت داده حذف‌شده (اگر بیش از نیمی حذف شده، داده مشکوک است)
 */
function computeConfidence(market, totals, cfg) {
    // ورودی‌های نامعتبر (NaN/Infinity) هرگز نباید اعتماد جعلی بسازند
    const sellers = Number.isFinite(totals.totalSellerCount) ? Math.max(0, totals.totalSellerCount) : 0;
    const offersTotal = Number.isFinite(totals.offersTotal) ? Math.max(0, totals.offersTotal) : 0;
    const validCount = Number.isFinite(market.count) ? Math.max(0, market.count) : 0;
    const dispersion = Number.isFinite(market.dispersion) ? Math.max(0, market.dispersion) : 1;
    const sellerScore = Math.min(1, sellers / Math.max(1, cfg.filters.minSellerCount * 2));
    const validScore = Math.min(1, validCount / Math.max(1, cfg.guards.minValidOffers * 2));
    const dispersionScore = Math.max(0, 1 - dispersion / 0.15); // CV 15% → صفر
    const keepRatio = offersTotal ? validCount / offersTotal : 0;
    const keepScore = Math.min(1, keepRatio / 0.5); // اگر ≥۵۰٪ داده‌ها نگه داشته شد → کامل
    const rawScore = 0.3 * sellerScore + 0.3 * validScore + 0.25 * dispersionScore + 0.15 * keepScore;
    const score = Number.isFinite(rawScore) ? Math.round(rawScore * 100) / 100 : 0;
    return {
        score,
        breakdown: {
            sellerScore: r(sellerScore),
            validScore: r(validScore),
            dispersionScore: r(dispersionScore),
            keepScore: r(keepScore),
        },
    };
}
const r = (x) => Math.round(x * 100) / 100;
