import {
  coefficientOfVariation,
  mean,
  median,
  percentile,
  sortAsc,
  trimmedMean,
  weightedMean,
} from "./stats";
import type { OfferEvaluation, PricingProfileConfig } from "./types";

export interface SellerCluster {
  /** شماره خوشه (۱ = ارزان‌ترین گروه فروشندگان) */
  clusterIndex: number;
  /** قیمت سرگروه (ارزان‌ترین فروشنده این خوشه) */
  leaderPrice: number;
  /** نام فروشگاه سرگروه */
  leaderShopName: string;
  /** شهر سرگروه */
  leaderShopCity?: string | null;
  /** میانگین قیمت در این خوشه */
  meanPrice: number;
  /** میانگین وزنی قیمت در این خوشه */
  weightedMeanPrice: number;
  /** مجموع وزن (اعتبار × تازگی) فروشندگان حاضر در این خوشه */
  totalWeight: number;
  /** تعداد فروشندگان حاضر در این خوشه */
  sellerCount: number;
  /** آیا این خوشه بالای خط قرمز کف قیمت خرید/تامین ما (hardFloorPrice) قرار دارد؟ */
  isReachableAboveFloor: boolean;
  /** پیشنهادهای عضو این خوشه */
  offers: OfferEvaluation[];
}

export interface CityMarketSummary {
  cityName: string;
  count: number;
  lowest: number | null;
  lowestShopName: string | null;
  highest: number | null;
  median: number | null;
  mean: number | null;
  reference: number | null;
  offers: OfferEvaluation[];
}

export interface MarketSummary {
  count: number;
  lowest: number | null;
  lowestShopName: string | null;
  secondLowest: number | null;
  highest: number | null;
  median: number | null;
  mean: number | null;
  trimmedWeightedMean: number | null;
  /**
   * قیمت هسته چگال/مد بازار (Modal Consensus Price):
   * قیمتی که بیشترین تراکم وزنیِ فروشندگان به‌روز و معتبر ترب حول آن شکل گرفته است.
   */
  modalConsensus: number | null;
  /** صدک امن بازار (مثلاً صدک ۵۵) برای تضمین عدم ضرر زمانی که لیست خرید نداریم */
  safePercentilePrice: number | null;
  /** صدک بالای بازار (مثلاً صدک ۸۲) برای تعیین «قیمت اصلی معیار» (خط‌خورده) */
  upperBenchmarkPrice: number | null;
  /** قیمت مرجع نهایی بازار */
  reference: number | null;
  dispersion: number; // ضریب تغییرات (0 = همه یک قیمت)
  /** خلاصه بازار اختصاصی شهر پیش‌فرض (مشهد) */
  localCity: CityMarketSummary;
  /** خوشه‌های قیمتی فروشندگان در ترب */
  clusters: SellerCluster[];
  /** پرتراکم‌ترین خوشه بازار (هسته اصلی فروشندگان به‌روز) */
  dominantCluster: SellerCluster | null;
  /** اولین قیمت معتبر در کل ترب که بالای خط قرمز سود ما قابل رقابت است */
  firstReachableNationalOffer: OfferEvaluation | null;
  /** اولین قیمت معتبر در شهر مشهد که بالای خط قرمز سود ما قابل رقابت است */
  firstReachableLocalOffer: OfferEvaluation | null;
  /** ارزان‌ترین فروشنده دارای امتیاز بالا (High-Trust) که بالای کف ماست */
  firstReachableHighTrustOffer: OfferEvaluation | null;
}

/**
 * کشف «هسته چگال / مد وزنی بازار» (Kernel Modal Consensus):
 * برای هر پیشنهاد معتبر، یک پنجره به شعاع `radiusPct` (مثلاً ±۳٪) در نظر می‌گیرد و مجموع وزن
 * (تازگی × امتیاز فروشگاه) پیشنهادهای داخل آن پنجره را حساب می‌کند.
 * پنجره‌ای که بیشترین تراکم وزنی را دارد، «توافق واقعی فروشندگان به‌روز بازار» است!
 */
