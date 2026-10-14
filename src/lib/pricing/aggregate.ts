import { coefficientOfVariation, mean, median, trimmedMean, weightedMean } from "./stats";
import type { OfferEvaluation, PricingProfileConfig } from "./types";

export interface MarketSummary {
  count: number;
  lowest: number | null;
  highest: number | null;
  median: number | null;
  mean: number | null;
  reference: number | null;
  dispersion: number; // ضریب تغییرات (0 = همه یک قیمت)
}

/**
 * مرحله ۳: تجمیع — محاسبه «قیمت مرجع بازار»
 * - median: مقاوم به پرت
 * - trimmed_mean: میانگین بعد از برش درصدی دو سر
 * - weighted_mean: میانگین وزنی بر اساس تازگی قیمت (پیشنهاد پیش‌فرض)
 */
export function summarizeMarket(
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["aggregation"],
): MarketSummary {
  const used = offers.filter((o) => o.included);
  if (!used.length) {
    return { count: 0, lowest: null, highest: null, median: null, mean: null, reference: null, dispersion: 0 };
  }
  const prices = used.map((o) => o.price);
  const weights = used.map((o) => o.weight);

  let reference: number;
  switch (cfg.method) {
    case "median":
      reference = median(prices);
      break;
    case "trimmed_mean":
      reference = trimmedMean(prices, cfg.trimPct);
      break;
    case "weighted_mean":
    default:
      reference = weightedMean(prices, weights);
  }

  return {
    count: used.length,
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    median: median(prices),
    mean: mean(prices),
    reference,
    dispersion: coefficientOfVariation(prices),
  };
}
