"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const engine_1 = require("../../../lib/pricing/engine");
const sourcing_1 = require("../../../lib/pricing/sourcing");
const systemone_supervisor_1 = require("../../../lib/pricing/systemone-supervisor");
const config_1 = require("../../../lib/ai/config");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function POST(req) {
    const b = (await req.json().catch(() => null));
    // سیستم واقعی بدون داده ساختگی: نام محصول و حداقل ۲ پیشنهاد معتبر الزامی است؛
    // هیچ مقدار پیش‌فرض نمونه‌ای (مثل دوربین داهوا) برنمی‌گردانیم.
    if (!b?.productName?.trim())
        return server_1.NextResponse.json({ error: "نام محصول (productName) الزامی است" }, { status: 400 });
    if (!Array.isArray(b?.offers) || b.offers.length < 2)
        return server_1.NextResponse.json({ error: "حداقل ۲ پیشنهاد رقیب (offers) برای شبیه‌سازی واقعی لازم است" }, { status: 400 });
    let baseCfg;
    try {
        baseCfg = b.config ? (0, bootstrap_1.mergeConfig)(b.config) : (await (0, bootstrap_1.getProfileConfig)()).config;
    }
    catch {
        baseCfg = (0, bootstrap_1.mergeConfig)(b.config);
    }
    const now = new Date();
    const supplierQuotes = b.supplierQuotes && b.supplierQuotes.length > 0
        ? b.supplierQuotes
        : b.colleagueListText
            ? (0, sourcing_1.parseColleaguePriceListText)(b.colleagueListText, "auto", now)
            : [];
    const offers = b
        .offers.filter((o) => o && Number(o.price) > 0)
        .map((o, i) => ({
        shopName: o.shopName?.trim() || `فروشگاه ${i + 1}`,
        shopCity: o.shopCity ?? null,
        sellerType: o.sellerType ?? "online",
        shopScore: o.shopScore ?? null,
        price: Math.round(Number(o.price)),
        lastChangedAt: o.lastChangedDaysAgo != null
            ? new Date(now.getTime() - Number(o.lastChangedDaysAgo) * 86400000)
            : null,
        lastChangedText: o.lastChangedText ?? null,
        priceUnreliable: !!o.priceUnreliable,
        isAd: !!o.isAd,
        inStock: o.inStock !== false,
    }));
    if (offers.length < 2)
        return server_1.NextResponse.json({ error: "حداقل ۲ پیشنهاد با قیمت معتبر لازم است" }, { status: 400 });
    const simProductName = b.productName.trim();
    const simTorobTitle = b.torobTitle?.trim() || simProductName;
    const result = (0, engine_1.runPricingPipeline)({
        source: "manual",
        productTitle: simTorobTitle,
        offers,
        totalSellerCount: b.totalSellerCount && b.totalSellerCount >= offers.length ? b.totalSellerCount : offers.length,
        fetchedAt: now,
        ok: true,
    }, {
        productId: 0,
        productName: simProductName,
        costPrice: Number(b.costPrice ?? 0) || 0,
        supplierQuotes,
        minMarginPctOverride: b.minMarginPct ?? null,
        minProfitAmountOverride: b.minProfitAmount ?? null,
        currentFinalPrice: b.currentFinalPrice ?? null,
        config: baseCfg,
        now,
    });
    if (baseCfg.supervisor?.enabled) {
        const subqRuntime = await (0, config_1.resolveSubqRuntime)(baseCfg.supervisor);
        result.supervisor = await (0, systemone_supervisor_1.enrichSupervisorWithSubqApi)(result.supervisor, {
            ...baseCfg.supervisor,
            apiKey: subqRuntime.apiKey,
            baseUrl: subqRuntime.baseUrl,
            model: subqRuntime.model,
        });
        // همگام‌سازی پرچم‌های رد/ریویو با حکم واقعی API ناظر (اگر توکن ثبت شده باشد)
        result.rejectedBySupervisor = result.supervisor.verdict === "reject";
        if (result.rejectedBySupervisor) {
            if (!result.reviewReasons.some((r) => r.startsWith("رد توسط ناظر بالاسر SystemOne"))) {
                result.reviewReasons.push(`رد توسط ناظر بالاسر SystemOne (امتیاز ${result.supervisor.overallScorePct}% < ${result.supervisor.rejectBelowPct}%)`);
            }
        }
        if (result.supervisor.verdict !== "approve")
            result.needsReview = true;
    }
    return server_1.NextResponse.json(result);
}
