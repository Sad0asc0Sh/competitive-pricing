"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasGuarantee = hasGuarantee;
exports.computeModalConsensusPrice = computeModalConsensusPrice;
exports.computeTrimmedWeightedMean = computeTrimmedWeightedMean;
exports.buildSellerClusters = buildSellerClusters;
exports.summarizeMarket = summarizeMarket;
const stats_1 = require("./stats");
/**
 * آیا پیشنهاد «ضمانت ترب» دارد؟ ترب مقدار guarantee را به‌صورت وضعیت "enabled" | "disabled" می‌فرستد؛
 * `Boolean("disabled")` درست است و باعث می‌شد تقریباً هر فروشنده‌ای «اعتماد بالا» شمرده شود (باگ ۴.۱.۲).
 * در حالت strict فقط "enabled" (یا هر مقدار غیرِ-"disabled"/"false"/"0"/خالی که شبیه وضعیت نیست) پذیرفته می‌شود.
 */
function hasGuarantee(g, strict) {
    if (!strict)
        return Boolean(g);
    if (g == null || g === false)
        return false;
    if (g === true)
        return true;
    const t = String(g).trim().toLowerCase();
    if (!t)
        return false;
    if (["enabled", "enable", "true", "yes", "1", "فعال"].includes(t))
        return true;
    if (["disabled", "disable", "false", "no", "0", "none", "null", "undefined", "غیرفعال", "ندارد"].includes(t))
        return false;
    // متن آزاد گارانتی (مثلاً «گارانتی ۱۸ ماهه») ⇒ دارد
    return !/(ندارد|بدون|غیرفعال)/.test(t);
}
/**
 * کشف «هسته چگال / مد وزنی بازار» (Kernel Modal Consensus):
 * برای هر پیشنهاد معتبر، یک پنجره به شعاع `radiusPct` (مثلاً ±۳٪) در نظر می‌گیرد و مجموع وزن
 * (تازگی × امتیاز فروشگاه) پیشنهادهای داخل آن پنجره را حساب می‌کند.
 * پنجره‌ای که بیشترین تراکم وزنی را دارد، «توافق واقعی فروشندگان به‌روز بازار» است!
 */
function computeModalConsensusPrice(offers, radiusPct = 3.0) {
    if (!offers.length)
        return null;
    if (offers.length === 1)
        return offers[0].price;
    const r = Math.max(0.5, radiusPct) / 100;
    let bestTotalWeight = -1;
    let bestWindowOffers = [];
    for (const center of offers) {
        const lo = center.price * (1 - r);
        const hi = center.price * (1 + r);
        const inWindow = offers.filter((o) => o.price >= lo && o.price <= hi);
        const wSum = inWindow.reduce((acc, o) => acc + Math.max(0.1, o.weight), 0);
        if (wSum > bestTotalWeight ||
            (Math.abs(wSum - bestTotalWeight) < 1e-6 && inWindow.length > bestWindowOffers.length)) {
            bestTotalWeight = wSum;
            bestWindowOffers = inWindow;
        }
    }
    if (!bestWindowOffers.length) {
        return (0, stats_1.weightedMean)(offers.map((o) => o.price), offers.map((o) => o.weight));
    }
    return Math.round((0, stats_1.weightedMean)(bestWindowOffers.map((o) => o.price), bestWindowOffers.map((o) => o.weight)));
}
/**
 * میانگین وزنی بریده (Trimmed Weighted Mean):
 * ابتدا درصدی از دو سرِ بسیار ارزان و بسیار گران را برش می‌زند و سپس میانگین وزنی (بر اساس تازگی و امتیاز) می‌گیرد.
 */
function computeTrimmedWeightedMean(offers, trimPct = 15) {
    if (!offers.length)
        return null;
    const sorted = [...offers].sort((a, b) => a.price - b.price);
    const k = sorted.length >= 4 ? Math.floor((sorted.length * Math.max(0, trimPct)) / 100) : 0;
    const body = sorted.slice(k, sorted.length - k);
    const target = body.length ? body : sorted;
    return Math.round((0, stats_1.weightedMean)(target.map((o) => o.price), target.map((o) => o.weight)));
}
/**
 * خوشه‌بندی پیشنهادهای معتبر فروشندگان بر اساس فاصله درصدی (clusterMaxGapPct)
 * تا سیستم بتواند «گروه‌های فروشندگان هم‌سطح» و «پرتراکم‌ترین خوشه بازار» را تشخیص دهد.
 */
