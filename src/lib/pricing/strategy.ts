import type { MarketSummary } from "./aggregate";
import type { CompetitivePositionReport, PricingProfileConfig, SupplyCostResolution } from "./types";

export interface StrategyOutcome {
  strategy:
    | "national_rank1_undercut"
    | "local_city_rank1_undercut"
    | "local_cluster_rank1"
    | "national_cluster_rank1"
    | "high_trust_cluster_rank1"
    | "local_monopoly_leader"
    | "market_maker_consensus"
    | "volume_floor_min_margin"
    | "rank1_undercut"
    | "match_lowest"
    | "reference"
    | "cost_plus"
    | "no_data"
    | "leader_sole_gap"
    | "provisional_market_percentile";
  competitionTier: CompetitivePositionReport["competitionTier"];
  targetPrice: number | null;
  explanation: string;
}

const fa = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("fa-IR"));

/**
 * محاسبه مقدار کاهش زیر قیمت رقیب (Undercut) برای قرارگیری در رتبه اول.
 * نسخه ۴.۱: اگر پله‌های undercut (undercutTiers) پیکربندی شده باشند، فقط مبلغ پله‌ی متناسب با سطح انکر استفاده می‌شود
 * (مثلاً کالاهای زیر ۲ میلیون → ۱ هزار، زیر ۱۰ میلیون → ۲ هزار، زیر ۳۰ میلیون → ۵ هزار، بالاتر → ۱۰ هزار تومان)؛
 * پیکربندی قدیمی (undercutAmount + undercutPct) فقط وقتی پله‌ای تعریف نشده به‌کار می‌رود.
 */
export function computeUndercutDelta(
  competitorPrice: number,
  cfg: PricingProfileConfig["rank1"],
): number {
  const tiers = cfg.undercutTiers ?? [];
  if (tiers.length) {
    for (const t of tiers) {
      if (t.upTo == null || competitorPrice <= t.upTo) {
        return Math.max(1, Math.round(t.amount));
      }
    }
    const last = tiers[tiers.length - 1];
    return Math.max(1, Math.round(last.amount));
  }
  const pctDelta = Math.round((competitorPrice * Math.max(0, cfg.undercutPct)) / 100);
  return Math.max(cfg.undercutAmount, pctDelta, 1000);
}

/**
 * مرحله ۴: استراتژی هوشمند و چندسطحی قیمت هدف
 *
 * دو رژیم عملکردی هوشمند:
 *
 * الف) رژیم «قیمت‌گذار معیار بازار (Market-Maker Consensus)» — وقتی محصول لیست همکار و قیمت خرید ندارد (`supply.usedMarketConsensusFloor === true`):
 *     - هدف: تبدیل شدن به مرجع قیمت‌گذاری درست و به‌روز بازار در ترب و مشهد، بدون هیچ‌گونه ریسک ضرر!
 *     - تمام فروشندگانی که زیر «کف امن اجماع بازار (`hardFloorPrice`)» هستند به‌عنوان فروشندگانِ احتمالاً آپدیت‌نشده/ریسکی کنار گذاشته می‌شوند.
 *     - اگر در باند امن بالای کف اجماع، فروشنده‌ای در شهر مشهد یا در خوشه اصلی بازار حضور داشته باشد،
 *       سیستم دقیقاً به اندازه `undercut` زیر اولین فروشنده داخل باند امن قرار می‌گیرد تا **سرگروه فروشندگان به‌روز بازار** شود؛
 *       وگرنه دقیقاً روی قیمت معیار هسته بازار (`hardFloorPrice`) می‌نشیند.
 *
 * ب) رژیم «رقابت چندسطحی مبتنی بر لیست خرید همکاران» — وقتی قیمت خرید داریم:
 *     - سطح ۱: صدر اول کل ترب و مشهد (`national_rank1_undercut`)
 *     - سطح ۲: صدر اول شهر پیش‌فرض مشهد (`local_city_rank1_undercut` / `local_cluster_rank1`)
 *     - سطح ۳: رتبه اول خوشه فروشندگان قابل رقابت بالای کف خرید (`national_cluster_rank1` / `high_trust_cluster_rank1`)
 *     - سطح ۴: تک‌فروشنده برتر مشهد یا کف حجم فروش (`local_monopoly_leader` / `volume_floor_min_margin`)
 */
