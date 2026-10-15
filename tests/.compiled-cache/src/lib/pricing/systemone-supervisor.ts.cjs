"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DEFAULT_SUBQ_MODEL = exports.DEFAULT_SUBQ_BASE_URL = void 0;
exports.buildSubqSystemOneRequestBody = buildSubqSystemOneRequestBody;
exports.callSubqSystemOneApi = callSubqSystemOneApi;
exports.classifyThreeZoneScore = classifyThreeZoneScore;
exports.enrichSupervisorWithSubqApi = enrichSupervisorWithSubqApi;
exports.evaluateSystemOneSupervisorSync = evaluateSystemOneSupervisorSync;
exports.verdictFaLabel = void 0;
var _stats = require("./stats");
/**
 * ناظر و تصمیم‌گیرنده هوشمند بالاسر (`SubQ SystemOne Supervisor Engine`)
 *
 * معماری:
 *  - پیاده‌سازی دقیق استاندارد `POST https://api.subq.ai/v1/systemone` با مدل `subq-snap-preview` و سوالات از نوع `noul`
 *  - این سیستم **فقط تصمیم‌گیرنده (`Decision-Maker Only`)** است: اطلاعات ورودی، تطابق کالا، سلامت قیمت‌های استخراج‌شده،
 *    امنیت حاشیه سود و اعتبار سقف/تخفیف را در کسر ثانیه بررسی کرده و برای هر مقیاس یک نمره `noul` (`0.00` تا `1.00` معادل `0%` تا `100%`) صادر می‌کند.
 *  - قانون ۳ بازه‌ای کاملاً قابل شخصی‌سازی برای هر مقیاس و برای کل تصمیم:
 *      1) `scorePct < rejectBelowPct` (پیش‌فرض `< 45%`)        --> `reject`  (رد کامل و جلوگیری از ورود داده خطا)
 *      2) `rejectBelowPct <= scorePct < approveAbovePct` (`45%..80%`) --> `review`  (ارسال به بخش ریویو / بازبینی انسانی)
 *      3) `scorePct >= approveAbovePct` (پیش‌فرض `>= 80%`)     --> `approve` (تایید قطعی، ورود به سیستم و اعمال خودکار)
 */