function buildSellerClusters(validOffers, clusterMaxGapPct, hardFloorPrice, undercutAmount) {
    if (!validOffers.length)
        return [];
    const sorted = [...validOffers].sort((a, b) => a.price - b.price);
    const gapRatio = Math.max(0.5, clusterMaxGapPct) / 100;
    const groups = [];
    let currentGroup = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const leader = currentGroup[0];
        const stepGap = (cur.price - prev.price) / Math.max(1, prev.price);
        const leaderGap = (cur.price - leader.price) / Math.max(1, leader.price);
        if (stepGap > gapRatio * 0.65 || leaderGap > gapRatio) {
            groups.push(currentGroup);
            currentGroup = [cur];
        }
        else {
            currentGroup.push(cur);
        }
    }
    groups.push(currentGroup);
    return groups.map((g, idx) => {
        const leader = g[0];
        const prices = g.map((o) => o.price);
        const weights = g.map((o) => Math.max(0.1, o.weight));
        const totalWeight = Math.round(weights.reduce((a, b) => a + b, 0) * 100) / 100;
        return {
            clusterIndex: idx + 1,
            leaderPrice: leader.price,
            leaderShopName: leader.shopName,
            leaderShopCity: leader.shopCity,
            meanPrice: Math.round((0, stats_1.mean)(prices)),
            weightedMeanPrice: Math.round((0, stats_1.weightedMean)(prices, weights)),
            totalWeight,
            sellerCount: g.length,
            isReachableAboveFloor: hardFloorPrice <= 0 || leader.price - undercutAmount >= hardFloorPrice || leader.price >= hardFloorPrice,
            offers: g,
        };
    });
}
/**
 * مرحله ۳: تجمیع — محاسبه «قیمت مرجع بازار کشوری»، «هسته چگال/مد بازار (Modal Consensus)»،
 * «خلاصه بازار شهر پیش‌فرض (مشهد)» و «خوشه‌بندی سطوح فروشندگان»
 */