export function decideTargetPrice(
  market: MarketSummary,
  cfg: PricingProfileConfig["rank1"],
  supply?: SupplyCostResolution,
): StrategyOutcome {
  if (market.reference == null || market.lowest == null) {
    return {
      strategy: "no_data",
      competitionTier: "no_data",
      targetPrice: null,
      explanation: "هیچ داده معتبری از بازار ترب موجود نیست",
    };
  }

  const ref = market.reference;
  const nationalLow = market.lowest;
  const hardFloor = supply?.hardFloorPrice ?? 0;
  const defaultCity = cfg.defaultCity || "مشهد";
  const gapPct = ((ref - nationalLow) / ref) * 100;

  // =========================================================================
  // پله صفر: «سیاست رهبر منفرد» در بازار خلوت
  // پیش‌فرض (leaderPremiumMode=false): هرگز بالای رهبر نمی‌نشینیم.
  //   - اگر undercut رهبر با حفظ کف/حداقل حاشیه ممکن باشد ⇒ رتبه ۱ دقیقاً زیر رهبر.
  //   - وگرنه زیر بدنه‌ی بازار (اولین پیشنهاد قابل‌رقابت بالای کف) قرار می‌گیریم.
  // حالت premium (اختیاری، سازگاری با رفتار قبلی): پلک leaderGapPct بالای رهبر.
  // =========================================================================
  const clusters = market.clusters ?? [];
  const lowestCluster = clusters[0];
  const sparseSellers = market.count > 0 && market.count <= 4;
  const leaderIsSole =
    nationalLow != null &&
    lowestCluster?.leaderPrice === nationalLow &&
    lowestCluster.sellerCount === 1;

  if (sparseSellers && leaderIsSole && nationalLow != null && ref != null && nationalLow < ref) {
    const cost = supply?.effectiveCostPrice ?? 0;

    if (cfg.leaderPremiumMode === true && cfg.leaderGapPct > 0) {
      const gapAnchor = Math.round(nationalLow * (1 + cfg.leaderGapPct / 100));
      const followerAnchor = nationalLow;
      const gapCandidateMarginPct = cost > 0 ? ((gapAnchor - cost) / cost) * 100 : -1;

      if (gapCandidateMarginPct >= cfg.leaderMinMarginPct) {
        const leaderGapTarget = Math.max(hardFloor, gapAnchor);
        return {
          strategy: "leader_sole_gap",
          competitionTier: "leader_sole_gap",
          targetPrice: leaderGapTarget,
          explanation:
            `حالت premium رهبر منفرد (بازار خلوت با ${market.count} فروشنده): رهبر «${market.lowestShopName}» ${fa(nationalLow)} تومان است — ` +
            `پلک ${cfg.leaderGapPct}% بالای رهبر (${fa(leaderGapTarget)} تومان)؛ حاشیه ${gapCandidateMarginPct.toFixed(1)}% ≥ حداقل ${cfg.leaderMinMarginPct}%`,
        };
      }
      // حاشیه اجازه نمی‌دهد؛ با حفظ کف، قیمت رهبر منفرد را دنبال می‌کنیم
      if (cost <= 0 || followerAnchor > hardFloor) {
        return {
          strategy: "match_lowest",
          competitionTier: "national_rank1",
          targetPrice: Math.max(hardFloor, followerAnchor),
          explanation:
            `حاشیه ما برای پلک ${cfg.leaderGapPct}%-ی بالای رهبر کافی نیست (${Math.max(0, gapCandidateMarginPct).toFixed(1)}% < ${cfg.leaderMinMarginPct}%)؛ دنبال کردن قیمت رهبر منفرد (${fa(Math.max(hardFloor, followerAnchor))} تومان)`,
        };
      }
    } else {
      const leaderUndercut = computeUndercutDelta(nationalLow, cfg);
      const followerTarget = Math.max(hardFloor, nationalLow - leaderUndercut);
      const followerMarginPct = cost > 0 ? ((followerTarget - cost) / cost) * 100 : -1;
      const canFollowLeader =
        (hardFloor <= 0 || nationalLow - leaderUndercut >= hardFloor || hardFloor <= nationalLow) &&
        (cost <= 0 || followerMarginPct >= cfg.leaderMinMarginPct);

      if (canFollowLeader) {
        return {
          strategy: "national_rank1_undercut",
          competitionTier: "national_rank1",
          targetPrice: followerTarget,
          explanation:
            `رهبر منفرد بازار (${market.count} فروشنده): «${market.lowestShopName}» با ${fa(nationalLow)} تومان — ` +
            `قیمت ${fa(followerTarget)} تومان (${fa(Math.max(0, nationalLow - followerTarget))} تومان زیر رهبر) برای رتبه ۱؛ ` +
            `حاشیه ${followerMarginPct.toFixed(1)}% ≥ حداقل ${cfg.leaderMinMarginPct}%`,
        };
      }

      // دنبال‌کردن رهبر با کف/حاشیه سازگار نیست ⇒ زیر بدنه بازار، نه بالاتر از رهبر
      const body = market.firstReachableNationalOffer;
      if (body && body.price > nationalLow) {
        const bodyUndercut = computeUndercutDelta(body.price, cfg);
        const target = Math.max(hardFloor, body.price - bodyUndercut);
        return {
          strategy: "national_cluster_rank1",
          competitionTier: "national_cluster_rank1",
          targetPrice: target,
          explanation:
            `رهبر منفرد ${fa(nationalLow)} تومان زیر/نزدیک کف مجاز ما (${fa(hardFloor)}) است و دنبال‌کردنش حاشیه ${Math.max(0, followerMarginPct).toFixed(1)}% < ${cfg.leaderMinMarginPct}% می‌دهد؛ ` +
            `زیر بدنه بازار و جلوی «${body.shopName}» (${fa(body.price)}) با قیمت ${fa(target)} تومان قرار گرفتیم — هرگز بالاتر از رهبر نمی‌نشینیم`,
        };
      }

      if (cfg.volumeMode && hardFloor > 0) {
        return {
          strategy: "volume_floor_min_margin",
          competitionTier: "volume_floor_min_margin",
          targetPrice: hardFloor,
          explanation:
            `رهبر منفرد بازار با حاشیه کافی قابل دنبال‌کردن نیست و بدنه‌ی دیگری بالای کف وجود ندارد؛ ` +
            `قیمت روی کمترین مقدار مجاز و سودآور (${fa(hardFloor)} تومان) تنظیم شد`,
        };
      }

      return {
        strategy: "match_lowest",
        competitionTier: "national_rank1",
        targetPrice: Math.max(hardFloor, nationalLow),
        explanation: `رهبر منفرد بازار ${fa(nationalLow)} تومان است؛ بدون پرش بالاتر از رهبر، روی همان قیمت (${fa(Math.max(hardFloor, nationalLow))}) قرار گرفتیم`,
      };
    }
  }

  // =========================================================================
  // (نسخه ۴.۱) رژیم «قیمت‌گذار معیار بازار (Market-Maker Consensus)» حذف شد:
  // مسیر بی‌هزینه دیگر اجماع ترب را به کف شما نگیرِ خودکار تبدیل نمی‌کند؛ به جایش در موتور
  // قیمت Provisional (صدک پایین پول به‌روز و معتبر) می‌سازد و به رِیویو می‌فرستد (P2-3).
  // =========================================================================

  if (!cfg.enabled) {
    const refTarget = Math.max(hardFloor, ref);
    return {
      strategy: "reference",
      competitionTier: "market_reference",
      targetPrice: refTarget,
      explanation: `استراتژی رتبه اول غیرفعال است؛ قیمت مرجع بازار (${fa(refTarget)} تومان) انتخاب شد`,
    };
  }

  const nationalUndercut = computeUndercutDelta(nationalLow, cfg);
  const nationalRank1Candidate = nationalLow - nationalUndercut;

  const canBeatNationalLowest = hardFloor <= 0 || nationalRank1Candidate >= hardFloor;
  const canMatchOrBeatNationalAtFloor = hardFloor > 0 && hardFloor <= nationalLow;
  const effectiveMaxGapPct = cfg.volumeMode ? Math.max(cfg.maxGapPct * 2.5, 12) : cfg.maxGapPct;

  // =========================================================================
  // سطح ۱: رقابت برای صدر اول کل ترب (و همزمان صدر اول مشهد)
  // =========================================================================
  if ((canBeatNationalLowest || canMatchOrBeatNationalAtFloor) && gapPct <= effectiveMaxGapPct) {
    const target = hardFloor > 0 ? Math.max(hardFloor, nationalRank1Candidate) : nationalRank1Candidate;
    return {
      strategy: "national_rank1_undercut",
      competitionTier: "national_rank1",
      targetPrice: target,
      explanation:
        `صدر اول کل ترب و ${defaultCity}: کمترین قیمت معتبر کشوری ${fa(nationalLow)} تومان («${market.lowestShopName ?? "رقیب"}») است ` +
        `که بالای کف سود ما (${fa(hardFloor)} تومان) قرار دارد → قیمت هدف ${fa(target)} تومان برای کسب رتبه ۱ کل ترب و ${defaultCity}`,
    };
  }

  // =========================================================================
  // سطح ۲: بازگشت هوشمند به رقابت در شهر پیش‌فرض (مشهد)
  // =========================================================================
  if (cfg.competeInDefaultCity) {
    const local = market.localCity;

    if (local.count > 0 && local.lowest != null) {
      const localUndercut = computeUndercutDelta(local.lowest, cfg);
      const localRank1Candidate = local.lowest - localUndercut;

      if (hardFloor <= 0 || localRank1Candidate >= hardFloor || hardFloor <= local.lowest) {
        const target = hardFloor > 0 ? Math.max(hardFloor, localRank1Candidate) : localRank1Candidate;

        if (
          cfg.volumeMode &&
          market.firstReachableNationalOffer &&
          market.firstReachableNationalOffer.price < target
        ) {
          const natClusterUndercut = computeUndercutDelta(market.firstReachableNationalOffer.price, cfg);
          const dualTarget = Math.max(
            hardFloor,
            market.firstReachableNationalOffer.price - natClusterUndercut,
          );
          return {
            strategy: "local_city_rank1_undercut",
            competitionTier: "local_city_rank1",
            targetPrice: dualTarget,
            explanation:
              `صدر اول ${defaultCity} + سرگروه خوشه کشوری: کف کشوری (${fa(nationalLow)}) زیر کف خرید ماست، اما در شهر ${defaultCity} ارزان‌ترین رقیب ${fa(local.lowest)} («${local.lowestShopName}») است → ` +
              `قیمت ${fa(dualTarget)} تومان انتخاب شد تا هم در ${defaultCity} رتبه ۱ مطلق باشیم و هم در کل ترب جلوی گروه فروشندگان (${fa(market.firstReachableNationalOffer.price)}) قرار بگیریم`,
          };
        }

        return {
          strategy: "local_city_rank1_undercut",
          competitionTier: "local_city_rank1",
          targetPrice: target,
          explanation:
            `صدر اول شهر ${defaultCity}: رقابت با کف کشوری (${fa(nationalLow)} تومان) به دلیل حفظ خط قرمز خرید (${fa(hardFloor)} تومان) رد شد؛ ` +
            `بررسی بازار ${defaultCity} (${local.count} فروشنده) نشان داد کف ${defaultCity} ${fa(local.lowest)} تومان («${local.lowestShopName}») است → قیمت ${fa(target)} تومان برای رتبه ۱ ${defaultCity}`,
        };
      }

      if (market.firstReachableLocalOffer) {
        const reachLocal = market.firstReachableLocalOffer;
        const reachUndercut = computeUndercutDelta(reachLocal.price, cfg);
        const target = Math.max(hardFloor, reachLocal.price - reachUndercut);
        return {
          strategy: "local_cluster_rank1",
          competitionTier: "local_cluster_rank1",
          targetPrice: target,
          explanation:
            `رتبه اول گروه فروشندگان قابل رقابت در ${defaultCity}: کف خام ${defaultCity} (${fa(local.lowest)}) زیر خط قرمز تامین (${fa(hardFloor)}) است؛ ` +
            `اولین رقیب معتبر ${defaultCity} بالای کف ما «${reachLocal.shopName}» با قیمت ${fa(reachLocal.price)} تومان است → قیمت ${fa(target)} تومان برای دیده شدن در صدر این گروه`,
        };
      }
    }
  }

  // =========================================================================
  // سطح ۳: رقابت در صدر اولین گروه/خوشه از فروشندگان قابل دسترس در کل ترب
  // =========================================================================
  if (cfg.competeInReachableCluster && market.firstReachableNationalOffer) {
    const firstReachable = market.firstReachableNationalOffer;
    const clusterUndercut = computeUndercutDelta(firstReachable.price, cfg);
    const candidate = Math.max(hardFloor, firstReachable.price - clusterUndercut);

    const highTrust = market.firstReachableHighTrustOffer;
    if (
      highTrust &&
      highTrust.shopName !== firstReachable.shopName &&
      highTrust.price <= firstReachable.price * 1.02
    ) {
      const htUndercut = computeUndercutDelta(highTrust.price, cfg);
      const htTarget = Math.max(hardFloor, highTrust.price - htUndercut);
      return {
        strategy: "high_trust_cluster_rank1",
        competitionTier: "high_trust_cluster_rank1",
        targetPrice: htTarget,
        explanation:
          `رتبه ۱ گروه فروشندگان خوش‌امتیاز ترب: فروشندگان ارزان‌تر زیر کف خرید ما (${fa(hardFloor)}) هستند؛ ` +
          `قرارگیری در صدر گروه فروشندگان معتبر بالای کف (زیر قیمت «${highTrust.shopName}» با ${fa(highTrust.price)}) در قیمت ${fa(htTarget)} تومان`,
      };
    }

    return {
      strategy: "national_cluster_rank1",
      competitionTier: "national_cluster_rank1",
      targetPrice: candidate,
      explanation:
        `صدر اول گروه فروشندگان قابل رقابت در ترب (سود کم، فروش زیاد): فروشندگان ارزان‌تر (${fa(nationalLow)}) زیر خط قرمز تامین ما (${fa(hardFloor)}) هستند؛ ` +
        `با قیمت ${fa(candidate)} تومان دقیقاً در رتبه ۱ گروه فروشندگان بالای کف (جلوی «${firstReachable.shopName}» با قیمت ${fa(firstReachable.price)}) قرار می‌گیریم`,
    };
  }

  // =========================================================================
  // سطح ۴: اگر در مشهد هیچ رقیبی نداریم (تک‌فروشنده مشهد) و مرجع کشوری بالای کف ماست
  // =========================================================================
  if (
    cfg.competeInDefaultCity &&
    market.localCity.count === 0 &&
    ref > hardFloor
  ) {
    const discPct = Math.max(0, cfg.localMonopolyDiscountFromRefPct ?? 1);
    const monopolyTarget = Math.max(hardFloor, Math.round(ref * (1 - discPct / 100)));
    return {
      strategy: "local_monopoly_leader",
      competitionTier: "local_monopoly_leader",
      targetPrice: monopolyTarget,
      explanation:
        `صدرنشین انحصاری ${defaultCity}: هیچ رقیب دیگری در شهر ${defaultCity} ثبت نشده و کف کشوری (${fa(nationalLow)}) زیر کف ماست؛ ` +
        `قیمت ${fa(monopolyTarget)} تومان (${discPct}% زیر مرجع بازار ${fa(ref)}) برای حفظ جایگاه اول ${defaultCity} با سود بهینه انتخاب شد`,
    };
  }

  // =========================================================================
  // سطح ۵: حالت «سود کم ولی فروش زیاد» در بازار فوق‌فشرده → قرارگیری روی خط قرمز حداقل سود
  // =========================================================================
  if (cfg.volumeMode && hardFloor > 0) {
    return {
      strategy: "volume_floor_min_margin",
      competitionTier: "volume_floor_min_margin",
      targetPrice: hardFloor,
      explanation:
        `استراتژی سود کم و فروش زیاد (کف مجاز تامین): تمام رقبای فعلی (${fa(nationalLow)} تا ${fa(market.highest)}) زیر خط قرمز تامین + حداقل سود ما هستند → ` +
        `تنظیم روی کمترین قیمت مجاز و سودآور (${fa(hardFloor)} تومان) برای حفظ بیشترین شانس فروش بدون ضرر`,
    };
  }

  if (cfg.fallbackToReference) {
    const target = Math.max(hardFloor, ref);
    return {
      strategy: "reference",
      competitionTier: "market_reference",
      targetPrice: target,
      explanation: `اختلاف کف بازار با مرجع ${gapPct.toFixed(2)}% (> ${cfg.maxGapPct}%) → قیمت مرجع بازار (${fa(target)}) انتخاب شد`,
    };
  }

  return {
    strategy: "match_lowest",
    competitionTier: "national_rank1",
    targetPrice: Math.max(hardFloor, nationalLow),
    explanation: `اختلاف ${gapPct.toFixed(2)}% → برابر با کف مجاز بازار (${fa(Math.max(hardFloor, nationalLow))})`,
  };
}

