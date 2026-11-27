import { compareTitleDescriptors } from "@/lib/pricing/match/descriptors";
import { areCompatibleConfirmedIdentities, evaluateTorobCandidate, type ProductMatchTarget, type ScoredCandidateResult } from "@/lib/pricing/matcher";
import { conflictingPrimarySpec, relateCodes } from "@/lib/pricing/match/compare";
import { areKnownBrandSetsCompatible, isAccessoryClass, PACK_WORDS, VARIANT_WORDS } from "@/lib/pricing/match/lexicon";
import { parseIdentityTitle, parseTitle, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import type { RawOffer, SellerIdentityAssessment, TorobDataOrigin, TorobOfferIdentity } from "@/lib/pricing/types";

const REMOTE_FIELDS = ["frequency", "buttons", "bluetooth", "ch"] as const;
const REMOTE_LABELS = { frequency: "فرکانس", buttons: "تعداد دکمه", bluetooth: "بلوتوث", ch: "تعداد کانال" };
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

export function unexpectedContents(target: ParsedTitle, other: ParsedTitle): boolean {
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

function isPlausibleAmbiguousRemotePack(
  target: ProductMatchTarget,
  targetTitle: ParsedTitle,
  result: ScoredCandidateResult,
): boolean {
  const parsed = result.parsed;
  if (!parsed?.pack) return false;
  const { qty, word } = parsed.pack;
  const anchor = target.anchorPriceToman;
  const cardPrice = result.candidate.priceToman;
  const ratio = anchor && anchor > 0 && cardPrice && cardPrice > 0 ? cardPrice / anchor : null;
  if (
    parsed.head?.cls !== "acc:remote" ||
    targetTitle.head?.cls !== "acc:remote" ||
    qty == null ||
    qty > 16 ||
    (parsed.attrs.buttons?.length && parsed.packageUnits !== 1) ||
    !/ (?:عددی|تایی)$/.test(word) ||
    (targetTitle.attrs.buttons?.length && !targetTitle.attrs.buttons.includes(qty)) ||
    (ratio != null && !(ratio >= 0.55 && ratio <= 1.85)) ||
    parsed.tokens.some((token) => PACK_WORDS.has(token))
  ) {
    return false;
  }
  return true;
}

function stripAmbiguousQuantityResult(
  target: ProductMatchTarget,
  result: ScoredCandidateResult,
): ScoredCandidateResult | undefined {
  const word = result.parsed?.pack?.word;
  if (!word) return undefined;
  const stripQuantity = (title: string | null | undefined) => ` ${normalizeText(title)} `.replace(` ${word} `, " ").trim();
  const { candidate } = result;
  const stripped = evaluateTorobCandidate(target, {
    ...candidate,
    priceToman: null,
    titleFa: stripQuantity(candidate.titleFa),
    titleEn: stripQuantity(candidate.titleEn),
  });
  return stripped.parsed?.pack ? undefined : stripped;
}

function cardForSellerEvidence(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult) {
  const parsed = result.parsed;
  if (!parsed) return undefined;
  const ambiguousPack = Boolean(parsed.pack && !targetTitle.pack);
  if (ambiguousPack && parsed.pack) {
    if (!isPlausibleAmbiguousRemotePack(target, targetTitle, result)) return undefined;
    const stripped = stripAmbiguousQuantityResult(target, result);
    if (!stripped) return undefined;
    result = stripped;
  }
  const card = result.parsed;
  if (!card || conflictingEvidence(targetTitle, card) || unexpectedContents(targetTitle, card)) return undefined;
  if (card.counterfeit && !targetTitle.counterfeit) return undefined;
  if (card.used && !targetTitle.used) return undefined;
  if (card.defective && !targetTitle.defective) return undefined;
  // تضاد قیمتیِ سطح کارت نباید به‌تنهایی بررسی مستقل فروشندگان یک کارت معتبر ساختاری را مسدود کند.
  const priceOnlyConflict = Boolean(
    result.hasConflict &&
    (!result.rejectReason || /قیمت کارت ترب/.test(result.rejectReason)) &&
    (result.blockers ?? []).every((v) => /قیمت کارت ترب/.test(v)),
  );
  const structuralConflict = Boolean(result.hasConflict && !priceOnlyConflict);
  if (structuralConflict) return undefined;
  if (card.codes.some((code) => !code.inCompat) && !targetTitle.codes.some((code) => !code.inCompat)) return undefined;
  return { result, card, ambiguousPack };
}

export interface DiscoveryEligibility {
  eligible: boolean;
  probe: boolean;
  ambiguousPack: boolean;
  hardContradictions: string[];
  matchedTechnicalAttrs: string[];
  sharedDescriptors: string[];
  sharedBrand: boolean;
  reason: string;
}

/**
 * مرحلهٔ A (فراخوانی با یادآوری بالا): تعیین اینکه آیا یک کارت ترب شایستهٔ بررسی جزئیات و حفظ در گراف است یا نه.
 * مستقل از آستانهٔ امتیاز قیمت‌گذاری (مرحلهٔ B) عمل می‌کند تا اختلاف صفات ظاهری، عنوان عمومی یا قیمت غیرمنتظره مانع کشف نشود.
 */
export function assessDiscoveryEligibility(
  target: ProductMatchTarget,
  targetTitle: ParsedTitle,
  result: ScoredCandidateResult,
  opts?: { fromSimilarOrKnown?: boolean },
): DiscoveryEligibility {
  if (result.titleState !== "present" || !result.parsed) {
    return {
      eligible: true,
      probe: false,
      ambiguousPack: false,
      hardContradictions: [],
      matchedTechnicalAttrs: [],
      sharedDescriptors: [],
      sharedBrand: false,
      reason: "عنوان کارت در جست‌وجو ناقص است و برای تکمیل به استعلام جزئیات نیاز دارد",
    };
  }
  const card = result.parsed;
  const hardContradictions: string[] = [];

  if (card.counterfeit && !targetTitle.counterfeit) hardContradictions.push(`نشانگر غیراصل (${card.counterfeit})`);
  if (card.defective && !targetTitle.defective) hardContradictions.push(`نشانگر کالای معیوب (${card.defective})`);
  if (card.used && !targetTitle.used) hardContradictions.push(`نشانگر کارکرده/استوک (${card.used})`);
  if (targetTitle.head && card.head && card.head.cls !== targetTitle.head.cls) {
    hardContradictions.push(`ردهٔ متفاوت (${card.head.cls} ≠ ${targetTitle.head.cls})`);
  } else if (!targetTitle.head && card.head && isAccessoryClass(card.head.cls)) {
    hardContradictions.push(`لوازم جانبی (${card.head.cls})`);
  }
  if (unexpectedContents(targetTitle, card)) hardContradictions.push("اقلام همراه یا باندل غیرمنتظره");

  const evConflict = conflictingEvidence(targetTitle, card);
  if (evConflict) hardContradictions.push(evConflict);

  // تضاد ردهٔ واریانت (Pro / Lite / Ultra) یا ویژگی ساختاری (دام/بولت، اینترنال/اکسترنال)
  const tTiers = targetTitle.features.tier ?? [];
  const cTiers = card.features.tier ?? [];
  if ((tTiers.length > 0 || cTiers.length > 0) &&
      (tTiers.length !== cTiers.length || !tTiers.every((x) => cTiers.includes(x)))) {
    hardContradictions.push(`نسخه/رده متفاوت (${tTiers.join("/") || "عادی"} ≠ ${cTiers.join("/") || "عادی"})`);
  }
  for (const key of ["form", "tech", "hddkind", "mgmt"] as const) {
    const tv = targetTitle.features[key];
    const cv = card.features[key];
    if (tv?.length && cv?.length && !tv.some((x) => cv.includes(x))) {
      hardContradictions.push(`ویژگی ${key} متناقض است`);
    }
  }

  let ambiguousPack = false;
  if (targetTitle.pack && !card.pack) {
    hardContradictions.push("محصول سایت پک است ولی کارت تکی است");
  } else if (card.pack && !targetTitle.pack) {
    if (isPlausibleAmbiguousRemotePack(target, targetTitle, result)) {
      ambiguousPack = true;
    } else {
      hardContradictions.push(`پک چندعددی (${card.pack.word})`);
    }
  } else if (targetTitle.pack && card.pack && targetTitle.pack.qty != null && card.pack.qty != null && targetTitle.pack.qty !== card.pack.qty) {
    hardContradictions.push(`تعداد پک متفاوت (${targetTitle.pack.qty} ≠ ${card.pack.qty})`);
  }

  const targetCodes = targetTitle.codes.filter((c) => !c.inCompat);
  const cardCodes = card.codes.filter((c) => !c.inCompat);
  if (targetCodes.length > 0 && cardCodes.length > 0) {
    const hasCompatibleCode = targetCodes.some((tc) =>
      cardCodes.some((cc) => ["equal", "alias", "tail", "ext_seg", "stem"].includes(relateCodes(tc, cc))),
    );
    if (!hasCompatibleCode) hardContradictions.push("کد مدل فنی غیرمرتبط");
  } else if (!targetCodes.length && cardCodes.length > 0 && (card.pack || ambiguousPack)) {
    hardContradictions.push("کارت دارای کد مدل و برچسب پک است در حالی که محصول هدف بی‌کد است");
  }

  const descCmp = compareTitleDescriptors(
    targetTitle.descriptorWords ?? targetTitle.words,
    targetTitle.norm,
    card.descriptorWords ?? card.words,
    card.norm,
    targetTitle.head?.cls ?? card.head?.cls,
    target.descriptorPolicy,
  );
  if (descCmp.strictVariantMismatch.length > 0) {
    hardContradictions.push(`تضاد واریانت رده (${descCmp.strictVariantMismatch.join("، ")})`);
  }

  const sharedBrand = Boolean(
    brands(card).length && brands(targetTitle).length && areKnownBrandSetsCompatible(brands(card), brands(targetTitle)),
  );
  const matchedTechnicalAttrs: string[] = [];
  for (const [key, values] of Object.entries(targetTitle.attrs)) {
    if (!values?.length) continue;
    const hit = card.attrs[key]?.find((v) => values.includes(v));
    if (hit !== undefined) matchedTechnicalAttrs.push(`${key}:${hit}`);
  }
  const sharedDescriptors = [
    ...descCmp.matchedColors.map((w) => `color:${w}`),
    ...card.words.filter((w) => targetTitle.words.includes(w) && !descCmp.matchedColors.includes(w)),
  ];

  if (hardContradictions.length > 0) {
    return {
      eligible: false,
      probe: false,
      ambiguousPack,
      hardContradictions,
      matchedTechnicalAttrs,
      sharedDescriptors,
      sharedBrand,
      reason: hardContradictions[0],
    };
  }

  const sameClass = Boolean(targetTitle.head && card.head && targetTitle.head.cls === card.head.cls);
  const missingHeadOnCard = Boolean(!card.head && (matchedTechnicalAttrs.length > 0 || sharedBrand || sharedDescriptors.length > 0));
  const genericClassOnlyCard = Boolean(
    sameClass &&
    !cardCodes.length &&
    descCmp.unmatchedCandHard.length === 0 &&
    (card.words.length <= 1 || matchedTechnicalAttrs.length > 0 || sharedDescriptors.length > 0 || sharedBrand),
  );
  const hasOverlap =
    matchedTechnicalAttrs.length > 0 ||
    sharedBrand ||
    sharedDescriptors.length > 0 ||
    genericClassOnlyCard ||
    Boolean(opts?.fromSimilarOrKnown && (sameClass || missingHeadOnCard));

  const alienRejectedCodeOnCodeless = Boolean(
    !opts?.fromSimilarOrKnown &&
    !targetCodes.length &&
    cardCodes.length > 0 &&
    !sharedBrand &&
    result.rejected,
  );
  const extremeLowSignalRejected = Boolean(
    !opts?.fromSimilarOrKnown &&
    result.rejected &&
    !ambiguousPack &&
    !sharedBrand &&
    !sharedDescriptors.length &&
    (result.rawScore ?? result.score) < 28,
  );
  const eligible =
    !alienRejectedCodeOnCodeless &&
    !extremeLowSignalRejected &&
    (sameClass || missingHeadOnCard || !targetTitle.head) &&
    hasOverlap;
  const probe = Boolean(
    eligible &&
    result.rejected &&
    (ambiguousPack || genericClassOnlyCard || matchedTechnicalAttrs.length > 0 || sharedBrand || sharedDescriptors.length > 0),
  );

  return {
    eligible,
    probe,
    ambiguousPack,
    hardContradictions: [],
    matchedTechnicalAttrs,
    sharedDescriptors,
    sharedBrand,
    reason: eligible
      ? matchedTechnicalAttrs.length > 0 || sharedDescriptors.length > 0
        ? "هم‌پوشانی فنی یا توصیفی بدون تضاد ساختاری — واجد شرایط بررسی جزئیات"
        : "کارت هم‌رده با عنوان عمومی یا ناقص — نیازمند بررسی شواهد فروشندگان"
      : "هم‌پوشانی کافی با کالای هدف ندارد",
  };
}

export function isSellerEvidenceProbeCandidate(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult): boolean {
  const elig = assessDiscoveryEligibility(target, targetTitle, result);
  return elig.eligible && (elig.probe || elig.ambiguousPack);
}

interface OfferInspection {
  offer: RawOffer & { torobIdentity: TorobOfferIdentity };
  match?: ScoredCandidateResult;
  assessment: SellerIdentityAssessment;
}

function collectMatchedTargetAttrs(
  targetTitle: ParsedTitle,
  sellerParsed: ParsedTitle,
  cardParsed?: ParsedTitle,
): { matched: string[]; missing: string[]; conflicting: string[] } {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicting: string[] = [];

  if (targetTitle.head && sellerParsed.head) {
    if (targetTitle.head.cls === sellerParsed.head.cls) matched.push(`class:${targetTitle.head.cls}`);
    else conflicting.push(`class:${targetTitle.head.cls}!=${sellerParsed.head.cls}`);
  } else if (targetTitle.head && cardParsed?.head && cardParsed.head.cls === targetTitle.head.cls) {
    matched.push(`class:${targetTitle.head.cls}`);
  } else if (targetTitle.head) {
    missing.push("class");
  }

  for (const [key, tVals] of Object.entries(targetTitle.attrs)) {
    if (!tVals?.length) continue;
    const sVals = sellerParsed.attrs[key];
    const cVals = cardParsed?.attrs[key];
    if (sVals?.length) {
      const hit = sVals.find((v) => tVals.includes(v));
      if (hit !== undefined) matched.push(`${key}:${hit}`);
      else conflicting.push(`${key}:${tVals.join("/")}!=${sVals.join("/")}`);
    } else if (cVals?.length) {
      const hit = cVals.find((v) => tVals.includes(v));
      if (hit !== undefined) {
        if (targetTitle.head?.cls === "acc:remote" && REMOTE_FIELDS.includes(key as (typeof REMOTE_FIELDS)[number])) {
          missing.push(key);
        } else {
          matched.push(`${key}:${hit}`);
        }
      } else {
        conflicting.push(`${key}:${tVals.join("/")}!=${cVals.join("/")}`);
      }
    } else {
      missing.push(key);
    }
  }

  const tBrands = brands(targetTitle);
  const sBrands = brands(sellerParsed);
  const cBrands = cardParsed ? brands(cardParsed) : [];
  if (tBrands.length > 0) {
    if (sBrands.length && areKnownBrandSetsCompatible(tBrands, sBrands)) matched.push(`brand:${sBrands[0]}`);
    else if (cBrands.length && areKnownBrandSetsCompatible(tBrands, cBrands)) matched.push(`brand:${cBrands[0]}`);
    else if ((sBrands.length && !areKnownBrandSetsCompatible(tBrands, sBrands)) || (cBrands.length && !areKnownBrandSetsCompatible(tBrands, cBrands))) {
      conflicting.push(`brand:${tBrands.join("/")}`);
    } else {
      missing.push("brand");
    }
  } else if (!targetTitle.codes.some((c) => !c.inCompat)) {
    // کالای بی‌کد و بی‌برند: نبود برند در هر دو طرف به‌عنوان مدرک ناقص برای بازبینی ثبت می‌شود
    if (!sBrands.length && !cBrands.length) missing.push("brand");
    else if (sBrands.length) matched.push(`brand:${sBrands[0]}`);
  }

  return { matched, missing, conflicting };
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
  const canonicalTitle = candidate.titleFa || candidate.titleEn || "";

  // لایهٔ مشخصات ساختاری کارت (سطح ۴ در سلسله‌مراتب شواهد) به‌صورت جداگانه حفظ می‌شود تا با عنوان فروشنده قاطی نشود.
  const cardSpecsParsed = candidate.specs?.length
    ? parseIdentityTitle(contextTitle || candidate.titleFa || "", candidate.specs)
    : undefined;
  const cardSpecsConflictTarget = cardSpecsParsed ? conflictingEvidence(targetTitle, cardSpecsParsed) : undefined;
  const cardTitleConflictTarget = cardResult.parsed ? conflictingEvidence(targetTitle, cardResult.parsed) : undefined;
  const cardUnexpected = cardResult.parsed ? unexpectedContents(targetTitle, cardResult.parsed) : false;

  const assessments: OfferInspection[] = offers.map((offer) => {
    const listing = normalizeText(offer.listingTitle);
    const rawListingTitle = offer.listingTitle ?? "";
    const sellerTitle = contextTitle && offer.listingSpecs?.length && !parseTitle(listing).head
      ? `${contextTitle} ${listing}`.trim() : listing;
    const seller = evaluateTorobCandidate(target, {
      prk: candidate.prk,
      titleFa: sellerTitle,
      specs: offer.listingSpecs,
    });
    const parsed = seller.parsed;
    const sharedImage = Boolean(offer.imageUrls?.some((url) => candidate.imageUrls?.includes(url)));
    const namedSources: TorobOfferIdentity["sources"] = [
      ...(listing ? ["seller_listing" as const] : []),
      ...(offer.listingSpecs?.length ? ["seller_specs" as const] : []),
      ...(context.cardSource ? [context.cardSource] : []),
    ];
    const assess = (
      status: TorobOfferIdentity["status"],
      reason: string,
      attrs: { matched: string[]; missing: string[]; conflicting: string[]; score?: number },
      match?: ScoredCandidateResult,
    ): OfferInspection => {
      const identityScore = Math.max(0, Math.min(100, Math.round(attrs.score ?? (match?.score ?? seller.score ?? 0))));
      const evidenceSources = [
        ...namedSources,
        ...(candidate.specs?.length ? ["card_specs"] : []),
        ...(sharedImage ? ["shared_image"] : []),
      ];
      const assessmentObj: SellerIdentityAssessment = {
        prk: candidate.prk,
        ...(offer.shopId ? { sellerId: offer.shopId } : {}),
        sellerName: offer.shopName,
        canonicalCardTitle: canonicalTitle,
        sellerListingTitle: rawListingTitle,
        matchedAttributes: [...new Set(attrs.matched)],
        missingAttributes: [...new Set(attrs.missing)],
        conflictingAttributes: [...new Set(attrs.conflicting)],
        identityScore,
        status,
        evidenceSources: [...new Set(evidenceSources)],
        confidenceReason: reason.slice(0, 400),
      };
      return {
        offer: {
          ...offer,
          torobIdentity: {
            prk: candidate.prk,
            status,
            reason: reason.slice(0, 400),
            sources: namedSources,
            origin: context.origin,
            specs: parsed?.attrs,
            packageUnits: parsed?.packageUnits,
            expectedSpecs,
            brands: parsed && brands(parsed),
            models: parsed?.codes.filter(({ inCompat }) => !inCompat).map(({ raw }) => raw),
            sharedImage: sharedImage || undefined,
            identityScore,
            matchedAttributes: assessmentObj.matchedAttributes,
            missingAttributes: assessmentObj.missingAttributes,
            conflictingAttributes: assessmentObj.conflictingAttributes,
            assessment: assessmentObj,
          },
        },
        match,
        assessment: assessmentObj,
      };
    };

    if (!parsed) {
      return assess("REVIEW_REQUIRED", "عنوان یا مشخصات هویتی قابل استفاده از فروشنده دریافت نشد", {
        matched: [],
        missing: ["seller_listing_title"],
        conflicting: [],
        score: 0,
      });
    }

    const targetConflict = conflictingEvidence(targetTitle, parsed);
    const sellerUnexpected = unexpectedContents(targetTitle, parsed);
    const attrSummary = collectMatchedTargetAttrs(targetTitle, parsed, cardResult.parsed);

    const descCmp = compareTitleDescriptors(
      targetTitle.descriptorWords ?? targetTitle.words,
      targetTitle.norm,
      parsed.descriptorWords ?? parsed.words,
      parsed.norm,
      targetTitle.head?.cls ?? parsed.head?.cls,
      target.descriptorPolicy,
    );
    for (const c of descCmp.matchedColors) attrSummary.matched.push(`color:${c}`);
    if (codeless && descCmp.hasSoftDescriptorDifference) {
      for (const s of [...descCmp.unmatchedTargetSoft, ...descCmp.unmatchedCandSoft]) {
        attrSummary.missing.push(`descriptor:${s}`);
      }
    }

    if (seller.hasConflict || targetConflict || sellerUnexpected) {
      const reason = targetConflict ?? seller.rejectReason ?? seller.blockers?.[0] ?? "نوع و اقلام همراه فروشنده با محصول متفاوت است";
      if (!attrSummary.conflicting.length) attrSummary.conflicting.push(reason);
      return assess("IDENTITY_MISMATCH", reason, { ...attrSummary, score: seller.score });
    }

    // بررسی تعارض بین مشخصات فنی کارت و عنوان/مشخصات فروشنده (هیچ عنوانی نباید بی‌صدا مشخصهٔ فنی متناقض را بپوشاند)
    const cardSpecVsSeller = cardSpecsParsed ? conflictingEvidence(cardSpecsParsed, parsed) : undefined;
    const cardVsSeller = evidence ? conflictingEvidence(evidence.card, parsed) : cardResult.parsed ? conflictingEvidence(cardResult.parsed, parsed) : undefined;
    if (cardSpecVsSeller || cardVsSeller || cardSpecsConflictTarget) {
      const reason = cardSpecVsSeller ?? cardVsSeller ?? cardSpecsConflictTarget ?? "شواهد کارت و فروشنده با یکدیگر متناقض است";
      attrSummary.conflicting.push(reason);
      return assess("REVIEW_REQUIRED", reason, { ...attrSummary, score: Math.min(seller.score, 65) });
    }

    if (!context.complete) {
      attrSummary.missing.push("complete_details_extraction");
      return assess("REVIEW_REQUIRED", "استخراج کامل فروشندگان و جزئیات کارت انجام نشد", { ...attrSummary, score: Math.min(seller.score, 70) });
    }

    // اگر کارت والد به‌طور ساختاری با هدف متناقض است (نوع/کد/برند/بسته متفاوت)، فروشنده به‌تنهایی نباید کارت متضاد را خودکار تأیید کند
    if (cardTitleConflictTarget || cardUnexpected || (cardResult.parsed?.codes.some((c) => !c.inCompat) && codeless)) {
      const reason = cardTitleConflictTarget ?? "هویت کارت والد با محصول هدف یا اقلام همراه سازگار نیست";
      attrSummary.missing.push("compatible_parent_card");
      return assess("REVIEW_REQUIRED", reason, { ...attrSummary, score: Math.min(seller.score, 70) });
    }

    const ambiguousPack = Boolean(evidence?.ambiguousPack || context.quantityLabel);
    const missingEvidence: string[] = [];
    if (codeless && targetTitle.head?.cls === "acc:remote") {
      const missing = REMOTE_FIELDS.filter((key) => targetTitle.attrs[key]?.length && !parsed.attrs[key]?.length);
      if (missing.length) {
        missing.forEach((k) => attrSummary.missing.push(k));
        missingEvidence.push(`${missing.map((key) => REMOTE_LABELS[key]).join("، ")} در شواهد فروشنده تأیید نشده است`);
      }
    }
    if (ambiguousPack && parsed.packageUnits !== 1 && evidence?.card.packageUnits !== 1) {
      attrSummary.missing.push("single_unit_confirmation");
      missingEvidence.push(SINGLE_UNIT_UNVERIFIED);
    }
    if (missingEvidence.length) {
      return assess("REVIEW_REQUIRED", missingEvidence.join(" · "), { ...attrSummary, score: Math.min(seller.score, 72) });
    }

    // ارزیابی سلسله‌مراتبی فروشنده: اول شواهد مستقل فروشنده، سپس تکمیل فقط فیلدهای غیرمتناقض کارت (بدون بازنویسی صفات فروشنده)
    const canBorrowCardContext = Boolean(evidence && !cardTitleConflictTarget && !cardUnexpected);
    let verified: ScoredCandidateResult = seller;
    if (seller.status !== "MATCH_CONFIRMED") {
      if (canBorrowCardContext && evidence) {
        verified = evaluateTorobCandidate(target, {
          ...evidence.result.candidate,
          priceToman: null,
          titleFa: seller.candidate.titleFa,
          titleEn: [evidence.result.candidate.titleFa, evidence.result.candidate.titleEn].filter(Boolean).join(" "),
          specs: [...(evidence.result.candidate.specs ?? []), ...(offer.listingSpecs ?? [])],
        });
      }
      if (verified.status !== "MATCH_CONFIRMED" || verified.hasConflict) {
        const reason = seller.blockers?.[0] ?? verified.blockers?.[0] ?? "شواهد مستقل فروشنده برای تطبیق قطعی کافی نیست";
        return assess("REVIEW_REQUIRED", reason, { ...attrSummary, score: Math.max(seller.score, verified.score) });
      }
    } else if (canBorrowCardContext && evidence) {
      // وقتی خود فروشنده به‌تنهایی MATCH_CONFIRMED است، با مشخصات سازگار کارت هم سازگاری را راستی‌آزمایی کن (اما عنوان عمومی کارت مانع نمی‌شود)
      const crossCheck = evaluateTorobCandidate(target, {
        ...evidence.result.candidate,
        priceToman: null,
        titleFa: seller.candidate.titleFa,
        titleEn: [evidence.result.candidate.titleFa, evidence.result.candidate.titleEn].filter(Boolean).join(" "),
        specs: [...(evidence.result.candidate.specs ?? []), ...(offer.listingSpecs ?? [])],
      });
      if (crossCheck.hasConflict) {
        attrSummary.conflicting.push(crossCheck.rejectReason ?? crossCheck.blockers?.[0] ?? "تعارض شواهد کارت و فروشنده");
        return assess("REVIEW_REQUIRED", "شواهد کارت و فروشنده یک هویت واحد را احراز نکردند", { ...attrSummary, score: Math.min(seller.score, 70) });
      }
      verified = crossCheck.status === "MATCH_CONFIRMED" ? crossCheck : seller;
    }

    // محافظت از قیمت مشکوک در برچسب تعداد مبهم
    if (ambiguousPack && target.anchorPriceToman && target.anchorPriceToman > 0 && offer.price > 0) {
      const ratio = offer.price / target.anchorPriceToman;
      if (ratio < 0.55 || ratio > 1.85) {
        attrSummary.missing.push("price_plausibility");
        return assess("REVIEW_REQUIRED", "نسبت قیمت پیشنهاد با عرضهٔ تکی روی کارتِ دارای برچسب تعداد هم‌خوان نیست", { ...attrSummary, score: 65 });
      }
    }

    return assess(
      "MATCH_CONFIRMED",
      "هویت محصول با شواهد مستقل این فروشنده و مشخصات سازگار کارت احراز شد",
      { ...attrSummary, score: verified.score },
      verified,
    );
  });

  // پارتیشن‌بندی امن در سطح فروشندگان: خوشه‌بندی پیشنهادهای تأییدشده بر اساس سازگاری هویتی
  const confirmedEntries = assessments.filter((item) => item.offer.torobIdentity.status === "MATCH_CONFIRMED" && item.match);
  const clusters: OfferInspection[][] = [];
  for (const entry of confirmedEntries) {
    const cluster = clusters.find((group) =>
      group.every((other) => entry.match && other.match && areCompatibleConfirmedIdentities(entry.match, other.match)),
    );
    if (cluster) cluster.push(entry);
    else clusters.push([entry]);
  }

  const mixedVariants = clusters.length > 1;
  let result = cardResult;
  let sellerCorroborated = false;

  if (mixedVariants) {
    const reason = "پیشنهادهای این کارت به چند واریانت با مشخصات متفاوت اشاره می‌کنند";
    result = { ...reviewCard(cardResult, target, reason), hasConflict: true };
    for (const entry of confirmedEntries) {
      entry.offer.torobIdentity.status = "REVIEW_REQUIRED";
      entry.offer.torobIdentity.reason = reason;
      entry.assessment.status = "REVIEW_REQUIRED";
      entry.assessment.confidenceReason = reason;
      entry.match = undefined;
    }
  } else if (clusters.length === 1) {
    const hasMismatchSeller = assessments.some(({ offer }) => offer.torobIdentity.status === "IDENTITY_MISMATCH");
    const unresolvedAmbiguousPackConflict = Boolean(evidence?.ambiguousPack && hasMismatchSeller);
    if (unresolvedAmbiguousPackConflict) {
      const reason = "تعداد دکمه و تعداد اقلام بسته با وجود فروشندهٔ ناهمساز به‌طور مستقل احراز نشد";
      result = reviewCard({ ...(evidence?.result ?? cardResult), candidate }, target, reason);
      for (const entry of confirmedEntries) {
        entry.offer.torobIdentity.status = "REVIEW_REQUIRED";
        entry.offer.torobIdentity.reason = reason;
        entry.assessment.status = "REVIEW_REQUIRED";
        entry.assessment.confidenceReason = reason;
        entry.match = undefined;
      }
    } else if (context.complete && cardResult.titleState === "present" && cardResult.status !== "MATCH_CONFIRMED") {
      // اگر یک خوشهٔ تأییدشده و سازگار وجود دارد و خود کارت تناقض ساختاری ندارد، فروشندهٔ ناسازگار D مانع حفظ فروشندگان معتبر A و B نمی‌شود.
      const priceOnlyCardConflict = Boolean(
        cardResult.hasConflict &&
        (!cardResult.rejectReason || /قیمت کارت ترب/.test(cardResult.rejectReason)) &&
        (cardResult.blockers ?? []).every((v) => /قیمت کارت ترب/.test(v)),
      );
      const structuralCardHasConflict = Boolean(
        !evidence?.ambiguousPack &&
        cardResult.hasConflict &&
        !priceOnlyCardConflict,
      );
      const cardHasMaterialContradiction = Boolean(
        structuralCardHasConflict ||
        cardTitleConflictTarget ||
        cardSpecsConflictTarget ||
        cardUnexpected ||
        (cardResult.parsed?.codes.some((c) => !c.inCompat) && codeless),
      );
      if (!context.truncated && !cardHasMaterialContradiction) {
        const best = clusters[0].map((e) => e.match!).sort((a, b) => b.score - a.score)[0];
        if (best) {
          result = { ...best, candidate, notes: [...best.notes, SELLER_EVIDENCE_NOTE] };
          sellerCorroborated = true;
        }
      } else if (evidence?.ambiguousPack) {
        result = reviewCard({ ...evidence.result, candidate }, target, "تعداد دکمه و تعداد اقلام بسته با شواهد موجود به‌طور مستقل احراز نشد");
      } else if (cardResult.rejected) {
        result = reviewCard(cardResult, target, "عنوان کارت و شواهد فروشنده برای احراز قطعی هویت کافی نیست");
      }
    }
  } else if (context.complete && cardResult.status !== "MATCH_CONFIRMED") {
    if (evidence?.ambiguousPack) {
      result = reviewCard({ ...evidence.result, candidate }, target, "تعداد دکمه و تعداد اقلام بسته با شواهد موجود به‌طور مستقل احراز نشد");
    } else if (cardResult.rejected) {
      const anyReviewSeller = assessments.some(({ offer }) => offer.torobIdentity.status === "REVIEW_REQUIRED");
      if (anyReviewSeller && !cardTitleConflictTarget && !cardSpecsConflictTarget && !cardUnexpected) {
        result = reviewCard(cardResult, target, "عنوان کارت و شواهد فروشنده برای احراز قطعی هویت کافی نیست");
      }
    }
  }

  return {
    result,
    sellerCorroborated,
    ambiguousPack: evidence?.ambiguousPack ?? false,
    mixedVariants,
    sellerAssessments: assessments.map(({ assessment }) => assessment),
    offers: assessments.map(({ offer }) => offer),
  };
}
