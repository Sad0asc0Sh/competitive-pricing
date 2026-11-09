/**
 * موتور تطابق محصول v2 — انتخاب «کارت درست» ترب برای یک محصول فروشگاه و راستی‌آزمایی هویت.
 *
 * تفاوت اصلی با v1: به‌جای جمع امتیاز شباهت واژگان (که مدل‌های هم‌خانواده را هم بالای ۸۰٪ می‌برد)،
 * هویت کالا به‌صورت ساختاریافته استخراج و مقایسه می‌شود (برند، کد مدل، نوع کالا، مشخصات تایپ‌شده، پک/استوک/لوازم جانبی)
 * و «تایید خودکار» فقط با شناسایی مثبت (کد مدل یکسان/هم‌ارز، یا مشخصات کاملِ کالای بی‌کد) صادر می‌شود.
 * جزئیات: src/lib/pricing/match/*.ts  و  docs/MATCHER_V2.md
 */
import { classifyThreeZoneScore } from "./systemone-supervisor";
import type { SystemOneVerdict } from "./types";
import { compareParsed, DEFAULT_MATCH_FLAGS, type MatchFlags } from "./match/compare";
import { parseTitle } from "./match/parse";
import { isInternalOrDatabaseId as isInternalId, normalizeText } from "./match/text";

export interface TorobCandidateCard {
  prk: string;
  titleFa: string;
  titleEn?: string | null;
  priceToman?: number | null;
  sellerCount?: number | null;
  available?: boolean;
  detailsUrl?: string | null;
  shopName?: string | null;
}

export interface ProductMatchTarget {
  productName: string;
  sku?: string | null;
  /** نام برند محصول در فروشگاه (اگر در دسترس باشد؛ عنوان کوتاه فروشگاه اغلب برند ندارد) */
  brand?: string | null;
  anchorPriceToman?: number | null;
  rejectBelowPct?: number;
  approveAbovePct?: number;
}

export interface ScoredCandidateResult {
  candidate: TorobCandidateCard;
  score: number; // 0..100
  noul: number; // 0.00..1.00
  verdict: SystemOneVerdict; // reject | review | approve
  rejected: boolean;
  needsReview: boolean;
  rejectReason?: string;
  matchedModelTokens: string[];
  missingModelTokens: string[];
  notes: string[];
  /** نوع رابطهٔ کد مدل: equal | alias | tail | ext_seg | ext_chars | sibling | unrelated | none */
  codeRelation?: string;
  /** کلید هویت (کارت‌های هم‌هویت مثل تکرارِ لیستینگ یک کلید دارند) */
  identityKey?: string;
  /** دلایلی که تایید خودکار را قفل کرده‌اند */
  blockers?: string[];
}

export interface BestMatchOutcome {
  best: ScoredCandidateResult | null;
  allRanked: ScoredCandidateResult[];
  confident: boolean;
  verdict: SystemOneVerdict;
  explanation: string;
}

/** پرچم‌های ویژگی (برای ablation و خاموش‌کردن اضطراری هر قاعده) */
export const MATCHER_FLAGS: MatchFlags = { ...DEFAULT_MATCH_FLAGS };

export function setMatcherFlags(patch: Partial<MatchFlags>): MatchFlags {
  Object.assign(MATCHER_FLAGS, patch);
  return MATCHER_FLAGS;
}

export function resetMatcherFlags(): MatchFlags {
  Object.assign(MATCHER_FLAGS, DEFAULT_MATCH_FLAGS);
  return MATCHER_FLAGS;
}

/** تشخیص شناسه‌های داخلی دیتابیس/فروشگاه که کد مدل سازنده نیستند (مثل MongoDB ObjectId یا KY-XXXX) */
export function isInternalOrDatabaseId(token: string): boolean {
  return isInternalId(token);
}

/** (سازگاری با نسخهٔ قبل) نرمال‌سازی متن */
export function normalizeProductText(input: string | null | undefined): string {
  return normalizeText(input);
}

/** (سازگاری با نسخهٔ قبل) استخراج توکن‌های مدل/مشخصات از یک متن */
export function extractModelAndSpecTokens(
  text: string,
  sku?: string | null,
): {
  modelTokens: string[];
  numericSpecs: string[];
  words: string[];
  distinctiveWords: string[];
} {
  const p = parseTitle(text, { sku });
  const specs: string[] = [];
  const unit: Record<string, string> = { mp: "mp", ch: "ch", cap: "gb", ports: "port", volt: "v", amp: "a", len: "m" };
  for (const [k, vals] of Object.entries(p.attrs)) {
    if (!unit[k]) continue;
    for (const v of vals) specs.push(k === "cap" && typeof v === "number" && v % 1000 === 0 ? `${v / 1000}tb` : `${v}${unit[k]}`);
  }
  return {
    modelTokens: p.codes.filter((c) => !c.inCompat).map((c) => c.raw),
    numericSpecs: specs,
    words: p.words,
    distinctiveWords: p.words,
  };
}

function priceRatio(target: ProductMatchTarget, candidate: TorobCandidateCard): number | null {
  const a = target.anchorPriceToman;
  const p = candidate.priceToman;
  if (a && a > 0 && p && p > 0) return p / a;
  return null;
}

