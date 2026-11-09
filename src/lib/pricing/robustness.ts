import type { OfferEvaluation } from "./types";
import type { ValidityReport } from "./validity";

/**
 * تحلیل پایداریِ تصمیم نسبت به عدم‌قطعیتِ «کدام پیشنهاد واقعاً قابل‌خرید است؟» (Decision-robustness)
 *
 * ایده: مدل اعتبار (validity.ts) توزیع پسینِ «ارزان‌ترین پیشنهاد معتبر» را می‌دهد. برای هر فرضِ محتمل
 * (مثلاً «همان لنگر درست است»، «لنگر کهنه است و پیشنهاد بعدی ارزان‌ترین معتبر است»، …) کل خط‌لولهٔ تصمیم
 * (تجمیع بازار ← استراتژی ← محافظ‌ها) را دوباره اجرا می‌کنیم. بنابراین:
 *   - هر سیاستی (شهر، خوشه، کف سود، سقف تغییر، گرد کردن) خودکار لحاظ می‌شود؛ تقریبِ جداگانهٔ «ارزان‌ترین − پله» لازم نیست.
 *   - احتمالِ «قیمت نهایی ما همان قیمتِ فرضِ درست است (±tol)» = جمع احتمال فرض‌هایی که قیمتشان با قیمت ما می‌خواند.
 *   - اگر فرض‌ها قیمت‌های متفاوتی بدهند، محتمل‌ترین قیمتِ جایگزین برای نمایش در صف بازبینی برگردانده می‌شود.
 *
 * این ماژول تابعِ تصمیم را از بیرون می‌گیرد (decide) تا به موتور وابسته نباشد و واحد‌آزمون‌پذیر بماند.
 */

export interface DecisionScenario {
  /** ارزان‌ترین پیشنهادِ معتبر در این فرض */
  lowestPrice: number;
  shopName: string;
  /** احتمال پسین این فرض */
  p: number;
  /** قیمت نهایی موتور اگر این فرض درست باشد (null = موتور قیمتی نمی‌دهد) */
  finalPrice: number | null;
  strategy: string;
}

export interface ScenarioAnalysis {
  scenarios: DecisionScenario[];
  /** جرم احتمالیِ فرض‌های ارزیابی‌شده (۰..۱) */
  coveredMass: number;
  pNoneValid: number;
  /** P(قیمت نهایی ما با قیمتِ فرضِ درست در ±tol بخواند) — جرم ارزیابی‌نشده «نادرست» حساب می‌شود (محافظه‌کارانه) */
  pRight: number;
  /** P(ما بیش از tol گران‌تر از قیمتِ فرضِ درست) */
  pTooHigh: number;
  /** P(ما بیش از tol ارزان‌تر از قیمتِ فرضِ درست) */
  pTooLow: number;
  /** محتمل‌ترین قیمتِ جایگزین (فرض ناهمخوان با بیشترین احتمال) */
  alternative: { finalPrice: number; p: number; lowestPrice: number; shopName: string } | null;
}

export interface ScenarioOptions {
  /** تلورانس نسبی (درصد) برای «همان قیمت» */
  tolerancePct: number;
  /** حداکثر تعداد فرض‌هایی که اجرا می‌شود */
  maxScenarios: number;
  /** فرض‌هایی با احتمال کمتر از این نادیده گرفته می‌شوند */
  minScenarioP: number;
  /** پیشنهادهای بالاتر از فرض با احتمال کمتر از این در آن فرض وارد بازار نمی‌شوند (هم‌راستا با مدل اعتبار) */
  minIncludeProb: number;
}

export const DEFAULT_SCENARIO_OPTIONS: ScenarioOptions = {
  tolerancePct: 2,
  maxScenarios: 6,
  minScenarioP: 0.03,
  minIncludeProb: 0.15,
};

/**
 * @param report   خروجی assessValidity
 * @param finalPrice قیمت نهایی تصمیم اصلی (پس از محافظ‌ها)
 * @param eligible آیا پیشنهاد می‌تواند در هر فرضی وارد بازار شود؟ (مثلاً پرتِ سمت بالا هیچ‌وقت وارد نمی‌شود)
 * @param decide   اجرای خط‌لولهٔ تصمیم روی مجموعهٔ پیشنهادهای وارد‌شده؛ قیمت نهایی را برمی‌گرداند
 */
