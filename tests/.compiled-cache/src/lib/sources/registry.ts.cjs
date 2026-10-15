"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ALLOWED_SOURCE_TYPES = void 0;
exports.fetchFromSource = fetchFromSource;
exports.getAdapter = getAdapter;
exports.isAllowedSourceType = isAllowedSourceType;
exports.listAdapters = listAdapters;
exports.manualSource = manualSource;
var _torob = require("./torob");
/** منبع دستی: پیشنهادها را از ورودی کاربر (import) می‌گیرد */
function manualSource(offers, totalSellerCount) {
  return {
    source: "manual",
    offers,
    totalSellerCount: totalSellerCount ?? offers.length,
    fetchedAt: new Date(),
    ok: offers.length > 0,
    error: offers.length ? undefined : "هیچ پیشنهادی وارد نشده"
  };
}
/**
 * تنها منبع واقعی مجاز در محیط تولید: ترب.
 * منبع شبیه‌سازی (mock) به‌طور کامل حذف شده است تا هیچ تصمیم قیمتی
 * بر اساس داده ساختگی گرفته یا به فروشگاه ارسال نشود.
 */
const ALLOWED_SOURCE_TYPES = exports.ALLOWED_SOURCE_TYPES = ["torob"];
function isAllowedSourceType(sourceType) {
  return ALLOWED_SOURCE_TYPES.includes(sourceType);
}
const adapters = {
  torob: _torob.torobAdapter
};
function getAdapter(sourceType) {
  return adapters[sourceType] ?? null;
}
function listAdapters() {
  return [...Object.values(adapters).map(a => ({
    id: a.id,
    label: a.label
  })), {
    id: "manual",
    label: "ورود دستی"
  }];
}
async function fetchFromSource(product, manualOffers) {
  if (manualOffers && manualOffers.length) return manualSource(manualOffers);
  const adapter = getAdapter(product.sourceType);
  if (!adapter) {
    return {
      source: product.sourceType,
      offers: [],
      totalSellerCount: 0,
      fetchedAt: new Date(),
      ok: false,
      error: "منبع ناشناخته یا غیرمجاز (فقط ترب پشتیبانی می‌شود)"
    };
  }
  try {
    return await adapter.fetchOffers(product);
  } catch (e) {
    return {
      source: adapter.id,
      offers: [],
      totalSellerCount: 0,
      fetchedAt: new Date(),
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}