function summarizeMarket(offers, cfg, opts) {
    const guaranteeStrict = opts?.guaranteeStrict ?? false;
    const defaultCity = opts?.defaultCity ?? "مشهد";
    const hardFloorPrice = opts?.hardFloorPrice ?? 0;
    const undercutAmount = opts?.undercutAmount ?? 1000;
    const clusterMaxGapPct = opts?.clusterMaxGapPct ?? 5;
    const highTrustScore = opts?.highTrustScoreThreshold ?? 4.5;
    const safePercentile = opts?.safePercentile ?? 55;
    const upperPercentile = opts?.upperPercentile ?? 82;
    const used = offers.filter((o) => o.included).sort((a, b) => a.price - b.price);
    const localUsed = used.filter((o) => o.isLocalCity);
    const computeRef = (list) => {
        if (!list.length)
            return null;
        const p = list.map((o) => o.price);
        const w = list.map((o) => o.weight);
        const modal = computeModalConsensusPrice(list, cfg.modalClusterRadiusPct ?? 3.0);
        const trimW = computeTrimmedWeightedMean(list, cfg.trimPct);
        switch (cfg.method) {
            case "median":
                return (0, stats_1.median)(p);
            case "trimmed_mean":
                return (0, stats_1.trimmedMean)(p, cfg.trimPct);
            case "modal_consensus":
                // ترکیب ۶۰٪ هسته چگال فروشندگان به‌روز + ۴۰٪ میانگین وزنی بریده برای بالاترین دقت و پایداری
                return modal != null && trimW != null
                    ? Math.round(0.6 * modal + 0.4 * trimW)
                    : modal ?? trimW ?? (0, stats_1.weightedMean)(p, w);
            case "weighted_mean":
            default:
                return (0, stats_1.weightedMean)(p, w);
        }
    };
    const localPrices = localUsed.map((o) => o.price);
    const localSummary = {
        cityName: defaultCity,
        count: localUsed.length,
        lowest: localPrices.length ? localPrices[0] : null,
        lowestShopName: localUsed[0]?.shopName ?? null,
        highest: localPrices.length ? localPrices[localPrices.length - 1] : null,
        median: localPrices.length ? (0, stats_1.median)(localPrices) : null,
        mean: localPrices.length ? (0, stats_1.mean)(localPrices) : null,
        reference: computeRef(localUsed),
        offers: localUsed,
    };
    if (!used.length) {
        return {
            count: 0,
            lowest: null,
            lowestShopName: null,
            secondLowest: null,
            highest: null,
            median: null,
            mean: null,
            trimmedWeightedMean: null,
            modalConsensus: null,
            safePercentilePrice: null,
            upperBenchmarkPrice: null,
            reference: null,
            dispersion: 0,
            localCity: localSummary,
            clusters: [],
            dominantCluster: null,
            firstReachableNationalOffer: null,
            firstReachableLocalOffer: null,
            firstReachableHighTrustOffer: null,
            suspectLows: opts?.suspectLows ?? [],
            ceiling: null,
            highTrustLowest: null,
        };
    }
    const prices = (0, stats_1.sortAsc)(used.map((o) => o.price));
    const modalConsensus = computeModalConsensusPrice(used, cfg.modalClusterRadiusPct ?? 3.0);
    const trimmedWeightedMean = computeTrimmedWeightedMean(used, cfg.trimPct);
    const reference = computeRef(used);
    const safePercentilePrice = Math.round((0, stats_1.percentile)(prices, safePercentile));
    const upperBenchmarkPrice = Math.round((0, stats_1.percentile)(prices, upperPercentile));
    const clusters = buildSellerClusters(used, clusterMaxGapPct, hardFloorPrice, undercutAmount);
    const dominantCluster = clusters.length > 0
        ? [...clusters].sort((a, b) => b.totalWeight - a.totalWeight || b.sellerCount - a.sellerCount)[0]
        : null;
    const firstReachableNationalOffer = used.find((o) => o.price >= hardFloorPrice) ?? null;
    const firstReachableLocalOffer = localUsed.find((o) => o.price >= hardFloorPrice) ?? null;
    const firstReachableHighTrustOffer = used.find((o) => o.price >= hardFloorPrice &&
        ((o.shopScore != null && o.shopScore >= highTrustScore) || hasGuarantee(o.guarantee, guaranteeStrict))) ?? null;
    // سقف واقعی بازار (نسخه ۴.۱): کمینه از صدک credible، میانه×(۱+حداکثر فاصله مجاز) و بالاترین credible
    const crediblePool = used.filter((o) => o.credible);
    const ceilingSourcePool = crediblePool.length >= 2 ? crediblePool : used;
    const ceilingCandidates = [];
    const pCeiling = (0, stats_1.percentile)(ceilingSourcePool.map((o) => o.price), opts?.ceilingPercentile ?? 85);
    if (Number.isFinite(pCeiling))
        ceilingCandidates.push(pCeiling);
    const medForCeiling = (0, stats_1.median)(prices);
    if (opts?.maxCeilingAboveMedianPct != null && Number.isFinite(medForCeiling)) {
        ceilingCandidates.push(medForCeiling * (1 + opts.maxCeilingAboveMedianPct / 100));
    }
    const highestCredible = crediblePool.length ? crediblePool[crediblePool.length - 1].price : null;
    if (highestCredible != null)
        ceilingCandidates.push(highestCredible);
    const ceiling = ceilingCandidates.length
        ? Math.round(Math.min(...ceilingCandidates))
        : null;
    const highTrustLowest = used.find((o) => (o.shopScore != null && o.shopScore >= highTrustScore) || hasGuarantee(o.guarantee, guaranteeStrict))?.price ?? null;
    return {
        count: used.length,
        lowest: prices[0],
        lowestShopName: used[0]?.shopName ?? null,
        secondLowest: prices.length > 1 ? prices[1] : null,
        highest: prices[prices.length - 1],
        median: (0, stats_1.median)(prices),
        mean: (0, stats_1.mean)(prices),
        trimmedWeightedMean,
        modalConsensus,
        safePercentilePrice,
        upperBenchmarkPrice,
        reference,
        dispersion: (0, stats_1.coefficientOfVariation)(prices),
        localCity: localSummary,
        clusters,
        dominantCluster,
        firstReachableNationalOffer,
        firstReachableLocalOffer,
        firstReachableHighTrustOffer,
        suspectLows: opts?.suspectLows ?? [],
        ceiling,
        highTrustLowest,
    };
}
