"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePersianRelativeDate = parsePersianRelativeDate;
exports.applyValidityFilters = applyValidityFilters;
exports.applyRecencyWeights = applyRecencyWeights;
const sourcing_1 = require("./sourcing");
const DIGIT_MAP = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
/**
 * تبدیل عبارات زمانی فارسی ترب (مانند «۲ ساعت پیش»، «۳ روز پیش»، «۸ ماه و ۹ روز پیش»، «دیروز»، «لحظاتی پیش»)
 * به شیء Date دقیق نسبت به زمان فعلی (now).
 */
function parsePersianRelativeDate(text, now = new Date()) {
    if (!text)
        return null;
    const raw = String(text).replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d).trim();
    if (!raw)
        return null;
    // اگر تاریخ استاندارد ISO یا میلادی باشد
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime()) && raw.length >= 8 && /\d{4}/.test(raw)) {
        return direct;
    }
    if (/(لحظاتی|چند لحظه|همین الان|امروز|جدید)/i.test(raw) && !/\d/.test(raw)) {
        return new Date(now.getTime() - 10 * 60 * 1000);
    }
    if (/دیروز/.test(raw)) {
        return new Date(now.getTime() - 24 * 3600 * 1000);
    }
    if (/پریروز/.test(raw)) {
        return new Date(now.getTime() - 48 * 3600 * 1000);
    }
    let totalMs = 0;
    let matched = false;
    const patterns = [
        { re: /(\d+)\s*(?:سال)/g, unitMs: 365 * 86_400_000 },
        { re: /(\d+)\s*(?:ماه)/g, unitMs: 30 * 86_400_000 },
        { re: /(\d+)\s*(?:هفته)/g, unitMs: 7 * 86_400_000 },
        { re: /(\d+)\s*(?:روز)/g, unitMs: 86_400_000 },
        { re: /(\d+)\s*(?:ساعت)/g, unitMs: 3_600_000 },
        { re: /(\d+)\s*(?:دقیقه)/g, unitMs: 60_000 },
        { re: /(\d+)\s*(?:ثانیه)/g, unitMs: 1_000 },
    ];
    for (const { re, unitMs } of patterns) {
        let m;
        while ((m = re.exec(raw)) !== null) {
            const val = Number(m[1]);
            if (Number.isFinite(val) && val >= 0) {
                totalMs += val * unitMs;
                matched = true;
            }
        }
    }
    if (matched) {
        return new Date(now.getTime() - totalMs);
    }
    return null;
}
/**
 * مرحله ۱: فیلترهای اعتبار داده رقبا در ترب + تشخیص فروشندگان شهر پیش‌فرض (مشهد)
 * - حذف آگهی‌های تبلیغاتی (isAd)
 * - حذف ناموجودها (inStock === false)
 * - حذف قیمت‌های غیرقابل اعتماد ترب (priceUnreliable === true)
 * - حذف فروشندگان حضوری اگر در تنظیمات غیرفعال باشد (یا نگه‌داشتن حضوری‌های مشهد در صورت فعال بودن)
 * - حذف قیمت‌های قدیمی (فروشگاه‌هایی که آپدیت نیستند — هم با lastChangedAt و هم با lastChangedText فارسی)
 * - حذف لیست سیاه و فروشگاه خودمان (با نرمال‌سازی حروف فارسی)
 * - حذف قیمت‌های صفر/نامعتبر
 */