export function analyzeDecisionScenarios(
  report: ValidityReport,
  finalPrice: number,
  eligible: (o: OfferEvaluation) => boolean,
  decide: (included: Set<OfferEvaluation>) => { finalPrice: number | null; strategy: string },
  options?: Partial<ScenarioOptions>,
): ScenarioAnalysis {
  const opt: ScenarioOptions = { ...DEFAULT_SCENARIO_OPTIONS, ...(options ?? {}) };
  const tol = Math.max(0, opt.tolerancePct) / 100;
  const sorted = report.sortedOffers;

  const picks = report.lowestDist
    .map((d, k) => ({ k, p: d.p }))
    .filter((x) => x.p >= opt.minScenarioP)
    .sort((a, b) => b.p - a.p)
    .slice(0, Math.max(1, opt.maxScenarios))
    .sort((a, b) => a.k - b.k);

  const scenarios: DecisionScenario[] = [];
  for (const { k, p } of picks) {
    const included = new Set<OfferEvaluation>();
    for (let j = k; j < sorted.length; j++) {
      const o = sorted[j];
      if (!eligible(o)) continue;
      const pj = report.perOffer.get(o)?.p ?? 0;
      if (j === k || pj >= opt.minIncludeProb) included.add(o);
    }
    const out = decide(included);
    scenarios.push({
      lowestPrice: sorted[k].price,
      shopName: sorted[k].shopName,
      p,
      finalPrice: out.finalPrice,
      strategy: out.strategy,
    });
  }

  let pRight = 0;
  let pTooHigh = 0;
  let pTooLow = 0;
  let covered = 0;
  let alternative: ScenarioAnalysis["alternative"] = null;
  for (const s of scenarios) {
    covered += s.p;
    if (s.finalPrice == null || !(s.finalPrice > 0)) continue;
    const rel = (finalPrice - s.finalPrice) / s.finalPrice;
    if (Math.abs(rel) <= tol) {
      pRight += s.p;
    } else {
      if (rel > 0) pTooHigh += s.p;
      else pTooLow += s.p;
      if (!alternative || s.p > alternative.p) {
        alternative = { finalPrice: s.finalPrice, p: s.p, lowestPrice: s.lowestPrice, shopName: s.shopName };
      }
    }
  }

  return {
    scenarios,
    coveredMass: Math.min(1, covered),
    pNoneValid: report.pNoneValid,
    pRight: Math.min(1, pRight),
    pTooHigh: Math.min(1, pTooHigh),
    pTooLow: Math.min(1, pTooLow),
    alternative,
  };
}

/** مدل اعتمادِ کالیبره: لوجیستیکِ ساده روی ویژگی‌های قابل‌توضیح؛ ضرایب با scripts/fit-confidence (eval/market/fit-confidence.cjs) برآورد می‌شوند */
export interface ConfidenceModel {
  intercept: number;
  /** ضریب logit(pRight) */
  wLogitRight: number;
  /** ضریب امتیاز ساده‌شدهٔ قدیمی (۰..۱) که کفایت دادهٔ ورودی را می‌سنجد */
  wHeuristic: number;
  /** ضریب احتمال «هیچ پیشنهاد معتبری نیست» */
  wNoneValid: number;
  /** ضریب شاخص «قیمت روی کف سود ایستاده» (۰/۱) */
  wFloorBound: number;
}

export const DEFAULT_CONFIDENCE_MODEL: ConfidenceModel = {
  intercept: 0,
  wLogitRight: 1,
  wHeuristic: 0,
  wNoneValid: 0,
  wFloorBound: 0,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function calibratedConfidence(
  m: Partial<ConfidenceModel> | undefined,
  f: { pRight: number; heuristic: number; pNoneValid: number; floorBound: boolean },
): number {
  const w: ConfidenceModel = { ...DEFAULT_CONFIDENCE_MODEL, ...(m ?? {}) };
  const pr = clamp(f.pRight, 0.01, 0.99);
  const z =
    w.intercept +
    w.wLogitRight * Math.log(pr / (1 - pr)) +
    w.wHeuristic * clamp(f.heuristic, 0, 1) +
    w.wNoneValid * clamp(f.pNoneValid, 0, 1) +
    w.wFloorBound * (f.floorBound ? 1 : 0);
  const c = sigmoid(z);
  return Number.isFinite(c) ? Math.round(c * 1000) / 1000 : 0;
}