export function evaluateTorobCandidate(
  target: ProductMatchTarget,
  candidate: TorobCandidateCard,
  minSellerCount = 1,
): ScoredCandidateResult {
  const rejectBelowPct = target.rejectBelowPct ?? 45;
  const approveAbovePct = target.approveAbovePct ?? 80;
  const candText = `${candidate.titleFa ?? ""} ${candidate.titleEn ?? ""}`.trim();

  if (!normalizeText(candText)) {
    return {
      candidate,
      score: 0,
      noul: 0,
      verdict: "reject",
      rejected: true,
      needsReview: false,
      rejectReason: "عنوان کارت در ترب خالی است",
      matchedModelTokens: [],
      missingModelTokens: [],
      notes: [],
    };
  }

  const t = parseTitle(target.productName, { sku: target.sku, brand: target.brand });
  const c = parseTitle(candText);
  const r = compareParsed(t, c, {
    priceRatio: priceRatio(target, candidate),
    rejectBelowPct,
    approveAbovePct,
    flags: MATCHER_FLAGS,
  });

  const notes = [...r.notes];
  if (candidate.available === false) notes.push("کارت در ترب ناموجود است");
  const sellers = candidate.sellerCount ?? 1;
  if (sellers >= Math.max(3, minSellerCount)) notes.push(`لیستینگ ادغام‌شده معتبر (${sellers} فروشنده)`);
  else if (sellers === 1) notes.push("لیستینگ تک‌فروشنده‌ای");

  const rejected = r.verdict === "reject";
  return {
    candidate,
    score: r.score,
    noul: Math.round(r.score) / 100,
    verdict: r.verdict,
    rejected,
    needsReview: r.verdict === "review",
    rejectReason: rejected ? r.rejectReason : undefined,
    matchedModelTokens: r.matchedCodes,
    missingModelTokens: r.missingCodes,
    notes,
    codeRelation: r.codeRel,
    identityKey: r.identityKey,
    blockers: r.blockers,
  };
}

const VERDICT_RANK: Record<SystemOneVerdict, number> = { approve: 2, review: 1, reject: 0 };

export function selectBestTorobSearchMatch(
  target: ProductMatchTarget,
  candidates: TorobCandidateCard[],
  minSellerCount = 1,
): BestMatchOutcome {
  if (!candidates.length) {
    return {
      best: null,
      allRanked: [],
      confident: false,
      verdict: "reject",
      explanation: "هیچ نتیجه‌ای از جستجوی ترب دریافت نشد",
    };
  }

  const rejectBelowPct = target.rejectBelowPct ?? 45;
  const approveAbovePct = target.approveAbovePct ?? 80;
  const reviewCap = Math.max(rejectBelowPct + 5, approveAbovePct - 6);
  let evaluated = candidates.map((c) => evaluateTorobCandidate(target, c, minSellerCount));

  // قاعدهٔ ابهام بین‌کارتی: اگر دو کارت با «هویت متفاوت» هر دو تایید خودکار شدند، هیچ‌کدام خودکار نیست
  const approved = evaluated.filter((x) => x.verdict === "approve");
  const keys = new Set(approved.map((x) => x.identityKey));
  if (approved.length > 1 && keys.size > 1) {
    evaluated = evaluated.map((x) =>
      x.verdict === "approve"
        ? {
            ...x,
            score: Math.min(x.score, reviewCap),
            noul: Math.min(x.score, reviewCap) / 100,
            verdict: classifyThreeZoneScore(Math.min(x.score, reviewCap), rejectBelowPct, approveAbovePct),
            needsReview: true,
            notes: [...x.notes, "⚠ چند کارت با هویت متفاوت هم‌زمان با محصول سایت منطبق‌اند؛ انتخاب با بازبین"],
          }
        : x,
    );
  }

  const allRanked = [...evaluated].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    if (VERDICT_RANK[b.verdict] !== VERDICT_RANK[a.verdict]) return VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
    if (b.score !== a.score) return b.score - a.score;
    const sa = a.candidate.sellerCount ?? 0;
    const sb = b.candidate.sellerCount ?? 0;
    if (sb !== sa) return sb - sa;
    return Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
  });

  // کارت‌های هم‌هویت (تکرار لیستینگ): از میان آنها پرفروشنده‌ترینِ موجود جلو بیاید
  const head = allRanked[0];
  if (head && !head.rejected) {
    const sameId = allRanked.filter((x) => !x.rejected && x.identityKey === head.identityKey && x.verdict === head.verdict);
    if (sameId.length > 1) {
      sameId.sort((a, b) => {
        const av = Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
        if (av) return av;
        return (b.candidate.sellerCount ?? 0) - (a.candidate.sellerCount ?? 0);
      });
      const rest = allRanked.filter((x) => !sameId.includes(x));
      allRanked.splice(0, allRanked.length, ...sameId, ...rest);
    }
  }

  const nonRejected = allRanked.filter((x) => !x.rejected);
  if (!nonRejected.length) {
    const topRejected = allRanked[0];
    return {
      best: null,
      allRanked,
      confident: false,
      verdict: "reject",
      explanation: `رد کامل در گیت ورودی: از بین ${candidates.length} نتیجه جستجوی ترب، همه زیر خط قرمز تطابق (${rejectBelowPct}%) بودند (${topRejected?.rejectReason ?? "نامشخص"})`,
    };
  }

  const best = nonRejected[0];
  return {
    best,
    allRanked,
    confident: best.verdict === "approve",
    verdict: best.verdict,
    explanation:
      best.verdict === "approve"
        ? `تایید خودکار ورودی (${best.score}% ≥ ${approveAbovePct}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد و ${candidates.length - nonRejected.length} نتیجه نامرتبط رد گردید`
        : `ورود مشروط به بخش ریویو (${best.score}% در بازه ${rejectBelowPct}%..${approveAbovePct}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد ولی نیازمند تایید بازبینی است${best.blockers?.length ? ` — ${best.blockers[0]}` : ""}`,
  };
}