export function computeModalConsensusPrice(
  offers: OfferEvaluation[],
  radiusPct = 3.0,
): number | null {
  if (!offers.length) return null;
  if (offers.length === 1) return offers[0].price;

  const r = Math.max(0.5, radiusPct) / 100;
  let bestTotalWeight = -1;
  let bestWindowOffers: OfferEvaluation[] = [];

  for (const center of offers) {
    const lo = center.price * (1 - r);
    const hi = center.price * (1 + r);
    const inWindow = offers.filter((o) => o.price >= lo && o.price <= hi);
    const wSum = inWindow.reduce((acc, o) => acc + Math.max(0.1, o.weight), 0);
    if (
      wSum > bestTotalWeight ||
      (Math.abs(wSum - bestTotalWeight) < 1e-6 && inWindow.length > bestWindowOffers.length)
    ) {
      bestTotalWeight = wSum;
      bestWindowOffers = inWindow;
    }
  }

  if (!bestWindowOffers.length) {
    return weightedMean(
      offers.map((o) => o.price),
      offers.map((o) => o.weight),
    );
  }

  return Math.round(
    weightedMean(
      bestWindowOffers.map((o) => o.price),
      bestWindowOffers.map((o) => o.weight),
    ),
  );
}

/**
 * میانگین وزنی بریده (Trimmed Weighted Mean):
 * ابتدا درصدی از دو سرِ بسیار ارزان و بسیار گران را برش می‌زند و سپس میانگین وزنی (بر اساس تازگی و امتیاز) می‌گیرد.
 */
export function computeTrimmedWeightedMean(
  offers: OfferEvaluation[],
  trimPct = 15,
): number | null {
  if (!offers.length) return null;
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  const k = sorted.length >= 4 ? Math.floor((sorted.length * Math.max(0, trimPct)) / 100) : 0;
  const body = sorted.slice(k, sorted.length - k);
  const target = body.length ? body : sorted;
  return Math.round(
    weightedMean(
      target.map((o) => o.price),
      target.map((o) => o.weight),
    ),
  );
}

/**
 * خوشه‌بندی پیشنهادهای معتبر فروشندگان بر اساس فاصله درصدی (clusterMaxGapPct)
 * تا سیستم بتواند «گروه‌های فروشندگان هم‌سطح» و «پرتراکم‌ترین خوشه بازار» را تشخیص دهد.
 */
export function buildSellerClusters(
  validOffers: OfferEvaluation[],
  clusterMaxGapPct: number,
  hardFloorPrice: number,
  undercutAmount: number,
): SellerCluster[] {
  if (!validOffers.length) return [];
  const sorted = [...validOffers].sort((a, b) => a.price - b.price);
  const gapRatio = Math.max(0.5, clusterMaxGapPct) / 100;

  const groups: OfferEvaluation[][] = [];
  let currentGroup: OfferEvaluation[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const leader = currentGroup[0];
    const stepGap = (cur.price - prev.price) / Math.max(1, prev.price);
    const leaderGap = (cur.price - leader.price) / Math.max(1, leader.price);
    if (stepGap > gapRatio * 0.65 || leaderGap > gapRatio) {
      groups.push(currentGroup);
      currentGroup = [cur];
    } else {
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
      meanPrice: Math.round(mean(prices)),
      weightedMeanPrice: Math.round(weightedMean(prices, weights)),
      totalWeight,
      sellerCount: g.length,
      isReachableAboveFloor:
        hardFloorPrice <= 0 || leader.price - undercutAmount >= hardFloorPrice || leader.price >= hardFloorPrice,
      offers: g,
    };
  });
}

/**
 * مرحله ۳: تجمیع — محاسبه «قیمت مرجع بازار کشوری»، «هسته چگال/مد بازار (Modal Consensus)»،
 * «خلاصه بازار شهر پیش‌فرض (مشهد)» و «خوشه‌بندی سطوح فروشندگان»
 */
