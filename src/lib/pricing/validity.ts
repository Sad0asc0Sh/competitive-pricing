import { computeModalConsensusPrice } from "./aggregate";
import { median } from "./stats";
import type { OfferClass, OfferEvaluation } from "./types";

/**
 * مدل احتمالیِ «اعتبار پیشنهاد» (Validity v2)
 *
 * مسئله: در لیستینگ ترب، «ارزان‌ترین پیشنهاد» اغلب قابل‌خرید نیست (طعمهٔ قیمتی، قیمت کهنهٔ جاماندهٔ بازار، لیستینگ شبح،
 * نسخهٔ دیگرِ کالا). قانون‌های سخت (مثلاً «هر قیمت بالای ۷ روز حذف شود») در بازار آرام فروشندهٔ واقعی را دور می‌ریزند و
 * در بازار پرنوسان کافی نیستند. این ماژول به‌جای حذف/پذیرش دوتایی، برای هر پیشنهاد احتمال «قابل‌خرید بودن» می‌سازد:
 *
 *   s_i = P(نه کهنه/شبح | سن، نوسان بازار) × P(واقعی | عمق زیرِ بدنهٔ بازار، شهرت فروشنده، تأییدیهٔ هم‌قیمت‌ها)
 *
 *  ۱) سن و رانش: نوسان روزانهٔ بازار از خودِ مقطع‌داده (رگرسیون ریج: قیمت‌ِ ثبت‌شده ‌در برابر سن) تخمین زده می‌شود. فقط وقتی
 *     بازار رو به بالاست، قیمت کهنهٔ پایین خطرناک است (فاصلهٔ جبران‌نشده = رانش × سن).
 *  ۲) عمق: قیمت‌های «ناهنجارِ پایین» با مدل آمیختهٔ نرمال(بدنه) + آلودگی(پهن) سنجیده می‌شوند؛ هرچه عمیق‌تر نسبت به پراکندگی
 *     بازار، احتمال «طعمه/نسخهٔ دیگر» بیشتر. نسبت واقعی‌ها در ناهنجارها (legitFractionPrior) پارامتر قابل‌کالیبراسیون است.
 *  ۳) شهرت: امتیاز/تعداد رأی/ضمانت ترب، ادعای «واقعی بودن» را تعدیل می‌کند.
 *  ۴) تأییدیه: وقتی فروشندهٔ مستقل دیگری روی همان قیمت پایین نشسته، آن قیمت اطلاعات واقعی بازار است نه طعمه.
 *  ۵) تصمیم: لنگر (کف بازار) نخستین سطح قیمتی است که احتمال تجمعیِ «حداقل یک پیشنهاد معتبر در آن یا زیر آن» از آستانه
 *     (پیش‌فرض ۰٫۵ ⇒ کمینهٔ خطای قرینه) فراتر برود؛ آستانه با نسبت هزینهٔ «غیررقابتی بودن» به «بخشیدن سود» تنظیم می‌شود.
 *
 * ضرایب پیش‌فرض «باورهای پیشین» هستند، نه مقادیر برازش‌شده با دادهٔ واقعی (قابل‌توضیح و در پروفایل با
 * estimator.validity قابل بازتنظیم). سنجش کالیبراسیون: eval/market/validity-eval.cjs ؛ تحلیل حساسیت (اگر باورها غلط باشند):
 * eval/market/sensitivity.cjs ؛ سنجش سرتاسری قبل/بعد: eval/market/final.cjs. نتایج شبیه‌ساز جایگزین دادهٔ واقعی نیست
 * (برای بازتنظیم با برچسب واقعی: docs/EVALUATION.md → «حالت سایه و بازتنظیم»).
 */

