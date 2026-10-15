"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fetchFromSource = fetchFromSource;
exports.getAdapter = getAdapter;
exports.listAdapters = listAdapters;
exports.manualSource = manualSource;
var _mock = require("./mock");
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
const adapters = {
  torob: _torob.torobAdapter,
  mock: _mock.mockAdapter
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
      error: "منبع ناشناخته"
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