function applyValidityFilters(offers, cfg, now, rankCfg, 
/** تخمین‌گر v2: سن نرم — حذف سخت در maxOfferAgeDays برداشته و سقف مطلق hardMaxAgeDays اعمال می‌شود */
ageOpts) {
    const effectiveMaxAgeDays = ageOpts?.softStaleness && ageOpts.hardMaxAgeDays != null && ageOpts.hardMaxAgeDays > 0
        ? Math.max(cfg.maxOfferAgeDays, ageOpts.hardMaxAgeDays)
        : cfg.maxOfferAgeDays;
    const maxAgeMs = effectiveMaxAgeDays * 24 * 3600 * 1000;
    const blacklist = new Set(cfg.shopBlacklist.map((s) => (0, sourcing_1.normalizeFaText)(s)).filter(Boolean));
    const own = new Set(cfg.ownShopNames.map((s) => (0, sourcing_1.normalizeFaText)(s)).filter(Boolean));
    const defaultCity = rankCfg?.defaultCity ?? "مشهد";
    const cityAliases = rankCfg?.localCityAliases ?? ["مشهد", "mashhad"];
    return offers.map((o) => {
        const resolvedLastChanged = o.lastChangedAt instanceof Date && !Number.isNaN(o.lastChangedAt.getTime())
            ? o.lastChangedAt
            : parsePersianRelativeDate(o.lastChangedText, now);
        // تشخیص شهر فروشنده (از فیلد shopCity یا در صورت ذکر شدن در نام فروشگاه مانند «فروشگاه X - مشهد»)
        const isLocalCity = (0, sourcing_1.isMatchingCity)(o.shopCity, defaultCity, cityAliases) ||
            (0, sourcing_1.isMatchingCity)(o.shopName, defaultCity, cityAliases);
        const ev = {
            ...o,
            lastChangedAt: resolvedLastChanged,
            isLocalCity,
            included: true,
            weight: 1,
        };
        const nameKey = (0, sourcing_1.normalizeFaText)(o.shopName);
        const idKey = (0, sourcing_1.normalizeFaText)(o.shopId ?? "");
        if (!Number.isFinite(o.price) || o.price <= 0) {
            return exclude(ev, "قیمت نامعتبر/صفر");
        }
        if (own.has(nameKey) ||
            (idKey && own.has(idKey)) ||
            [...own].some((ownName) => ownName.length >= 3 && nameKey.includes(ownName))) {
            return exclude(ev, "فروشگاه خودمان");
        }
        if (blacklist.has(nameKey) || (idKey && blacklist.has(idKey))) {
            return exclude(ev, "لیست سیاه");
        }
        if (cfg.excludeOutOfStock && o.inStock === false) {
            return exclude(ev, "ناموجود");
        }
        if ((cfg.excludeUnreliablePrices ?? true) && o.priceUnreliable) {
            return exclude(ev, "هشدار قیمت غیرقابل اعتماد ترب (price_unreliable)");
        }
        if (cfg.excludeAds && o.isAd) {
            return exclude(ev, "آگهی تبلیغاتی");
        }
        if (o.sellerType === "in_person" && cfg.includeInPersonSellers === false) {
            return exclude(ev, "فروشگاه حضوری (غیرفعال در پروفایل)");
        }
        if (cfg.minShopScore > 0 && o.shopScore != null && o.shopScore < cfg.minShopScore) {
            return exclude(ev, `امتیاز فروشگاه پایین (${o.shopScore} < ${cfg.minShopScore})`);
        }
        if (resolvedLastChanged) {
            const age = now.getTime() - resolvedLastChanged.getTime();
            if (age > maxAgeMs) {
                const days = Math.max(1, Math.round(age / 86_400_000));
                return exclude(ev, `قیمت قدیمی (${days} روز بدون آپدیت)`);
            }
        }
        return ev;
    });
}
function exclude(ev, reason) {
    ev.included = false;
    ev.excludeReason = reason;
    ev.weight = 0;
    return ev;
}
/**
 * وزن تازگی و اعتبار:
 * هر پیشنهاد بر اساس زمان آخرین تغییر قیمت + امتیاز فروشگاه در ترب وزن می‌گیرد.
 * weight = (0.5 ^ (ageDays / halfLife)) * scoreBoost
 */
function applyRecencyWeights(offers, halfLifeDays, now) {
    for (const o of offers) {
        if (!o.included)
            continue;
        let recencyWeight = 1;
        if (o.lastChangedAt && halfLifeDays > 0) {
            const ageDays = Math.max(0, (now.getTime() - o.lastChangedAt.getTime()) / 86_400_000);
            recencyWeight = Math.max(0.05, Math.pow(0.5, ageDays / halfLifeDays));
        }
        // تقویت ملایم وزن برای فروشگاه‌های با امتیاز بالا در ترب (۴.۵ به بالا)
        const scoreBoost = o.shopScore != null && o.shopScore >= 4.5 ? 1.15 : 1.0;
        o.weight = Math.round(recencyWeight * scoreBoost * 1000) / 1000;
    }
}