const DEFAULT_SUBQ_BASE_URL = "https://api.subq.ai/v1";
exports.DEFAULT_SUBQ_BASE_URL = DEFAULT_SUBQ_BASE_URL;
const DEFAULT_SUBQ_MODEL = "subq-snap-preview";
exports.DEFAULT_SUBQ_MODEL = DEFAULT_SUBQ_MODEL;
function classifyThreeZoneScore(scorePct, rejectBelowPct, approveAbovePct) {
  const cleanScore = (0, _stats.clamp)(scorePct, 0, 100);
  const rej = (0, _stats.clamp)(rejectBelowPct, 0, 99);
  const app = (0, _stats.clamp)(approveAbovePct, rej + 1, 100);
  if (cleanScore < rej) return "reject";
  if (cleanScore < app) return "review";
  return "approve";
}
const verdictFaLabel = {
  approve: "تایید خودکار و ادامه (≥ آستانه سبز)",
  review: "ارسال به بخش ریویو (بازه میانی)",
  reject: "رد کامل و توقف (زیر خط قرمز اطمینان)"
};
exports.verdictFaLabel = verdictFaLabel;
function buildSubqSystemOneRequestBody(state, questions, model = DEFAULT_SUBQ_MODEL) {
  return {
    model,
    state,
    questions
  };
}
async function callSubqSystemOneApi(opts) {
  const apiKey = (opts.apiKey || process.env.SUBQ_API_KEY || "").trim();
  if (!apiKey) return null;
  const baseURL = (opts.baseUrl || process.env.SUBQ_BASE_URL || DEFAULT_SUBQ_BASE_URL).replace(/\/+$/, "");
  const model = opts.model || process.env.SUBQ_MODEL || DEFAULT_SUBQ_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const response = await fetch(`${baseURL}/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildSubqSystemOneRequestBody(opts.state, opts.questions, model)),
      signal: ctrl.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`${response.status} ${error?.detail?.error_type ?? "SubQError"}: ${error?.detail?.message ?? response.statusText}`);
    }
    const result = await response.json();
    if (!result?.answers) return null;
    const normalized = {};
    for (const [k, v] of Object.entries(result.answers)) {
      if (v && typeof v.noul === "number" && Number.isFinite(v.noul)) {
        normalized[k] = {
          noul: (0, _stats.clamp)(v.noul, 0, 1)
        };
      }
    }
    return normalized;
  } finally {
    clearTimeout(timer);
  }
}
function evaluateSystemOneSupervisorSync(input) {
  const supCfg = input.config.supervisor;
  const globalReject = supCfg.rejectBelowPct ?? 45;
  const globalApprove = supCfg.approveAbovePct ?? 80;
  const idScorePct = (0, _stats.clamp)(input.selfShopInListing ? Math.max(95, input.identityMatchScorePct) : input.identityMatchScorePct, 0, 100);
  const idReject = supCfg.gates.identity_match.rejectBelowPct ?? globalReject;
  const idApprove = supCfg.gates.identity_match.approveAbovePct ?? globalApprove;
  const idVerdict = classifyThreeZoneScore(idScorePct, idReject, idApprove);
  const validCount = input.offers.filter(o => o.included).length;
  const totalCount = Math.max(1, input.offers.length);
  const keepRatio = validCount / totalCount;
  const sellerScore = (0, _stats.clamp)(input.source.totalSellerCount / Math.max(4, input.config.filters.minSellerCount * 2), 0, 1);
  const validCountScore = (0, _stats.clamp)(validCount / Math.max(3, input.config.guards.minValidOffers * 2), 0, 1);
  const dispersionScore = (0, _stats.clamp)(1 - input.dispersion / 0.22, 0, 1);
  const marketScorePct = input.source.ok && validCount > 0 ? Math.round((0, _stats.clamp)((sellerScore * 0.3 + validCountScore * 0.35 + dispersionScore * 0.25 + keepRatio * 0.1) * 100, 0, 100)) : 15;
  const mktReject = supCfg.gates.market_data_integrity.rejectBelowPct ?? globalReject;
  const mktApprove = supCfg.gates.market_data_integrity.approveAbovePct ?? globalApprove;
  const mktVerdict = classifyThreeZoneScore(marketScorePct, mktReject, mktApprove);
  let profitScorePct = 0;
  if (input.finalPrice == null || input.supply.effectiveCostPrice <= 0) {
    profitScorePct = 10;
  } else if (input.finalPrice <= input.supply.effectiveCostPrice) {
    profitScorePct = 0;
  } else if (input.finalPrice < input.supply.hardFloorPrice) {
    profitScorePct = 30;
  } else {
    const localRank = input.position.projectedLocalRank ?? 1;
    const natRank = input.position.projectedNationalRank ?? 1;
    let rankBonus = 25;
    if (localRank === 1 && natRank === 1) rankBonus = 40;else if (localRank === 1 || natRank <= 2) rankBonus = 35;else if (localRank <= 3 || natRank <= 5) rankBonus = 28;else rankBonus = 18;
    const costCertainty = input.supply.usedMarketConsensusFloor ? 48 : 60;
    profitScorePct = (0, _stats.clamp)(costCertainty + rankBonus, 0, 100);
  }
  const prfReject = supCfg.gates.profit_and_rank_safety.rejectBelowPct ?? globalReject;
  const prfApprove = supCfg.gates.profit_and_rank_safety.approveAbovePct ?? globalApprove;
  const prfVerdict = classifyThreeZoneScore(profitScorePct, prfReject, prfApprove);
  let discountScorePct = 85;
  if (!input.finalPrice || !input.basePrice || input.basePrice < input.finalPrice) {
    discountScorePct = 20;
  } else {
    const discPct = input.discountPct ?? 0;
    const exactMatch = Math.round(input.basePrice * (1 - discPct / 100)) === Math.round(input.finalPrice);
    const inAllowedBand = discPct >= input.config.discount.minDiscountPct && discPct <= input.config.discount.maxDiscountPct;
    const hasRealMarketCeiling = (input.floorCeiling.monitoredSellersCount ?? 0) >= 2;
    discountScorePct = (exactMatch ? 45 : 25) + (inAllowedBand ? 35 : 15) + (hasRealMarketCeiling ? 20 : 12);
    discountScorePct = (0, _stats.clamp)(discountScorePct, 0, 100);
  }
  const dscReject = supCfg.gates.ceiling_discount_validity.rejectBelowPct ?? globalReject;
  const dscApprove = supCfg.gates.ceiling_discount_validity.approveAbovePct ?? globalApprove;
  const dscVerdict = classifyThreeZoneScore(discountScorePct, dscReject, dscApprove);
  const gates = {
    identity_match: {
      key: "identity_match",
      title: "گیت ۱: تطابق هویت کالا در ورودی ترب",
      noul: Math.round(idScorePct / 100 * 100) / 100,
      scorePct: idScorePct,
      rejectBelowPct: idReject,
      approveAbovePct: idApprove,
      verdict: idVerdict,
      weight: supCfg.gates.identity_match.weight ?? 0.3,
      reason: idVerdict === "approve" ? `کد مدل و مشخصات فنی تایید شد (${idScorePct}% ≥ ${idApprove}%)` : idVerdict === "review" ? `نیاز به بازبینی تطابق عنوان (${idScorePct}% در بازه ${idReject}%..${idApprove}%)` : `رد ورودی به دلیل عدم تطابق هویت کالا (${idScorePct}% < ${idReject}%)`
    },
    market_data_integrity: {
      key: "market_data_integrity",
      title: "گیت ۲: اعتبار و تازگی قیمت‌های استخراج‌شده بازار",
      noul: Math.round(marketScorePct / 100 * 100) / 100,
      scorePct: marketScorePct,
      rejectBelowPct: mktReject,
      approveAbovePct: mktApprove,
      verdict: mktVerdict,
      weight: supCfg.gates.market_data_integrity.weight ?? 0.25,
      reason: mktVerdict === "approve" ? `پیشنهادهای معتبر و همگرا (${validCount} فروشنده معتبر، امتیاز ${marketScorePct}%)` : mktVerdict === "review" ? `پراکندگی یا کمبود فروشنده معتبر (${marketScorePct}% در بازه ریویو ${mktReject}%..${mktApprove}%)` : `داده بازار ناکافی یا غیرقابل اتکا (${marketScorePct}% < ${mktReject}%)`
    },
    profit_and_rank_safety: {
      key: "profit_and_rank_safety",
      title: "گیت ۳: ایمنی حاشیه سود همکار و رتبه رقابتی مشهد/ترب",
      noul: Math.round(profitScorePct / 100 * 100) / 100,
      scorePct: profitScorePct,
      rejectBelowPct: prfReject,
      approveAbovePct: prfApprove,
      verdict: prfVerdict,
      weight: supCfg.gates.profit_and_rank_safety.weight ?? 0.3,
      reason: prfVerdict === "approve" ? `حاشیه سود بالای خط قرمز و جایگاه رقابتی عالی (${profitScorePct}%)` : prfVerdict === "review" ? `حاشیه سود ایمن ولی نیازمند تایید بازبینی (${profitScorePct}% در بازه ${prfReject}%..${prfApprove}%)` : `خطر نقض کف سود یا عدم وجود قیمت خرید (${profitScorePct}% < ${prfReject}%)`
    },
    ceiling_discount_validity: {
      key: "ceiling_discount_validity",
      title: "گیت ۴: اصالت سقف بازار (بدون پرت) و کالیبراسیون تخفیف روی کف",
      noul: Math.round(discountScorePct / 100 * 100) / 100,
      scorePct: discountScorePct,
      rejectBelowPct: dscReject,
      approveAbovePct: dscApprove,
      verdict: dscVerdict,
      weight: supCfg.gates.ceiling_discount_validity.weight ?? 0.15,
      reason: dscVerdict === "approve" ? `سقف واقعی بازار و کالیبراسیون ۱۰۰٪ دقیق درصد تخفیف روی کف (${discountScorePct}%)` : dscVerdict === "review" ? `سقف یا درصد تخفیف در بازه میانی بازبینی (${discountScorePct}%)` : `سقف یا تخفیف خارج از استاندارد (${discountScorePct}% < ${dscReject}%)`
    }
  };
  const gateList = Object.values(gates);
  const totalWeight = gateList.reduce((s, g) => s + (g.weight || 0.25), 0) || 1;
  const weightedPct = Math.round(gateList.reduce((s, g) => s + g.scorePct * (g.weight || 0.25), 0) / totalWeight);
  const anyRejected = gateList.some(g => g.verdict === "reject");
  const anyReview = gateList.some(g => g.verdict === "review");
  let overallVerdict = classifyThreeZoneScore(weightedPct, globalReject, globalApprove);
  if (anyRejected && supCfg.strictGateVeto !== false) {
    overallVerdict = "reject";
  } else if (anyReview && overallVerdict === "approve" && supCfg.strictGateVeto !== false) {
    overallVerdict = "review";
  }
  const statePayload = [`Product: ${input.productName}`, `TorobListing: ${input.source.productTitle ?? "N/A"} (Sellers: ${input.source.totalSellerCount}, ValidOffers: ${validCount})`, `SupplyCost: ${input.supply.effectiveCostPrice} Toman (HardFloor: ${input.supply.hardFloorPrice} Toman, Source: ${input.supply.costSource})`, `TargetFloorPrice: ${input.finalPrice ?? 0} Toman | CalibratedCeiling: ${input.basePrice ?? 0} Toman | DiscountPct: ${input.discountPct ?? 0}%`, `ProjectedRank: Mashhad #${input.position.projectedLocalRank ?? "-"}, National #${input.position.projectedNationalRank ?? "-"}`].join("\n");
  const questionsPayload = {
    identity_match: {
      type: "noul",
      instructions: "Is the Torob listing the exact same product model as our store product?",
      criteria: {
        true: "Exact model code match, matching technical specs, and valid price ratio",
        false: "Accessory, spare part, multi-pack bundle, or conflicting model number"
      }
    },
    market_data_integrity: {
      type: "noul",
      instructions: "Are the extracted Torob offers fresh, reliable, and sufficient for automated pricing?",
      criteria: {
        true: "Multiple active sellers with fresh prices and low dispersion",
        false: "Stale, out-of-stock, or highly erratic prices"
      }
    },
    profit_and_rank_safety: {
      type: "noul",
      instructions: "Does the final floor price guarantee profit above supplier cost while securing a strong rank?",
      criteria: {
        true: "Strictly above effective supply cost and hard floor with top competitive rank",
        false: "Below or dangerously close to supply cost or uncompetitive"
      }
    },
    ceiling_discount_validity: {
      type: "noul",
      instructions: "Is the market ceiling free of outliers and does the discount percentage land accurately on the floor?",
      criteria: {
        true: "Realistic market ceiling bounded near median and exact integer discount calibration",
        false: "Inflated fake ceiling from outlier seller or broken discount math"
      }
    }
  };
  return {
    enabled: supCfg.enabled !== false,
    provider: "systemone_local_instant",
    model: supCfg.model || DEFAULT_SUBQ_MODEL,
    overallNoul: Math.round(weightedPct / 100 * 100) / 100,
    overallScorePct: weightedPct,
    rejectBelowPct: globalReject,
    approveAbovePct: globalApprove,
    verdict: overallVerdict,
    gates,
    requestPreview: buildSubqSystemOneRequestBody(statePayload, questionsPayload, supCfg.model || DEFAULT_SUBQ_MODEL),
    summary: `ناظر بالاسر SystemOne: امتیاز کل ${weightedPct}% (noul=${(weightedPct / 100).toFixed(2)}) ` + `[زیر ${globalReject}% = رد | ${globalReject}% تا ${globalApprove}% = ریویو | بالای ${globalApprove}% = تایید خودکار] → ` + `حکم نهایی: ${verdictFaLabel[overallVerdict]}`
  };
}
async function enrichSupervisorWithSubqApi(report, supCfg) {
  if (!supCfg.enabled || supCfg.mode === "local_instant_only") return report;
  const apiKey = (supCfg.apiKey || process.env.SUBQ_API_KEY || "").trim();
  if (!apiKey) return report;
  try {
    const apiAnswers = await callSubqSystemOneApi({
      state: report.requestPreview.state,
      questions: report.requestPreview.questions,
      apiKey,
      baseUrl: supCfg.baseUrl || DEFAULT_SUBQ_BASE_URL,
      model: supCfg.model || DEFAULT_SUBQ_MODEL
    });
    if (!apiAnswers) return report;
    const updatedGates = {
      ...report.gates
    };
    for (const [key, gate] of Object.entries(updatedGates)) {
      const ans = apiAnswers[key];
      if (ans && typeof ans.noul === "number") {
        const subqPct = Math.round(ans.noul * 100);
        const blendedPct = key === "profit_and_rank_safety" && gate.scorePct === 0 ? 0 : supCfg.mode === "subq_api_only" ? subqPct : Math.round(gate.scorePct * 0.5 + subqPct * 0.5);
        updatedGates[key] = {
          ...gate,
          noul: Math.round(blendedPct / 100 * 100) / 100,
          scorePct: blendedPct,
          verdict: classifyThreeZoneScore(blendedPct, gate.rejectBelowPct, gate.approveAbovePct)
        };
      }
    }
    const gateList = Object.values(updatedGates);
    const totalWeight = gateList.reduce((s, g) => s + (g.weight || 0.25), 0) || 1;
    const weightedPct = Math.round(gateList.reduce((s, g) => s + g.scorePct * (g.weight || 0.25), 0) / totalWeight);
    const anyRejected = gateList.some(g => g.verdict === "reject");
    const anyReview = gateList.some(g => g.verdict === "review");
    let overallVerdict = classifyThreeZoneScore(weightedPct, report.rejectBelowPct, report.approveAbovePct);
    if (anyRejected && supCfg.strictGateVeto !== false) {
      overallVerdict = "reject";
    } else if (anyReview && overallVerdict === "approve" && supCfg.strictGateVeto !== false) {
      overallVerdict = "review";
    }
    return {
      ...report,
      provider: "subq_systemone_api",
      overallNoul: Math.round(weightedPct / 100 * 100) / 100,
      overallScorePct: weightedPct,
      verdict: overallVerdict,
      gates: updatedGates,
      summary: `ناظر بالاسر SubQ SystemOne (${report.model}): امتیاز کل ${weightedPct}% (noul=${(weightedPct / 100).toFixed(2)}) ` + `[زیر ${report.rejectBelowPct}% = رد | ${report.rejectBelowPct}% تا ${report.approveAbovePct}% = ریویو | بالای ${report.approveAbovePct}% = تایید خودکار] → ` + `حکم نهایی: ${verdictFaLabel[overallVerdict]}`
    };
  } catch {
    return report;
  }
}