/**
 * محاسبه جایگاه رقابتی پیش‌بینی‌شده ما در کل ترب و در شهر پیش‌فرض (مشهد) پس از تعیین قیمت نهایی
 */
export function evaluateCompetitivePosition(
  finalPrice: number,
  market: MarketSummary,
  supply: SupplyCostResolution,
  competitionTier: CompetitivePositionReport["competitionTier"],
): CompetitivePositionReport {
  const validNational = market.clusters.flatMap((c) => c.offers).sort((a, b) => a.price - b.price);
  const validLocal = market.localCity.offers.sort((a, b) => a.price - b.price);

  const cheaperNationalCount = validNational.filter((o) => o.price < finalPrice).length;
  const cheaperLocalCount = validLocal.filter((o) => o.price < finalPrice).length;

  const projectedNationalRank = validNational.length > 0 ? cheaperNationalCount + 1 : 1;
  const projectedLocalRank = validLocal.length > 0 ? cheaperLocalCount + 1 : 1;

  // رتبه‌ی شفاف با احتساب فروشنده‌های مشکوک/کهنه‌ای که از بازار قابل‌اتکا حذف شده‌اند.
  // رتبه‌ی رسمی (projectedNationalRank) فقط قابل‌اتکاها را می‌شمارد؛ این عدد کنارش گزارش می‌شود
  // تا «رتبه ۱» در بازار دارای ارزان‌فروش تازه، گمراه‌کننده نباشد.
  const suspectPrices = (market.suspectLows ?? []).map((s) => s.price).filter((p) => p > 0);
  const allNationalPrices = [...validNational.map((o) => o.price), ...suspectPrices];
  const cheaperIncludingSuspect = allNationalPrices.filter((p) => p < finalPrice).length;
  const rankIncludingSuspect = allNationalPrices.length > 0 ? cheaperIncludingSuspect + 1 : null;
  const totalSellersIncludingSuspect = allNationalPrices.length;

  // فاصله ما از رهبر منفرد بازار (مثبت = زیر قیمت رهبریم، منفی = بالاتر)
  const leaderCluster = market.clusters[0] ?? null;
  const leaderGapPct =
    leaderCluster && leaderCluster.sellerCount === 1 && finalPrice > 0
      ? Math.round(
          ((leaderCluster.leaderPrice - finalPrice) / Math.max(1, leaderCluster.leaderPrice)) * 100,
        )
      : null;

  const cost = supply.effectiveCostPrice;
  const netProfitToman = cost > 0 ? finalPrice - cost : 0;
  const netMarginPct = cost > 0 ? Math.round(((finalPrice - cost) / cost) * 10000) / 100 : 0;

  return {
    projectedNationalRank,
    totalNationalValidSellers: validNational.length,
    projectedLocalRank,
    totalLocalValidSellers: validLocal.length,
    localLowestPrice: market.localCity.lowest,
    localMedianPrice: market.localCity.median != null ? Math.round(market.localCity.median) : null,
    firstReachableNationalPrice: market.firstReachableNationalOffer?.price ?? null,
    firstReachableLocalPrice: market.firstReachableLocalOffer?.price ?? null,
    modalConsensusPrice: market.modalConsensus,
    netProfitToman,
    netMarginPct,
    competitionTier,
    leaderGapPct,
    rankIncludingSuspect,
    totalSellersIncludingSuspect,
  };
}