export function summarizeMarket(
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["aggregation"],
  opts?: {
    defaultCity?: string;
    hardFloorPrice?: number;
    undercutAmount?: number;
    clusterMaxGapPct?: number;
    highTrustScoreThreshold?: number;
    safePercentile?: number;
    upperPercentile?: number;
  },
): MarketSummary {
  const defaultCity = opts?.defaultCity ?? "مشهد";
  const hardFloorPrice = opts?.hardFloorPrice ?? 0;
  const undercutAmount = opts?.undercutAmount ?? 1000;
  const clusterMaxGapPct = opts?.clusterMaxGapPct ?? 5;
  const highTrustScore = opts?.highTrustScoreThreshold ?? 4.5;
  const safePercentile = opts?.safePercentile ?? 55;
  const upperPercentile = opts?.upperPercentile ?? 82;

  const used = offers.filter((o) => o.included).sort((a, b) => a.price - b.price);
  const localUsed = used.filter((o) => o.isLocalCity);

  const computeRef = (list: OfferEvaluation[]): number | null => {
    if (!list.length) return null;
    const p = list.map((o) => o.price);
    const w = list.map((o) => o.weight);
    const modal = computeModalConsensusPrice(list, cfg.modalClusterRadiusPct ?? 3.0);
    const trimW = computeTrimmedWeightedMean(list, cfg.trimPct);
    switch (cfg.method) {
      case "median":
        return median(p);
      case "trimmed_mean":
        return trimmedMean(p, cfg.trimPct);
      case "modal_consensus":
        // ترکیب ۶۰٪ هسته چگال فروشندگان به‌روز + ۴۰٪ میانگین وزنی بریده برای بالاترین دقت و پایداری
        return modal != null && trimW != null
          ? Math.round(0.6 * modal + 0.4 * trimW)
          : modal ?? trimW ?? weightedMean(p, w);
      case "weighted_mean":
      default:
        return weightedMean(p, w);
    }
  };

  const localPrices = localUsed.map((o) => o.price);
  const localSummary: CityMarketSummary = {
    cityName: defaultCity,
    count: localUsed.length,
    lowest: localPrices.length ? localPrices[0] : null,
    lowestShopName: localUsed[0]?.shopName ?? null,
    highest: localPrices.length ? localPrices[localPrices.length - 1] : null,
    median: localPrices.length ? median(localPrices) : null,
    mean: localPrices.length ? mean(localPrices) : null,
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
    };
  };

  const prices = sortAsc(used.map((o) => o.price));
  const modalConsensus = computeModalConsensusPrice(used, cfg.modalClusterRadiusPct ?? 3.0);
  const trimmedWeightedMean = computeTrimmedWeightedMean(used, cfg.trimPct);
  const reference = computeRef(used);
  const safePercentilePrice = Math.round(percentile(prices, safePercentile));
  const upperBenchmarkPrice = Math.round(percentile(prices, upperPercentile));

  const clusters = buildSellerClusters(used, clusterMaxGapPct, hardFloorPrice, undercutAmount);
  const dominantCluster =
    clusters.length > 0
      ? [...clusters].sort((a, b) => b.totalWeight - a.totalWeight || b.sellerCount - a.sellerCount)[0]
      : null;

  const firstReachableNationalOffer = used.find((o) => o.price >= hardFloorPrice) ?? null;
  const firstReachableLocalOffer = localUsed.find((o) => o.price >= hardFloorPrice) ?? null;
  const firstReachableHighTrustOffer =
    used.find(
      (o) =>
        o.price >= hardFloorPrice &&
        ((o.shopScore != null && o.shopScore >= highTrustScore) || Boolean(o.guarantee)),
    ) ?? null;

  return {
    count: used.length,
    lowest: prices[0],
    lowestShopName: used[0]?.shopName ?? null,
    secondLowest: prices.length > 1 ? prices[1] : null,
    highest: prices[prices.length - 1],
    median: median(prices),
    mean: mean(prices),
    trimmedWeightedMean,
    modalConsensus,
    safePercentilePrice,
    upperBenchmarkPrice,
    reference,
    dispersion: coefficientOfVariation(prices),
    localCity: localSummary,
    clusters,
    dominantCluster,
    firstReachableNationalOffer,
    firstReachableLocalOffer,
    firstReachableHighTrustOffer,
  };
}
