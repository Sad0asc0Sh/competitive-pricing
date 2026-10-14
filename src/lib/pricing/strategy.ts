import type { MarketSummary } from "./aggregate";
import type { PricingProfileConfig } from "./types";

export interface StrategyOutcome {
  strategy: "rank1_undercut" | "match_lowest" | "reference" | "cost_plus" | "no_data";
  targetPrice: number | null;
  explanation: string;
}

/**
 * مرحله ۴: استراتژی قیمت هدف
 *
 * gap = (reference - lowestValid) / reference
 *   - اگر gap <= maxGapPct → کف بازار «معتبر و نزدیک به مرجع» است؛ رتبه اول را با کمی کاهش می‌گیریم.
 *   - اگر gap > maxGapPct → کف بازار احتمالاً غیرعادی است (حتی اگر از فیلترها رد شده)؛
 *     روی قیمت مرجع می‌نشینیم (یا اگر fallbackToReference خاموش باشد، کف را match می‌کنیم).
 */
export function decideTargetPrice(
  market: MarketSummary,
  cfg: PricingProfileConfig["rank1"],
): StrategyOutcome {
  if (market.reference == null || market.lowest == null) {
    return { strategy: "no_data", targetPrice: null, explanation: "هیچ داده معتبری از بازار موجود نیست" };
  }

  const ref = market.reference;
  const low = market.lowest;
  const gapPct = ((ref - low) / ref) * 100;

  if (!cfg.enabled) {
    return { strategy: "reference", targetPrice: ref, explanation: "استراتژی رتبه اول غیرفعال است؛ قیمت مرجع بازار انتخاب شد" };
  }

  if (gapPct <= cfg.maxGapPct) {
    const undercut = Math.max(cfg.undercutAmount, (low * cfg.undercutPct) / 100);
    const target = low - undercut;
    return {
      strategy: "rank1_undercut",
      targetPrice: target,
      explanation: `اختلاف کف بازار با مرجع ${gapPct.toFixed(2)}% (≤ ${cfg.maxGapPct}%) → کاهش ${Math.round(undercut).toLocaleString("fa-IR")} تومان زیر کف برای رتبه اول`,
    };
  }

  if (cfg.fallbackToReference) {
    return {
      strategy: "reference",
      targetPrice: ref,
      explanation: `اختلاف کف بازار با مرجع ${gapPct.toFixed(2)}% (> ${cfg.maxGapPct}%) → کف غیرقابل اعتماد؛ قیمت مرجع انتخاب شد`,
    };
  }

  return {
    strategy: "match_lowest",
    targetPrice: low,
    explanation: `اختلاف ${gapPct.toFixed(2)}% → برابر با کف بازار`,
  };
}
