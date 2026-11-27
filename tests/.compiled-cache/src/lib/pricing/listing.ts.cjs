"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSellerCount = distinctSellerCount;
exports.listingPanel = listingPanel;
exports.decisionPanels = decisionPanels;
const own_shop_1 = require("./own-shop");
/** Prefer shop IDs. Avoid counting online and in-person rows for the same shop twice. */
function distinctSellerCount(offers) {
    const ids = new Set();
    const namedIds = new Set();
    const names = new Set();
    for (const offer of offers) {
        const name = (0, own_shop_1.compactShopKey)(offer.shopName);
        const id = (0, own_shop_1.compactShopKey)(offer.shopId);
        if (id) {
            ids.add(id);
            if (name)
                namedIds.add(name);
        }
        else if (name) {
            names.add(name);
        }
    }
    return ids.size + [...names].filter((name) => !namedIds.has(name)).length;
}
function listingPanel(prk, offers, reported) {
    const observed = distinctSellerCount(offers);
    return { prk, sellerCount: reported > offers.length ? reported : observed || null };
}
/** Historical decisions may only contain the primary PRK and an aggregate seller count. */
function decisionPanels(steps) {
    const data = steps.find((s) => s.step === "source")?.data;
    if (!data || data.sourceStatus === "error" || data.sourceStatus === "challenged")
        return [];
    const found = new Map();
    function add(prk, count) {
        if (typeof prk !== "string" || !/^[a-zA-Z0-9_-]+$/.test(prk) || found.has(prk))
            return;
        found.set(prk, { prk, sellerCount: typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : null });
    }
    if (Array.isArray(data.panels)) {
        for (const p of data.panels)
            if (p && typeof p === "object")
                add(p.prk, p.sellerCount);
    }
    else {
        const merged = steps.find((s) => s.step === "ai_identity")?.data?.mergedPanelPrks;
        add(data.prk, Array.isArray(merged) && merged.length > 1 ? null : data.totalSellerCount);
        if (Array.isArray(merged))
            for (const prk of merged)
                add(prk, null);
    }
    return [...found.values()];
}
