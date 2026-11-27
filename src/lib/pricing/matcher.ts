/**
 * موتور تطابق محصول v2 — انتخاب «کارت درست» ترب برای یک محصول فروشگاه و راستی‌آزمایی هویت.
 *
 * تفاوت اصلی با v1: به‌جای جمع امتیاز شباهت واژگان (که مدل‌های هم‌خانواده را هم بالای ۸۰٪ می‌برد)،
 * هویت کالا به‌صورت ساختاریافته استخراج و مقایسه می‌شود (برند، کد مدل، نوع کالا، مشخصات تایپ‌شده، پک/استوک/لوازم جانبی)
 * و «تایید خودکار» فقط با شناسایی مثبت (کد مدل یکسان/هم‌ارز، یا مشخصات کاملِ کالای بی‌کد) صادر می‌شود.
 * جزئیات: src/lib/pricing/match/*.ts  و  docs/MATCHER_V2.md
 */
import type { SystemOneVerdict, TorobIdentityStatus, TorobTitleState } from "./types";
import { compareParsed, DEFAULT_MATCH_FLAGS, relateCodes, type MatchFlags } from "./match/compare";
import { parseIdentityTitle, parseTitle, type IdentitySpec, type ParsedTitle } from "./match/parse";
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
  titleEvidence?: { fields: string[]; parsed: boolean };
  specs?: IdentitySpec[];
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
  status: TorobIdentityStatus;
  titleState: TorobTitleState;
  parsed?: ParsedTitle;
  scoreComponents?: Record<string, number>;
  rawScore?: number;
  hasConflict?: boolean;
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
  const unit: Record<string, string> = {
    mp: "mp",
    ch: "ch",
    cap: "gb",
    ram: "gb",
    ports: "port",
    volt: "v",
    amp: "a",
    watt: "w",
    va: "va",
    ah: "ah",
    uf: "uf",
    kvar: "kvar",
    ka: "ka",
    poles: "p",
    len: "m",
    cm: "cm",
    mm2: "mm2",
  };
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
  _minSellerCount = 1,
): ScoredCandidateResult {
  const rejectBelowPct = target.rejectBelowPct ?? 45;
  const approveAbovePct = target.approveAbovePct ?? 80;
  const candText = `${candidate.titleFa ?? ""} ${candidate.titleEn ?? ""}`.trim();

  if (!normalizeText(candText)) {
    const titleState = candidate.titleEvidence?.parsed ? "mapping_missing"
      : candidate.titleEvidence?.fields.length ? "parser_missing" : "source_missing";
    return {
      candidate,
      score: 0,
      noul: 0,
      verdict: "review",
      status: "EXTRACTION_INCOMPLETE",
      titleState,
      rejected: false,
      needsReview: true,
      matchedModelTokens: [],
      missingModelTokens: [],
      notes: ["عنوان قابل استفاده برای سنجش هویت کارت دریافت نشد"],
    };
  }

  const t = parseTitle(target.productName, { sku: target.sku, brand: target.brand });
  let c = parseIdentityTitle(candText, candidate.specs);
  if (normalizeText(candidate.titleFa) && normalizeText(candidate.titleEn)) {
    const fa = parseTitle(candidate.titleFa);
    const en = parseTitle(candidate.titleEn);
    const faCodes = fa.codes.filter((code) => !code.inCompat);
    const enCodes = en.codes.filter((code) => !code.inCompat);
    const conflict = faCodes.length && enCodes.length &&
      !faCodes.some((a) => enCodes.some((b) => ["equal", "alias", "tail"].includes(relateCodes(a, b))));
    if (conflict) {
      c = { ...c, evidenceConflicts: [...(c.evidenceConflicts ?? []), "عنوان فارسی و لاتین کارت کد مدل متفاوتی دارند"] };
    }
  }
  const r = compareParsed(t, c, {
    priceRatio: priceRatio(target, candidate),
    anchorPriceToman: target.anchorPriceToman,
    rejectBelowPct,
    approveAbovePct,
    flags: MATCHER_FLAGS,
  });

  const notes = [...r.notes];
  if (candidate.available === false) notes.push("کارت در ترب ناموجود است");
  const sellers = candidate.sellerCount ?? 0;
  if (sellers >= 2) notes.push(`لیستینگ ادغام‌شده معتبر (${sellers} فروشنده)`);
  else if (sellers === 1) notes.push("لیستینگ تک‌فروشنده‌ای");

  const rejected = r.verdict === "reject";
  return {
    candidate,
    score: r.score,
    noul: Math.round(r.score) / 100,
    verdict: r.verdict,
    status: rejected ? "IDENTITY_MISMATCH" : r.verdict === "approve" ? "MATCH_CONFIRMED" : "REVIEW_REQUIRED",
    titleState: "present",
    parsed: c,
    scoreComponents: r.scoreComponents,
    rawScore: r.rawScore,
    hasConflict: r.hasConflict,
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
  const reviewCap = Math.min(approveAbovePct - 1, Math.max(rejectBelowPct + 5, approveAbovePct - 6));
  let evaluated = candidates.map((c) => evaluateTorobCandidate(target, c, minSellerCount));

  // قاعدهٔ ابهام بین‌کارتی: اگر دو کارت با «هویت متفاوت» یا مشخصات اصلی متضاد هر دو تایید خودکار شدند، هیچ‌کدام خودکار نیست
  const approved = evaluated.filter((x) => x.verdict === "approve");
  const keys = new Set(approved.map((x) => x.identityKey));
  let crossCardConflict = keys.size > 1;
  if (!crossCardConflict && approved.length > 1) {
    const parsedCards = approved.map((x) => x.parsed!);
    for (let i = 0; i < parsedCards.length && !crossCardConflict; i++) {
      for (let j = i + 1; j < parsedCards.length; j++) {
        const a = parsedCards[i].attrs;
        const b = parsedCards[j].attrs;
        for (const k of Object.keys(a)) {
          if (k === "res" || k === "wifi") continue;
          const va = a[k];
          const vb = b[k];
          if (va?.length && vb?.length && !va.some((x) => vb.some((y) => String(x) === String(y)))) {
            crossCardConflict = true;
            break;
          }
        }
      }
    }
  }
  if (approved.length > 1 && crossCardConflict) {
    evaluated = evaluated.map((x) =>
      x.verdict === "approve"
        ? {
            ...x,
            score: Math.min(x.score, reviewCap),
            noul: Math.min(x.score, reviewCap) / 100,
            verdict: "review",
            status: "REVIEW_REQUIRED",
            needsReview: true,
            blockers: [...(x.blockers ?? []), "چند کارت با هویت یا مشخصات متفاوت هم‌زمان با محصول سایت منطبق‌اند"],
            notes: [...x.notes, "⚠ چند کارت با هویت متفاوت هم‌زمان با محصول سایت منطبق‌اند؛ انتخاب با بازبین"],
          }
        : x,
    );
  }

  const allRanked = [...evaluated].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    if (VERDICT_RANK[b.verdict] !== VERDICT_RANK[a.verdict]) return VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
    if (a.titleState !== b.titleState && (a.titleState === "present" || b.titleState === "present")) {
      return a.titleState === "present" ? -1 : 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    const sa = a.candidate.sellerCount ?? 0;
    const sb = b.candidate.sellerCount ?? 0;
    if (sb !== sa) return sb - sa;
    return Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
  });

  // کارت‌های هم‌هویت (تکرار لیستینگ): از میان آنها پرفروشنده‌ترینِ موجود جلو بیاید
  const head = allRanked[0];
  if (head?.identityKey && !head.rejected) {
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

  const nonRejected = allRanked.filter((x) => !x.rejected && x.titleState === "present");
  if (!nonRejected.length) {
    if (allRanked.some((x) => x.status === "EXTRACTION_INCOMPLETE")) {
      return {
        best: null,
        allRanked,
        confident: false,
        verdict: "review",
        explanation: "داوری هویت برخی کارت‌های ترب به دلیل عنوان ناقص به دریافت جزئیات نیاز دارد",
      };
    }
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
