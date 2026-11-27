import { areCompatibleConfirmedIdentities, evaluateTorobCandidate, type ProductMatchTarget, type ScoredCandidateResult } from "@/lib/pricing/matcher";
import { conflictingPrimarySpec, relateCodes } from "@/lib/pricing/match/compare";
import { areKnownBrandSetsCompatible, PACK_WORDS } from "@/lib/pricing/match/lexicon";
import { parseTitle, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import type { RawOffer, TorobDataOrigin, TorobOfferIdentity } from "@/lib/pricing/types";

const REMOTE_FIELDS = ["frequency", "buttons", "bluetooth"] as const;
const REMOTE_LABELS = { frequency: "فرکانس", buttons: "تعداد دکمه", bluetooth: "بلوتوث" };
const SINGLE_UNIT_UNVERIFIED = "برچسب تعداد روی کارت مبهم است و عرضهٔ تکی به‌صراحت تأیید نشده است";
export const SELLER_EVIDENCE_NOTE = "عنوان یا مشخصات مستقل فروشنده هویت کارت ترب را تکمیل کرد";

function brands(title: ParsedTitle): string[] {
  return [...title.brands, ...title.impliedBrands];
}

export function conflictingEvidence(a: ParsedTitle, b: ParsedTitle): string | undefined {
  if (a.head && b.head && a.head.cls !== b.head.cls) return "نوع کالا با شواهد محصول یکسان نیست";
  if (!areKnownBrandSetsCompatible(brands(a), brands(b))) return "برند با شواهد محصول متناقض است";
  const codesA = a.codes.filter(({ inCompat }) => !inCompat);
  const codesB = b.codes.filter(({ inCompat }) => !inCompat);
  const codesCover = (left: typeof codesA, right: typeof codesB) => left.every((code) => right.some((other) =>
    ["equal", "alias", "tail"].includes(relateCodes(code, other))));
  if (codesA.length && codesB.length && (!codesCover(codesA, codesB) || !codesCover(codesB, codesA))) {
    return "کد مدل با شواهد محصول متناقض است";
  }
  if (a.packageUnits != null && b.packageUnits != null && a.packageUnits !== b.packageUnits) {
    return "تعداد اقلام بسته با شواهد محصول یکسان نیست";
  }
  return conflictingPrimarySpec(a, b);
}

function unexpectedContents(target: ParsedTitle, other: ParsedTitle): boolean {
  return other.bundleWith.some((cls) => !target.bundleWith.includes(cls)) ||
    other.withAccessories.some((cls) => !target.withAccessories.includes(cls)) ||
    Boolean(other.trailingAccessory && other.trailingAccessory !== target.trailingAccessory) ||
    (other.head?.cls === "acc:remote" && other.hits.some(({ cls }) =>
      cls !== "acc:remote" && !target.hits.some((hit) => hit.cls === cls)));
}

export function reviewCard(result: ScoredCandidateResult, target: ProductMatchTarget, reason: string): ScoredCandidateResult {
  const score = Math.min(result.score, Math.max(0, (target.approveAbovePct ?? 80) - 1));
  return { ...result, score, noul: score / 100, verdict: "review", status: "REVIEW_REQUIRED",
    rejected: false, needsReview: true, rejectReason: undefined, blockers: [reason, ...(result.blockers ?? [])] };
}

function cardForSellerEvidence(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult) {
  const parsed = result.parsed;
  if (!parsed) return undefined;
  const ambiguousPack = Boolean(parsed.pack && !targetTitle.pack);
  if (ambiguousPack && parsed.pack) {
    const { qty, word } = parsed.pack;
    const ratio = (result.candidate.priceToman ?? 0) / (target.anchorPriceToman ?? 0);
    if (parsed.head?.cls !== "acc:remote" || targetTitle.head?.cls !== "acc:remote" ||
        qty == null || qty > 16 || parsed.attrs.buttons?.length && parsed.packageUnits !== 1 ||
        !/ (?:عددی|تایی)$/.test(word) ||
        (targetTitle.attrs.buttons?.length && !targetTitle.attrs.buttons.includes(qty)) ||
        !(ratio >= 0.55 && ratio <= 1.85) || parsed.tokens.some((token) => PACK_WORDS.has(token))) return undefined;
    // A plausible label permits inspection. Explicit evidence is still required to establish one unit.
    const stripQuantity = (title: string | null | undefined) => ` ${normalizeText(title)} `.replace(` ${word} `, " ").trim();
    const { candidate } = result;
    result = evaluateTorobCandidate(target, { ...candidate, priceToman: null,
      titleFa: stripQuantity(candidate.titleFa), titleEn: stripQuantity(candidate.titleEn) });
    if (result.parsed?.pack) return undefined;
  }
  const card = result.parsed;
  if (!card || result.hasConflict || conflictingEvidence(targetTitle, card) || unexpectedContents(targetTitle, card)) return undefined;
  if (card.codes.some((code) => !code.inCompat) && !targetTitle.codes.some((code) => !code.inCompat)) return undefined;
  return { result, card, ambiguousPack };
}

export function isSellerEvidenceProbeCandidate(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult): boolean {
  const card = result.parsed;
  if (!card?.head || card.head.cls !== targetTitle.head?.cls) return false;
  const sharedBrand = Boolean(brands(card).length && brands(targetTitle).length && areKnownBrandSetsCompatible(brands(card), brands(targetTitle)));
  const sharedDescriptor = card.words.some((word) => targetTitle.words.includes(word));
  const sharedSpec = Object.entries(card.attrs).some(([key, values]) =>
    targetTitle.attrs[key]?.some((value) => values.includes(value)));
  if (!sharedBrand && !sharedDescriptor && !sharedSpec) return false;
  const evidence = cardForSellerEvidence(target, targetTitle, result);
  if (!evidence) return false;
  return evidence.ambiguousPack || !result.hasConflict && (
    Object.entries(card.attrs).every(([key, values]) => targetTitle.attrs[key]?.some((value) => values.includes(value))) &&
    card.words.every((word) => targetTitle.tokens.includes(word)) &&
    (Object.keys(targetTitle.attrs).some((key) => !card.attrs[key]?.length) || targetTitle.words.some((word) => !card.tokens.includes(word)))
  );
}

interface OfferInspection {
  offer: RawOffer & { torobIdentity: TorobOfferIdentity };
  match?: ScoredCandidateResult;
}

export function inspectSellerOffers(
  target: ProductMatchTarget,
  targetTitle: ParsedTitle,
  cardResult: ScoredCandidateResult,
  offers: RawOffer[],
  context: { origin?: TorobDataOrigin; cardSource?: "product_details" | "search_card"; complete: boolean; truncated: boolean; quantityLabel?: boolean },
) {
  const evidence = cardForSellerEvidence(target, targetTitle, cardResult);
  const { candidate } = cardResult;
  const codeless = !targetTitle.codes.some(({ inCompat }) => !inCompat);
  const head = cardResult.parsed?.head;
  const contextTitle = head && cardResult.parsed?.tokens.slice(head.at, head.at + head.len).join(" ");
  const expectedSpecs = targetTitle.head?.cls === "acc:remote"
    ? Object.fromEntries(REMOTE_FIELDS.flatMap((key) => targetTitle.attrs[key]?.length ? [[key, targetTitle.attrs[key]]] : [])) : undefined;
  const assessments: OfferInspection[] = offers.map((offer) => {
    const listing = normalizeText(offer.listingTitle);
    // A known class provides parsing context for structured seller attributes. It supplies no brand, model or variant.
    const sellerTitle = contextTitle && offer.listingSpecs?.length && !parseTitle(listing).head
      ? `${contextTitle} ${listing}`.trim() : listing;
    const seller = evaluateTorobCandidate(target, { prk: candidate.prk, titleFa: sellerTitle,
      specs: offer.listingSpecs });
    const parsed = seller.parsed;
    const namedSources: TorobOfferIdentity["sources"] = [
      ...(listing ? ["seller_listing" as const] : []),
      ...(offer.listingSpecs?.length ? ["seller_specs" as const] : []),
      ...(context.cardSource ? [context.cardSource] : []),
    ];
    const assess = (status: TorobOfferIdentity["status"], reason: string, match?: ScoredCandidateResult): OfferInspection => ({
      offer: { ...offer, torobIdentity: { prk: candidate.prk, status, reason: reason.slice(0, 400),
        sources: namedSources, origin: context.origin, specs: parsed?.attrs, packageUnits: parsed?.packageUnits,
        expectedSpecs,
        brands: parsed && brands(parsed), models: parsed?.codes.filter(({ inCompat }) => !inCompat).map(({ raw }) => raw),
        sharedImage: offer.imageUrls?.some((url) => candidate.imageUrls?.includes(url)) || undefined } },
      match,
    });
    if (!parsed) return assess("REVIEW_REQUIRED", "عنوان یا مشخصات هویتی قابل استفاده از فروشنده دریافت نشد");
    const conflict = conflictingEvidence(targetTitle, parsed) ?? (evidence && conflictingEvidence(evidence.card, parsed));
    if (seller.hasConflict || conflict || unexpectedContents(targetTitle, parsed)) {
      return assess("IDENTITY_MISMATCH", conflict ?? seller.rejectReason ?? seller.blockers?.[0] ?? "نوع و اقلام همراه فروشنده با محصول متفاوت است");
    }
    if (!context.complete || !evidence) return assess("REVIEW_REQUIRED", "هویت کارت یا ساختار دادهٔ ترب برای استفاده از پیشنهاد احراز نشد");
    const missingEvidence = [];
    if (codeless && targetTitle.head?.cls === "acc:remote") {
      const missing = REMOTE_FIELDS.filter((key) => targetTitle.attrs[key]?.length && !parsed.attrs[key]?.length);
      if (missing.length) missingEvidence.push(`${missing.map((key) => REMOTE_LABELS[key]).join("، ")} در شواهد فروشنده تأیید نشده است`);
    }
    if ((evidence.ambiguousPack || context.quantityLabel) && parsed.packageUnits !== 1 && evidence.card.packageUnits !== 1) {
      missingEvidence.push(SINGLE_UNIT_UNVERIFIED);
    }
    if (missingEvidence.length) return assess("REVIEW_REQUIRED", missingEvidence.join(" · "));
    if (seller.status !== "MATCH_CONFIRMED") {
      return assess("REVIEW_REQUIRED", seller.blockers?.[0] ?? "شواهد مستقل فروشنده برای تطبیق قطعی کافی نیست");
    }
    const verified = evaluateTorobCandidate(target, {
      ...evidence.result.candidate, priceToman: null,
      titleFa: seller.candidate.titleFa,
      titleEn: [evidence.result.candidate.titleFa, evidence.result.candidate.titleEn].filter(Boolean).join(" "),
      specs: [...(evidence.result.candidate.specs ?? []), ...(offer.listingSpecs ?? [])],
    });
    if (verified.status !== "MATCH_CONFIRMED" || verified.hasConflict) {
      return assess("REVIEW_REQUIRED", "شواهد کارت و فروشنده یک هویت واحد را احراز نکردند");
    }
    return assess("MATCH_CONFIRMED", "هویت محصول با شواهد مستقل این فروشنده و مشخصات سازگار کارت احراز شد", verified);
  });

  const matches = assessments.flatMap(({ match }) => match ? [match] : []);
  const mixedVariants = matches.some((a, i) => matches.slice(i + 1).some((b) => !areCompatibleConfirmedIdentities(a, b)));
  let result = cardResult;
  let sellerCorroborated = false;
  if (mixedVariants) {
    const reason = "پیشنهادهای این کارت به چند واریانت با مشخصات متفاوت اشاره می‌کنند";
    result = { ...reviewCard(cardResult, target, reason), hasConflict: true };
  } else if (context.complete && evidence && cardResult.status !== "MATCH_CONFIRMED") {
    const best = matches.sort((a, b) => b.score - a.score)[0];
    if (best && !context.truncated && !assessments.some(({ offer }) => offer.torobIdentity.status === "IDENTITY_MISMATCH")) {
      result = { ...best, candidate, notes: [...best.notes, SELLER_EVIDENCE_NOTE] };
      sellerCorroborated = true;
    } else if (evidence.ambiguousPack) {
      result = reviewCard({ ...evidence.result, candidate }, target, "تعداد دکمه و تعداد اقلام بسته با شواهد موجود به‌طور مستقل احراز نشد");
    } else if (cardResult.rejected) {
      result = reviewCard(cardResult, target, "عنوان کارت و شواهد فروشنده برای احراز قطعی هویت کافی نیست");
    }
  }
  return { result, sellerCorroborated, ambiguousPack: evidence?.ambiguousPack ?? false,
    offers: assessments.map(({ offer }) => offer) };
}