export interface ValidityParams {
  // --- بدنه و پراکندگی
  bodyModalRadiusPct: number;
  sigmaPrior: number;
  sigmaPriorWeight: number;
  sigmaMin: number;
  sigmaMax: number;
  // --- آمیختهٔ «بدنه + آلودگی» برای ناهنجارهای پایین
  contaminationRate: number;
  contaminationDepthMin: number;
  contaminationDepthMax: number;
  legitFractionPrior: number;
  /** از این عمق (لگاریتمی) به بعد، احتمال «واقعی بودن» ناهنجار با شیب legitDepthSlope کم می‌شود */
  legitDepthStart: number;
  legitDepthSlope: number;
  // --- شهرت (لوجیت)
  scoreRef: number;
  scoreCoef: number;
  scoreMin: number;
  scoreMax: number;
  nullScorePenalty: number;
  votesCoef: number;
  guaranteeBonus: number;
  inPersonPenalty: number;
  // --- سن / رانش
  baseLogit: number;
  /** اثر شهرت بر احتمال «honored» برای قیمت‌های عادی (ملایم) */
  repHonorCoef: number;
  ageCoef: number;
  ageScaleDays: number;
  unknownAgePenalty: number;
  driftPriorSd: number;
  driftGapCoef: number;
  driftMaxAgeDays: number;
  // --- تأییدیه
  corrBandMinPct: number;
  corrKappa: number;
  // --- تصمیم
  anchorCumProb: number;
  minIncludeProb: number;
}

export const DEFAULT_VALIDITY_PARAMS: ValidityParams = {
  bodyModalRadiusPct: 3,
  sigmaPrior: 0.025,
  sigmaPriorWeight: 4,
  sigmaMin: 0.008,
  sigmaMax: 0.08,

  contaminationRate: 0.04,
  contaminationDepthMin: 0.04,
  contaminationDepthMax: 0.5,
  legitFractionPrior: 0.45,
  legitDepthStart: 0.12,
  legitDepthSlope: 6,

  scoreRef: 4.0,
  scoreCoef: 0.9,
  scoreMin: -1.8,
  scoreMax: 0.9,
  nullScorePenalty: 0.5,
  votesCoef: 0.3,
  guaranteeBonus: 0.35,
  inPersonPenalty: 0.4,

  baseLogit: 2.6,
  repHonorCoef: 0.3,
  ageCoef: 0.35,
  ageScaleDays: 1,
  unknownAgePenalty: 0.9,
  driftPriorSd: 0.005,
  driftGapCoef: 18,
  driftMaxAgeDays: 45,

  corrBandMinPct: 1.2,
  corrKappa: 2.2,

  anchorCumProb: 0.5,
  minIncludeProb: 0.15,
};

export interface OfferValidity {
  /** احتمال قابل‌خرید بودن با همان قیمت (پس از تأییدیه) */
  p: number;
  /** احتمال «نه کهنه/شبح» (مؤلفهٔ سن و رانش) */
  pFresh: number;
  /** احتمال «واقعی» با توجه به عمق و شهرت */
  pReal: number;
  /** احتمال ناهنجار-پایین (پیش از تأییدیه) */
  pAnomaly: number;
  ageDays: number | null;
  /** عمق نسبی زیر بدنه (مثبت = ارزان‌تر از بدنه) */
  depth: number;
  /** جرم احتمالیِ هم‌قیمت‌های مستقل */
  corroboration: number;
}

export interface ValidityReport {
  ref: number | null;
  sigma: number;
  /** رانش تخمینی روزانه (مثبت = بازار رو به بالا؛ قیمت‌های کهنه ارزان‌تر از امروز) */
  driftPerDay: number;
  driftSe: number;
  anchorPrice: number | null;
  anchorIndex: number;
  /** توزیع «ارزان‌ترین پیشنهاد معتبر»: [{price, p}] (به ترتیب قیمت) + احتمال هیچ‌کدام */
  lowestDist: { price: number; p: number }[];
  pNoneValid: number;
  /** احتمال اینکه ارزان‌ترین پیشنهاد معتبر در ±ε قیمت لنگر باشد */
  pAnchorOk: number;
  excludedLows: { price: number; shopName: string; p: number; cls: OfferClass }[];
  perOffer: Map<OfferEvaluation, OfferValidity>;
  /** پیشنهادهای ارزیابی‌شده به ترتیب قیمت (هم‌ترتیب با lowestDist) */
  sortedOffers: OfferEvaluation[];
  /** پیشنهادهایی که همین مدل کنار گذاشت (زیر لنگر یا احتمال بسیار پایین) */
  excludedOffers: OfferEvaluation[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));

function robustSigma(depths: number[], P: ValidityParams): number {
  // MAD روی عمق‌های نزدیک بدنه (±۱۲٪) تا آلودگی پراکندگی را باد نکند
  const near = depths.filter((d) => Math.abs(d) <= 0.12);
  if (near.length < 3) return clamp(P.sigmaPrior, P.sigmaMin, P.sigmaMax);
  const m = median(near);
  const mad = median(near.map((d) => Math.abs(d - m))) * 1.4826;
  const n = near.length;
  const blended = Math.sqrt((n * mad * mad + P.sigmaPriorWeight * P.sigmaPrior * P.sigmaPrior) / (n + P.sigmaPriorWeight));
  return clamp(blended, P.sigmaMin, P.sigmaMax);
}

/** تخمین رانش روزانهٔ بازار از مقطع‌داده (قیمت ثبت‌شده در برابر سن) — رگرسیون ریج با پیشین N(0, driftPriorSd²) */
function estimateDrift(
  rows: { age: number; depth: number; w: number }[],
  sigma: number,
  P: ValidityParams,
): { drift: number; se: number } {
  const use = rows.filter((r) => r.age <= P.driftMaxAgeDays && Math.abs(r.depth) <= 3 * sigma + 0.03);
  if (use.length < 3) return { drift: 0, se: P.driftPriorSd };
  const sw = use.reduce((s, r) => s + r.w, 0);
  const ma = use.reduce((s, r) => s + r.w * r.age, 0) / sw;
  const md = use.reduce((s, r) => s + r.w * r.depth, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (const r of use) {
    sxx += r.w * (r.age - ma) ** 2;
    sxy += r.w * (r.age - ma) * (r.depth - md);
  }
  // وزن‌ها نرمال‌شده به میانگین ۱ تا ریج مقیاس‌پذیر بماند
  const wMean = sw / use.length;
  sxx /= wMean;
  sxy /= wMean;
  const lambda = (sigma * sigma) / (P.driftPriorSd * P.driftPriorSd);
  const slope = sxy / (sxx + lambda); // d = slope × age  (رشد بازار ⇒ قیمت کهنه پایین‌تر ⇒ slope منفی)
  const se = sigma / Math.sqrt(sxx + lambda);
  return { drift: -slope, se };
}

function reputationLogit(o: OfferEvaluation, P: ValidityParams): number {
  let x = 0;
  if (o.shopScore == null) {
    x -= P.nullScorePenalty;
  } else {
    x += clamp(P.scoreCoef * (o.shopScore - P.scoreRef), P.scoreMin, P.scoreMax);
  }
  const votes = Math.max(0, o.shopVotes ?? 0);
  x += P.votesCoef * (Math.log1p(votes / 10) - Math.log1p(3)); // ۳۰ رأی ≈ مرجع
  if (typeof o.guarantee === "string" && o.guarantee.toLowerCase() === "enabled") x += P.guaranteeBonus;
  if (o.sellerType === "in_person") x -= P.inPersonPenalty;
  return x;
}

/**
 * ارزیابی احتمالیِ اعتبار همهٔ پیشنهادهای `included` و انتخاب لنگر.
 * خروجی روی همان آرایه علامت می‌گذارد (included/cls/fresh/credible/weight) تا بقیهٔ خط لوله بی‌تغییر کار کند.
 */
export function assessValidity(
  offers: OfferEvaluation[],
  now: Date,
  opts: {
    params?: Partial<ValidityParams>;
    freshCutoffDays: number;
    highTrustScoreThreshold: number;
    /** هزینهٔ نسبی «غیررقابتی ماندن» به «بخشیدن سود» (۱ = قرینه). آستانهٔ تجمعی = 1/(1+ratio) */
    competitivenessCostRatio?: number;
    undercutFor?: (price: number) => number;
  },
): ValidityReport {
  const P: ValidityParams = { ...DEFAULT_VALIDITY_PARAMS, ...(opts.params ?? {}) };
  const live = offers.filter((o) => o.included);
  const perOffer = new Map<OfferEvaluation, OfferValidity>();

  const ageOf = (o: OfferEvaluation): number | null =>
    o.lastChangedAt instanceof Date && !Number.isNaN(o.lastChangedAt.getTime())
      ? Math.max(0, (now.getTime() - o.lastChangedAt.getTime()) / 86_400_000)
      : null;

  const empty: ValidityReport = {
    ref: null,
    sigma: P.sigmaPrior,
    driftPerDay: 0,
    driftSe: P.driftPriorSd,
    anchorPrice: null,
    anchorIndex: -1,
    lowestDist: [],
    pNoneValid: 1,
    pAnchorOk: 0,
    excludedLows: [],
    perOffer,
    sortedOffers: [],
    excludedOffers: [],
  };
  if (!live.length) return empty;

  // ---- بدنه و پراکندگی
  const tmpWeight = (o: OfferEvaluation) => {
    const a = ageOf(o) ?? 3;
    return Math.max(0.1, Math.pow(0.5, a / 3)) * (o.shopScore != null && o.shopScore >= 4.5 ? 1.15 : 1);
  };
  const forBody = live.map((o) => ({ ...o, weight: tmpWeight(o) })) as OfferEvaluation[];
  const ref = live.length === 1 ? live[0].price : computeModalConsensusPrice(forBody, P.bodyModalRadiusPct);
  if (ref == null || !(ref > 0)) return empty;
  const depths = live.map((o) => Math.log(ref / o.price)); // مثبت = زیر بدنه
  const sigma = live.length >= 3 ? robustSigma(depths, P) : clamp(P.sigmaPrior, P.sigmaMin, P.sigmaMax);

  // ---- رانش
  const driftRows = live
    .map((o, i) => ({ age: ageOf(o), depth: -depths[i], w: tmpWeight(o) }))
    .filter((r): r is { age: number; depth: number; w: number } => r.age != null);
  const { drift, se } = estimateDrift(driftRows, sigma, P);
  const driftUp = Math.max(0, drift);

  // ---- مرحلهٔ ۱: احتمال ذاتی (در فضای لوجیت تا سرریز/NaN رخ ندهد)
  const logLc = Math.log(1 / Math.max(1e-6, P.contaminationDepthMax - P.contaminationDepthMin)); // چگالی یکنواخت آلودگی
  const realPrior = logit(P.legitFractionPrior);
  const stage1 = live.map((o, i) => {
    const age = ageOf(o);
    const depth = depths[i];
    const rep = reputationLogit(o, P);
    // ناهنجاری پایین: آمیختهٔ نرمال(σ) و آلودگیِ یکنواخت — لوجیتِ «آلوده بودن»
    let laAnom = -Infinity;
    if (depth > 0) {
      const logNormal = -0.5 * (depth / sigma) ** 2 - Math.log(sigma * Math.sqrt(2 * Math.PI));
      const inBand = depth >= P.contaminationDepthMin && depth <= P.contaminationDepthMax;
      const logCont = inBand ? logLc : logLc - 3; // زیر ۴٪ چگالی آلودگی کوچک است ولی صفر نیست
      laAnom = Math.log(P.contaminationRate) + logCont - (Math.log(1 - P.contaminationRate) + logNormal);
    }
    // «واقعی بودن» یک ناهنجار: پیشین نوعی − شیب عمق (تخفیف‌های بسیار عمیق تقریباً هیچ‌وقت واقعی نیستند) + شهرت
    const realLogit = realPrior + rep - P.legitDepthSlope * Math.max(0, depth - P.legitDepthStart);
    return { o, i, age, depth, rep, laAnom, realLogit };
  });

  // سناریوهای رانش (گاوس–هرمیت ۳نقطه‌ای): عدم‌قطعیتِ مشترکِ رانش، اعتبار فروشندگان کهنه را همبسته می‌کند
  const SQ3 = Math.sqrt(3);
  const scenarios = [
    { w: 1 / 6, drift: drift - SQ3 * se },
    { w: 2 / 3, drift },
    { w: 1 / 6, drift: drift + SQ3 * se },
  ];
  const pFreshOf = (r: (typeof stage1)[number], dr: number) => {
    let lg = P.baseLogit + P.repHonorCoef * r.rep;
    if (r.age == null) lg -= P.unknownAgePenalty;
    else lg -= P.ageCoef * Math.log1p(r.age / Math.max(0.1, P.ageScaleDays)) + P.driftGapCoef * Math.max(0, dr) * r.age;
    return sigmoid(lg);
  };
  const pFreshMean = stage1.map((r) => scenarios.reduce((acc, sc) => acc + sc.w * pFreshOf(r, sc.drift), 0));
  const pRealOf = (r: (typeof stage1)[number], laAnom: number) => {
    const pAn = laAnom === -Infinity ? 0 : sigmoid(laAnom);
    return { pAn, pReal: 1 - pAn + pAn * sigmoid(r.realLogit) };
  };
  const p1 = stage1.map((r, idx) => clamp(pFreshMean[idx] * pRealOf(r, r.laAnom).pReal, 0.001, 0.999));

  // ---- مرحلهٔ ۲: تأییدیهٔ هم‌قیمت‌های مستقل (کاهش شانسِ ناهنجاری)
  const band = Math.max(P.corrBandMinPct / 100, 0.6 * sigma);
  const pByScenario: number[][] = scenarios.map(() => new Array(stage1.length).fill(0));
  stage1.forEach((r, idx) => {
    let corr = 0;
    stage1.forEach((q, j) => {
      if (j !== idx && Math.abs(Math.log(q.o.price / r.o.price)) <= band) corr += p1[j];
    });
    const laAnom = r.laAnom === -Infinity ? -Infinity : r.laAnom - P.corrKappa * Math.min(corr, 2);
    const { pAn, pReal } = pRealOf(r, laAnom);
    let pMean = 0;
    scenarios.forEach((sc, m) => {
      const pm = clamp(pFreshOf(r, sc.drift) * pReal, 0.001, 0.999);
      pByScenario[m][idx] = pm;
      pMean += sc.w * pm;
    });
    perOffer.set(r.o, {
      p: clamp(pMean, 0.001, 0.999),
      pFresh: pFreshMean[idx],
      pReal,
      pAnomaly: pAn,
      ageDays: r.age,
      depth: r.depth,
      corroboration: corr,
    });
  });

  // ---- توزیع «ارزان‌ترین پیشنهاد معتبر» (میانگین روی سناریوهای رانش)
  const order = stage1.map((_, idx) => idx).sort((a, b) => stage1[a].o.price - stage1[b].o.price);
  const sorted = order.map((idx) => stage1[idx].o);
  const dist: { price: number; p: number }[] = sorted.map((o) => ({ price: o.price, p: 0 }));
  const cumByK: number[] = new Array(sorted.length).fill(0);
  scenarios.forEach((sc, m) => {
    let surv = 1;
    order.forEach((idx, k) => {
      const pk = pByScenario[m][idx];
      dist[k].p += sc.w * surv * pk;
      surv *= 1 - pk;
      cumByK[k] += sc.w * (1 - surv);
    });
  });
  const pNone = Math.max(0, 1 - dist.reduce((acc, d) => acc + d.p, 0));

  // ---- لنگر: نخستین سطحی که احتمال تجمعیِ وجود پیشنهاد معتبر ≥ آستانه شود
  const ratio = Math.max(0.05, opts.competitivenessCostRatio ?? 1);
  const tau = clamp(1 / (1 + ratio), 0.2, 0.8) * (P.anchorCumProb / 0.5); // با ratio=1 ⇒ anchorCumProb
  let anchorIdx = -1;
  for (let k = 0; k < sorted.length; k++) {
    if (cumByK[k] >= tau) {
      anchorIdx = k;
      break;
    }
  }

  // ---- علامت‌گذاری
  const excludedLows: ValidityReport["excludedLows"] = [];
  const excludedOffers: OfferEvaluation[] = [];
  const mark = (o: OfferEvaluation, cls: OfferClass, reason: string) => {
    excludedOffers.push(o);
    o.included = false;
    o.weight = 0;
    o.cls = cls;
    o.excludeReason = reason;
  };
  for (const o of live) {
    const v = perOffer.get(o)!;
    o.fresh = v.ageDays != null && v.ageDays <= Math.max(0, opts.freshCutoffDays);
    o.credible = o.shopScore != null && o.shopScore >= opts.highTrustScoreThreshold;
    o.highTrust = o.credible;
  }

  const anchorPrice = anchorIdx >= 0 ? sorted[anchorIdx].price : null;
  if (anchorIdx < 0) {
    // هیچ شواهد کافی برای هیچ سطحی وجود ندارد ⇒ همه کنار؛ موتور مسیر no_data/review را می‌رود
    for (const o of sorted) {
      const v = perOffer.get(o)!;
      const cls: OfferClass = v.ageDays != null && v.ageDays > 5 ? "stale_low" : "suspect_low";
      mark(o, cls, `احتمال اعتبار پایین (${(v.p * 100).toFixed(0)}٪) — شواهد کافی برای تکیه بر این قیمت نیست`);
      excludedLows.push({ price: o.price, shopName: o.shopName, p: v.p, cls });
    }
  } else {
    for (let k = 0; k < sorted.length; k++) {
      const o = sorted[k];
      const v = perOffer.get(o)!;
      if (k < anchorIdx) {
        const cls: OfferClass = v.pFresh < 0.5 || (v.ageDays != null && v.ageDays > opts.freshCutoffDays) ? "stale_low" : "suspect_low";
        const why = v.pFresh < 0.5 ? "قیمت کهنه نسبت به نوسان بازار" : "ناهنجاری قیمتی پایین بدون شواهد کافی";
        mark(o, cls, `${why} (احتمال اعتبار ${(v.p * 100).toFixed(0)}٪)`);
        excludedLows.push({ price: o.price, shopName: o.shopName, p: v.p, cls });
        continue;
      }
      if (v.p < P.minIncludeProb) {
        const cls: OfferClass = v.pFresh < 0.5 ? "stale_low" : "suspect_low";
        mark(o, cls, `احتمال اعتبار بسیار پایین (${(v.p * 100).toFixed(0)}٪)`);
        excludedLows.push({ price: o.price, shopName: o.shopName, p: v.p, cls });
        continue;
      }
      o.cls = "ok";
    }
  }

  // ---- ظن بازار: احتمال اینکه ارزان‌ترین معتبر در ±۱٪ لنگر باشد
  const eps = 0.012;
  const pAnchorOk =
    anchorPrice == null
      ? 0
      : dist.filter((d) => Math.abs(d.price / anchorPrice - 1) <= eps).reduce((s, d) => s + d.p, 0);

  return {
    ref,
    sigma,
    driftPerDay: drift,
    driftSe: se,
    anchorPrice,
    anchorIndex: anchorIdx,
    lowestDist: dist,
    pNoneValid: pNone,
    pAnchorOk,
    excludedLows,
    perOffer,
    sortedOffers: sorted,
    excludedOffers,
  };
}
