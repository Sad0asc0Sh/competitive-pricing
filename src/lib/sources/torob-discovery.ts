import { aiEnabled, verifyTorobMatchesWithAI } from "@/lib/ai/client";
import { listingPanel } from "@/lib/pricing/listing";
import { areCompatibleConfirmedIdentities, evaluateTorobCandidate, selectBestTorobSearchMatch, type ProductMatchTarget, type ScoredCandidateResult, type TorobCandidateCard } from "@/lib/pricing/matcher";
import { areKnownBrandSetsCompatible, VARIANT_WORDS } from "@/lib/pricing/match/lexicon";
import { parseTitle, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import { compactShopKey, makeOwnShopMatcher, type OwnShopMatcher } from "@/lib/pricing/own-shop";
import type {
  MarketPriceTrend,
  PanelCompetitiveEvidence,
  PanelCoverageStatus,
  PanelGroupRole,
  RawOffer,
  SourceResult,
  TorobCandidateTrace,
  TorobCoverageDiagnostics,
  TorobCoverageStatus,
  TorobDataOrigin,
  TorobIdentityStatus,
  TorobLinkConfirmation,
  TorobSearchTrace,
  TorobSourceAssessment,
  TorobStoppingReason,
  TorobTitleOrigin,
} from "@/lib/pricing/types";
import { detailsCacheKey, searchCacheKey, type TorobDiscoveryCache } from "./torob-cache";
import { conflictingEvidence, inspectSellerOffers, isSellerEvidenceProbeCandidate, reviewCard, SELLER_EVIDENCE_NOTE } from "./torob-identity";
import { decodeTorobSearch, safeTorobDetailsUrl, torobProductUrl, type DecodedTorobSearch, type TorobDetailsData, type TorobSearchRequest, type TorobSearchSort } from "./torob-payload";
import { buildSearchQueries, buildSearchQueryPlan, decomposeTargetProduct, extractVocabularyExpansions, type PlannedSearchQuery, type QueryStrategy } from "./torob-query";
import type { KnownPrkHint, SourceMatchConfig } from "./types";

export { buildSearchQueries, buildSearchQueryPlan, decomposeTargetProduct } from "./torob-query";

const ROW_LIMIT = 24;

export interface DiscoveryBudgets {
  maxSearchRequests: number;
  maxDetails: number;
  maxPagesPerQuery: number;
  searchConcurrency: number;
  detailsConcurrency: number;
  searchBudgetMs: number;
  detailsBudgetMs: number;
  searchTimeoutMs: number;
  detailsTimeoutMs: number;
  maxPerTitleBucket: number;
}

export function resolveDiscoveryBudgets(
  mode: "interactive" | "extended",
  codeless: boolean,
  override?: Partial<DiscoveryBudgets>,
): DiscoveryBudgets {
  const base: DiscoveryBudgets = mode === "extended"
    ? {
        maxSearchRequests: codeless ? 14 : 9,
        maxDetails: 12,
        maxPagesPerQuery: 3,
        searchConcurrency: 2,
        detailsConcurrency: 2,
        searchBudgetMs: 26_000,
        detailsBudgetMs: 28_000,
        searchTimeoutMs: 4_500,
        detailsTimeoutMs: 7_000,
        maxPerTitleBucket: 2,
      }
    : {
        maxSearchRequests: codeless ? 10 : 6,
        maxDetails: 8,
        maxPagesPerQuery: 2,
        searchConcurrency: 2,
        detailsConcurrency: 2,
        searchBudgetMs: 16_000,
        detailsBudgetMs: 18_000,
        searchTimeoutMs: 4_500,
        detailsTimeoutMs: 7_000,
        maxPerTitleBucket: 2,
      };
  return { ...base, ...override };
}

export interface TorobRead<T> {
  data?: T;
  issue?: string;
  unavailable?: boolean;
  blocked?: boolean;
  challenged?: boolean;
  origin?: TorobDataOrigin;
}

interface DiscoveryOptions {
  productName: string;
  sku?: string | null;
  category?: string | null;
  anchorPriceToman?: number | null;
  matchConfig?: SourceMatchConfig;
  prk?: string | null;
  cachedPrk?: string | null;
  knownPrks?: string[];
  knownPrkHints?: KnownPrkHint[];
  detailsUrl?: string | null;
  confirmation?: TorobLinkConfirmation | null;
  mode?: "interactive" | "extended";
  cache?: TorobDiscoveryCache;
  budgets?: Partial<DiscoveryBudgets>;
  now: Date;
  via: string;
  search: (req: TorobSearchRequest, timeoutMs: number) => Promise<TorobRead<unknown>>;
  details: (card: TorobCandidateCard, timeoutMs: number) => Promise<TorobRead<TorobDetailsData>>;
  similar?: (card: TorobCandidateCard, limit: number, timeoutMs: number) => Promise<TorobRead<unknown>>;
  priceTrend: (card: TorobCandidateCard) => Promise<MarketPriceTrend | null>;
}

type Extraction = TorobCandidateTrace["extraction"];

function candidateTrace(
  result: ScoredCandidateResult,
  extraction: Extraction,
  queries: number[],
  inspectionPriority?: number,
): TorobCandidateTrace {
  const { candidate, parsed } = result;
  return {
    prk: candidate.prk,
    url: torobProductUrl(candidate.prk),
    queries,
    titleFa: candidate.titleFa || null,
    titleEn: candidate.titleEn || null,
    titleState: result.titleState,
    titleFields: candidate.titleEvidence?.fields ?? [],
    normalizedTitle: parsed?.norm ?? "",
    brands: parsed ? [...new Set([...parsed.brands, ...parsed.impliedBrands])] : [],
    family: parsed?.family,
    models: [...(parsed?.codes.filter((code) => !code.inCompat).map((code) => code.raw) ?? []),
      ...(parsed?.attrs.access_model ?? []).map(String)],
    specs: parsed?.attrs,
    components: result.scoreComponents,
    rawScore: result.rawScore,
    score: result.titleState === "present" ? result.score : null,
    status: result.status,
    reasons: [...new Set([...(result.rejectReason ? [result.rejectReason] : []), ...result.notes, ...(result.blockers ?? [])])]
      .map((reason) => reason.slice(0, 400)).slice(0, 10),
    extraction,
    imageUrls: candidate.imageUrls,
    ...(inspectionPriority != null ? { inspectionPriority: Math.round(inspectionPriority * 10) / 10 } : {}),
    ...(candidate.sellerCount != null ? { sellerCount: candidate.sellerCount } : {}),
    ...(candidate.priceToman != null ? { priceToman: candidate.priceToman } : {}),
  };
}

function mergeCards(target: ProductMatchTarget, prev: TorobCandidateCard, next: TorobCandidateCard): TorobCandidateCard {
  const prevResult = evaluateTorobCandidate(target, prev);
  const nextResult = evaluateTorobCandidate(target, next);
  const [stronger, fallback] = !nextResult.hasConflict && nextResult.score > prevResult.score ? [next, prev] : [prev, next];
  const titleFa = normalizeText(stronger.titleFa) ? stronger.titleFa : fallback.titleFa;
  const titleEn = normalizeText(stronger.titleEn) ? stronger.titleEn : fallback.titleEn;
  return {
    ...prev,
    titleFa,
    titleEn,
    titleEvidence: {
      fields: [...new Set([...(prev.titleEvidence?.fields ?? []), ...(next.titleEvidence?.fields ?? [])])],
      parsed: Boolean(prev.titleEvidence?.parsed || next.titleEvidence?.parsed),
    },
    priceToman: stronger.priceToman ?? fallback.priceToman,
    sellerCount: prev.sellerCount ?? next.sellerCount,
    available: prev.available ?? next.available,
    detailsUrl: prev.detailsUrl ?? next.detailsUrl,
    shopName: prev.shopName ?? next.shopName,
    imageUrls: [...new Set([...(prev.imageUrls ?? []), ...(next.imageUrls ?? [])])].slice(0, 4),
  };
}

interface InspectedCard {
  result: ScoredCandidateResult;
  read: TorobRead<TorobDetailsData>;
  extraction: Extraction;
  origin?: TorobTitleOrigin;
  sellerTitle?: string;
  sellerCorroborated: boolean;
  adminConfirmed: boolean;
  offers: RawOffer[];
}

function inspectDetails(
  target: ProductMatchTarget, targetTitle: ParsedTitle, card: TorobCandidateCard, read: TorobRead<TorobDetailsData>,
  confirmation?: TorobLinkConfirmation | null,
  observations: NonNullable<TorobCandidateTrace["observations"]> = [],
): InspectedCard {
  const detailsPrk = read.data?.prk;
  if (detailsPrk && detailsPrk !== card.prk) {
    read = { issue: "details_prk_mismatch" };
  }
  const details = read.data;
  const hasDetailTitle = Boolean(normalizeText(details?.titleFa) || normalizeText(details?.titleEn));
  const hasSearchTitle = Boolean(normalizeText(card.titleFa) || normalizeText(card.titleEn));
  const prices = details?.offers.map(({ price }) => price).filter((price) => price > 0).sort((a, b) => a - b) ?? [];
  const candidate: TorobCandidateCard = {
    ...card,
    ...(hasDetailTitle ? { titleFa: details?.titleFa ?? "", titleEn: details?.titleEn, titleEvidence: details?.titleEvidence } : {}),
    ...(!hasDetailTitle && !hasSearchTitle && details?.titleEvidence?.fields.length ? { titleEvidence: details.titleEvidence } : {}),
    specs: details?.specs,
    imageUrls: [...new Set([...(details?.imageUrls ?? []), ...(card.imageUrls ?? [])])].slice(0, 4),
    sellerCount: details?.totalSellerCount ?? card.sellerCount,
    priceToman: card.priceToman ?? (prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null),
    detailsUrl: card.detailsUrl ?? details?.detailsUrl,
  };
  let cardResult = { ...evaluateTorobCandidate(target, { ...candidate, priceToman: null }), candidate };
  let quantityLabel = false;
  for (const observation of observations) {
    const observed = { ...candidate, titleFa: observation.titleFa ?? "", titleEn: observation.titleEn, specs: undefined };
    const evaluated = { ...evaluateTorobCandidate(target, { ...observed, priceToman: null }), candidate: observed };
    if (evaluated.parsed?.pack && isSellerEvidenceProbeCandidate(target, targetTitle, evaluated)) {
      quantityLabel = true;
      continue;
    }
    if (cardResult.status !== "IDENTITY_MISMATCH" && (evaluated.hasConflict ||
        (cardResult.parsed && evaluated.parsed && conflictingEvidence(cardResult.parsed, evaluated.parsed)))) {
      cardResult = { ...reviewCard(cardResult, target, "شواهد عنوان کارت در جست‌وجو و جزئیات ترب متناقض است"), hasConflict: true };
      break;
    }
  }
  const extraction = read.unavailable ? "unavailable" : !details || details.sellerRows == null || read.issue
    ? "incomplete" : details.sellerRows === 0 ? "empty" : "extracted";
  const cardSource = hasDetailTitle ? "product_details" : hasSearchTitle ? "search_card" : undefined;
  const { result, sellerCorroborated, offers, ambiguousPack } = inspectSellerOffers(target, targetTitle, cardResult, details?.offers ?? [], {
    origin: read.origin, cardSource, complete: extraction === "extracted", truncated: Boolean(details?.offersTruncated), quantityLabel,
  });
  const sellerTitle = !hasDetailTitle && !hasSearchTitle
    ? details?.offers.find((offer) => normalizeText(offer.listingTitle))?.listingTitle ?? undefined : undefined;
  const adminConfirmed = confirmation?.prk === card.prk && confirmation.origin === "admin_review" &&
    result.titleState === "present" && result.status !== "IDENTITY_MISMATCH" && !result.hasConflict &&
    (!ambiguousPack || result.status === "MATCH_CONFIRMED");
  return {
    result,
    read,
    extraction,
    origin: cardSource ?? (sellerTitle ? "seller_listing" : undefined),
    sellerTitle,
    sellerCorroborated,
    adminConfirmed,
    offers,
  };
}

function resolveIdentity(inspected: InspectedCard): TorobIdentityStatus {
  if (inspected.adminConfirmed) return "MATCH_CONFIRMED";
  return inspected.result.status;
}

function uniqueOffers(offers: RawOffer[]): RawOffer[] {
  const confirmed = new Map<string, RawOffer>();
  const nameToCanonical = new Map<string, string>();
  const excluded: RawOffer[] = [];
  const excludedKeys = new Set<string>();
  const pickOffer = (prev: RawOffer | undefined, offer: RawOffer) => {
    const oldTime = prev?.lastChangedAt?.getTime() ?? 0;
    const newTime = offer.lastChangedAt?.getTime() ?? 0;
    return !prev || newTime > oldTime || (newTime === oldTime && offer.price < prev.price) ? offer : prev;
  };
  for (const offer of offers) {
    if (offer.torobIdentity?.status !== "MATCH_CONFIRMED") {
      const shopKey = compactShopKey(offer.shopId) || compactShopKey(offer.shopName);
      const dedupKey = [
        offer.torobIdentity?.prk ?? "",
        shopKey,
        offer.sellerType ?? "online",
        offer.price,
        normalizeText(offer.listingTitle),
      ].join("|");
      if (!excludedKeys.has(dedupKey)) {
        excludedKeys.add(dedupKey);
        excluded.push(offer);
      }
      continue;
    }
    const id = compactShopKey(offer.shopId);
    const name = compactShopKey(offer.shopName);
    const type = offer.sellerType ?? "online";
    if (id) {
      const idKey = `id:${id}|${type}`;
      const nameKey = name ? `name:${name}|${type}` : "";
      let existing = confirmed.get(idKey);
      if (!existing && nameKey && confirmed.has(nameKey)) {
        existing = confirmed.get(nameKey);
        confirmed.delete(nameKey);
      }
      if (name) nameToCanonical.set(`${name}|${type}`, idKey);
      confirmed.set(idKey, pickOffer(existing, offer));
    } else {
      const canonical = nameToCanonical.get(`${name}|${type}`) ?? `name:${name}|${type}`;
      confirmed.set(canonical, pickOffer(confirmed.get(canonical), offer));
    }
  }
  return [...confirmed.values(), ...excluded].sort((a, b) => a.price - b.price);
}

interface CandidateMeta {
  card: TorobCandidateCard;
  observations: NonNullable<TorobCandidateTrace["observations"]>;
  searchKeys: Set<string>;
}

interface QueuedSearchAction {
  req: TorobSearchRequest;
  strategy: QueryStrategy | "pagination" | "sort_sellers" | "sort_price" | "category";
  priority: number;
  streamKey: string;
}

function stemFa(word: string): string {
  return word.replace(/(?:های|ها|ان|ی|ه|ات)$/u, "");
}

function hasDescriptorOverlap(targetTitle: ParsedTitle, parsed?: ParsedTitle): { overlapRatio: number; matched: number; unrelatedWords: number } {
  if (!parsed || !targetTitle.words.length) return { overlapRatio: 1, matched: 0, unrelatedWords: 0 };
  const cWords = new Set(parsed.words.map(stemFa));
  const cNorm = ` ${parsed.norm} `;
  let matched = 0;
  for (const word of targetTitle.words) {
    if (cWords.has(stemFa(word)) || cNorm.includes(` ${word} `)) matched++;
  }
  const tStems = new Set(targetTitle.words.map(stemFa));
  const tNorm = ` ${targetTitle.norm} `;
  const unrelatedWords = parsed.words.filter((w) => !tStems.has(stemFa(w)) && !tNorm.includes(` ${w} `) && !VARIANT_WORDS.has(w)).length;
  return { overlapRatio: matched / targetTitle.words.length, matched, unrelatedWords };
}

function isHighAlignmentReviewCandidate(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult): boolean {
  if (result.status === "MATCH_CONFIRMED") return true;
  if (result.rejected || result.hasConflict) return false;
  if (result.titleState !== "present") return true;
  const parsed = result.parsed;
  if (!parsed) return false;
  if (targetTitle.head && parsed.head && parsed.head.cls !== targetTitle.head.cls) return false;
  const { matched } = hasDescriptorOverlap(targetTitle, parsed);
  const specMatches = Object.entries(targetTitle.attrs).filter(([k, vals]) =>
    parsed.attrs[k]?.some((v) => vals.includes(v))).length;
  const targetBrands = [...targetTitle.brands, ...targetTitle.impliedBrands];
  const candBrands = [...parsed.brands, ...parsed.impliedBrands];
  const brandMatch = Boolean(targetBrands.length && candBrands.length && areKnownBrandSetsCompatible(targetBrands, candBrands));
  const targetAnchor = target.anchorPriceToman;
  const cardPrice = result.candidate.priceToman;
  const plausiblePrice = !(targetAnchor && targetAnchor > 0 && cardPrice && cardPrice > 0) ||
    (cardPrice / targetAnchor >= 0.45 && cardPrice / targetAnchor <= 2.1);
  return plausiblePrice && (matched > 0 || (specMatches > 0 && brandMatch) || specMatches >= 2);
}

function scoreInspectionPriority(
  target: ProductMatchTarget,
  targetTitle: ParsedTitle,
  result: ScoredCandidateResult,
  meta: CandidateMeta | undefined,
  codeless: boolean,
  knownPrkSet: Set<string>,
  knownPrkHints?: Map<string, KnownPrkHint>,
): { priority: number; probe: boolean; highAlignment: boolean } {
  const probe = codeless && result.rejected && isSellerEvidenceProbeCandidate(target, targetTitle, result);
  const highAlignment = isHighAlignmentReviewCandidate(target, targetTitle, result);
  let score = 0;
  if (knownPrkSet.has(result.candidate.prk)) {
    const hint = knownPrkHints?.get(result.candidate.prk);
    if (hint && hint.identityStatus === "MATCH_CONFIRMED" && (hint.externalCompetitorCount ?? 0) >= 2) {
      score += 150;
    } else if (hint && hint.ownStorePresent && (hint.externalCompetitorCount ?? 0) === 0) {
      score += 95;
    } else {
      score += 120;
    }
  }
  if (result.status === "MATCH_CONFIRMED") score += 100;
  else if (result.titleState !== "present") score += 45;
  else if (!result.rejected) score += 55;
  else if (probe) score += 42;
  else return { priority: -100, probe: false, highAlignment: false };

  const parsed = result.parsed;
  if (parsed) {
    const desc = hasDescriptorOverlap(targetTitle, parsed);
    if (targetTitle.words.length > 0) {
      if (desc.matched > 0) score += 30 * desc.overlapRatio;
      else if (desc.unrelatedWords > 0) score -= 22;
    }
    const matchedSpecs = Object.entries(targetTitle.attrs).filter(([k, vals]) =>
      parsed.attrs[k]?.some((v) => vals.includes(v))).length;
    score += matchedSpecs * 12;
    const targetBrands = [...targetTitle.brands, ...targetTitle.impliedBrands];
    const candBrands = [...parsed.brands, ...parsed.impliedBrands];
    if (targetBrands.length && candBrands.length && areKnownBrandSetsCompatible(targetBrands, candBrands)) {
      score += 10;
    }
    // Incomplete-title corroboration bonus: shares class + descriptor/spec, zero conflicts, missing brand or spec.
    if (!result.rejected && result.status !== "MATCH_CONFIRMED" && !result.hasConflict &&
        (desc.matched > 0 || matchedSpecs > 0) &&
        ((targetBrands.length > 0 && !candBrands.length) ||
         Object.keys(targetTitle.attrs).some((k) => !parsed.attrs[k]?.length))) {
      score += 12;
    }
  }
  score += (result.rawScore ?? result.score) * 0.25;
  const anchor = target.anchorPriceToman;
  const price = result.candidate.priceToman;
  if (anchor && anchor > 0 && price && price > 0) {
    const r = price / anchor;
    if (r >= 0.55 && r <= 1.85) score += 6;
  }
  const distinctQueries = meta?.observations.length ?? 0;
  score += Math.min(9, distinctQueries * 3);
  score += Math.min(6, Math.log2((result.candidate.sellerCount ?? 1) + 1) * 2);
  return { priority: score, probe, highAlignment };
}

function titleBucketKey(card: TorobCandidateCard): string {
  const title = normalizeText(`${card.titleFa ?? ""} ${card.titleEn ?? ""}`);
  return title || `blank:${card.prk}`;
}

export async function resolveTorobSource(options: DiscoveryOptions): Promise<SourceResult> {
  const target: ProductMatchTarget = {
    productName: options.productName,
    sku: options.sku,
    anchorPriceToman: options.anchorPriceToman,
    rejectBelowPct: options.matchConfig?.rejectBelowPct,
    approveAbovePct: options.matchConfig?.approveAbovePct,
  };
  const targetTitle = parseTitle(target.productName, { sku: target.sku });
  const profile = decomposeTargetProduct(options.productName, options.sku);
  const codeless = profile.isCodeless;
  const mode = options.mode ?? options.matchConfig?.discoveryMode ?? "interactive";
  const budgets = resolveDiscoveryBudgets(mode, codeless, options.budgets);
  const knownPrkHints = new Map<string, KnownPrkHint>((options.knownPrkHints ?? []).map((h) => [h.prk, h]));
  const knownPrkSet = new Set([
    ...(options.cachedPrk ? [options.cachedPrk] : []),
    ...(options.knownPrks ?? []),
    ...(options.knownPrkHints ?? []).map((h) => h.prk),
  ]);
  const ownShopMatcher: OwnShopMatcher = makeOwnShopMatcher(
    options.matchConfig?.ownShopNames,
    options.matchConfig?.ownShopIds,
  );
  const singleFlightEnabled = options.matchConfig?.singleFlightEnabled !== false;
  const localInFlight = new Map<string, Promise<unknown>>();
  const singleFlight = <T>(kind: "search" | "details" | "similar" | "trend", key: string, fn: () => Promise<T>): Promise<T> => {
    if (options.cache && singleFlightEnabled) {
      return options.cache.runSingleFlight(kind, key, fn).promise;
    }
    const fullKey = `${kind}:${key}`;
    const existing = localInFlight.get(fullKey);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => {
      if (localInFlight.get(fullKey) === promise) localInFlight.delete(fullKey);
    });
    localInFlight.set(fullKey, promise);
    return promise;
  };
  const verifiedExternalOffers = (item: InspectedCard) =>
    resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted"
      ? item.offers.filter((offer) =>
          offer.torobIdentity?.status === "MATCH_CONFIRMED" &&
          !ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId }))
      : [];
  const verifiedOwnOffers = (item: InspectedCard) =>
    resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted"
      ? item.offers.filter((offer) =>
          offer.torobIdentity?.status === "MATCH_CONFIRMED" &&
          ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId }))
      : [];
  const buildItemPanelEvidence = (
    item: InspectedCard,
    role?: PanelGroupRole,
    selectionReason?: string | null,
    exclusionReason?: string | null,
  ): PanelCompetitiveEvidence => {
    const rawId = resolveIdentity(item);
    const identityStatus: PanelCompetitiveEvidence["identityStatus"] =
      rawId === "MATCH_CONFIRMED" || rawId === "IDENTITY_MISMATCH" ? rawId : "REVIEW_REQUIRED";
    const externalKeys = new Set<string>();
    const confirmedExternalKeys = new Set<string>();
    let ownStoreOfferCount = 0;
    let reviewRequiredCompetitorCount = 0;
    let rejectedCompetitorCount = 0;
    let freshExternalCount = 0;
    let newestMs = 0;
    const freshCutoffMs = options.now.getTime() - 7 * 86_400_000;
    item.offers.forEach((offer, idx) => {
      const isOwn = ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId });
      if (isOwn) {
        ownStoreOfferCount++;
        return;
      }
      const sk = `${compactShopKey(offer.shopId) || compactShopKey(offer.shopName) || `idx_${idx}`}|${offer.sellerType ?? "online"}`;
      externalKeys.add(sk);
      const changedMs = offer.lastChangedAt?.getTime() ?? 0;
      if (changedMs > newestMs) newestMs = changedMs;
      const isPricedValid = offer.price > 0 && offer.inStock !== false && !offer.isAd && !offer.priceUnreliable;
      if (identityStatus === "MATCH_CONFIRMED" && offer.torobIdentity?.status === "MATCH_CONFIRMED" && isPricedValid) {
        confirmedExternalKeys.add(sk);
        if (changedMs >= freshCutoffMs) freshExternalCount++;
      } else if (offer.torobIdentity?.status === "IDENTITY_MISMATCH") {
        rejectedCompetitorCount++;
      } else {
        reviewRequiredCompetitorCount++;
        if (isPricedValid && changedMs >= freshCutoffMs) freshExternalCount++;
      }
    });
    const reportedSellerCount = item.read.data?.totalSellerCount ?? item.result.candidate.sellerCount ?? null;
    const extractedOfferCount = item.offers.length;
    const offersTruncated = Boolean(
      item.read.data?.offersTruncated ||
      (reportedSellerCount != null && reportedSellerCount > extractedOfferCount),
    );
    const coverageStatus: PanelCoverageStatus =
      item.read.blocked || item.extraction === "unavailable" ? "unavailable"
      : item.extraction === "incomplete" ? "uncertain"
      : offersTruncated ? "partial"
      : "complete_within_scope";
    const metaInfo = candidates.get(item.result.candidate.prk);
    const discoveringQueries = metaInfo
      ? [...new Set(metaInfo.observations.map((o) => search.queries[o.query - 1]?.query).filter((q): q is string => Boolean(q)))]
      : [];
    const evidenceSources: string[] = [];
    if (item.result.titleState === "present") evidenceSources.push(item.origin ?? "card_title");
    if (item.result.candidate.specs?.length) evidenceSources.push("card_specs");
    if (item.sellerCorroborated) evidenceSources.push("seller_corroboration");
    if (item.adminConfirmed) evidenceSources.push("admin_confirmation");
    return {
      prk: item.result.candidate.prk,
      identityStatus,
      title: item.result.candidate.titleFa || item.result.candidate.titleEn || item.sellerTitle || null,
      url: torobProductUrl(item.result.candidate.prk),
      matchConfidence: Math.max(0, Math.min(1, (item.result.score ?? 0) / 100)),
      score: item.result.score,
      reportedSellerCount,
      extractedOfferCount,
      ownStoreOfferCount,
      uniqueExternalSellerCount: externalKeys.size,
      confirmedCompetitorCount: confirmedExternalKeys.size,
      reviewRequiredCompetitorCount,
      rejectedCompetitorCount,
      offersTruncated,
      coverageStatus,
      ...(role ? { groupRole: role } : {}),
      freshness: newestMs > 0 ? new Date(newestMs).toISOString() : null,
      freshExternalCount,
      discoveringQueries,
      evidenceSources,
      ...(selectionReason !== undefined ? { selectionReason } : {}),
      ...(exclusionReason !== undefined ? { exclusionReason } : {}),
    };
  };

  const search: TorobSearchTrace = { queries: [], candidates: [], accepted: 0, eligible: 0 };
  const candidates = new Map<string, CandidateMeta>();
  const inspected: InspectedCard[] = [];
  const inspectedPrks = new Set<string>();
  const priorityMap = new Map<string, number>();
  let ranked: ScoredCandidateResult[] = [];
  let aiIdentityCheck: Awaited<ReturnType<typeof verifyTorobMatchesWithAI>> = null;

  let apiRequestsMade = 0;
  let cacheHits = 0;
  let similarProbesExecuted = 0;
  let searchDurationMs = 0;
  let verifyDurationMs = 0;
  let budgetExhaustedReason: TorobCoverageDiagnostics["budgetExhaustedReason"] = "none";
  let stoppingReason: TorobStoppingReason = options.prk ? "direct_prk_lookup" : "scope_completed";
  let searchResponseTruncated = false;
  let completedSearch = false;
  let unavailable = false;
  let extractionIssue = false;
  let accessRestricted = false;
  let explanation = "هیچ کارت قابل استعلامی از جستجوی ترب دریافت نشد";

  const sortModesUsed = new Set<string>();
  const categoriesUsed = new Set<string>();
  const streamLastPage = new Map<string, { page: number; hasNextPage: boolean; query: string; sort?: TorobSearchSort; category?: string; promisingYield: number; totalMatches: number | null; rows: number }>();
  const executedKeys = new Set<string>();
  const executedNormalizedQueries = new Set<string>();
  const observedSuggestedQueries = new Set<string>();
  const discoveredCategories: { id: string; title: string }[] = [];

  const trackSearch = (coverage?: TorobCoverageDiagnostics) => {
    search.candidates = ranked.map((result) => {
      const observations = candidates.get(result.candidate.prk)?.observations ?? [];
      const item = inspected.find((entry) => entry.result.candidate.prk === result.candidate.prk);
      const trace = candidateTrace(result, item?.extraction ?? "not_requested", observations.map(({ query }) => query), priorityMap.get(result.candidate.prk));
      if (item) {
        const { status, reasons, titleFa, titleEn, specs, imageUrls } = candidateTrace(item.result, item.extraction, []);
        trace.inspection = { status, reasons, titleFa, titleEn, specs, imageUrls, origin: item.read.origin };
      }
      return { ...trace, observations };
    });
    for (const item of inspected) {
      if (!candidates.has(item.result.candidate.prk)) {
        search.candidates.push({ ...candidateTrace(item.result, item.extraction, [], priorityMap.get(item.result.candidate.prk)), origin: item.read.origin });
      }
    }
    search.accepted = ranked.filter((result) => result.status === "MATCH_CONFIRMED").length;
    search.eligible = ranked.filter((result) => result.status === "MATCH_CONFIRMED" || result.status === "REVIEW_REQUIRED").length;
    if (coverage) search.coverage = coverage;
    return search.queries.length ? search : undefined;
  };

  const meta = () => ({
    via: options.via,
    searchQueries: search.queries.map(({ query, mapped, issue }) => ({ query, cards: mapped, ...(issue ? { error: issue } : {}) })),
    ...(aiIdentityCheck ? { aiIdentityCheck } : {}),
  });

  const buildCoverage = (
    statusOverride?: TorobCoverageStatus,
    offers?: RawOffer[],
    sellerTruncated = false,
  ): TorobCoverageDiagnostics => {
    const pagesRemaining = [...streamLastPage.values()].filter((s) => s.hasNextPage).length;
    const uninspected = ranked.filter((r) => !inspectedPrks.has(r.candidate.prk));
    const promisingUninspectedCount = uninspected.filter((r) => {
      const p = scoreInspectionPriority(target, targetTitle, r, candidates.get(r.candidate.prk), codeless, knownPrkSet, knownPrkHints);
      return p.highAlignment || p.probe;
    }).length;
    const evaluatedOffers = offers ?? inspected.flatMap((i) => i.offers);
    const confirmedSellerListings = evaluatedOffers.filter((o) => o.torobIdentity?.status === "MATCH_CONFIRMED").length;
    const reviewRequiredSellerListings = evaluatedOffers.filter((o) => !o.torobIdentity || o.torobIdentity.status === "REVIEW_REQUIRED").length;
    const rejectedSellerListings = evaluatedOffers.filter((o) => o.torobIdentity?.status === "IDENTITY_MISMATCH").length;
    const totalCalls = apiRequestsMade + cacheHits;
    const cacheHitRate = totalCalls > 0 ? Math.round((cacheHits / totalCalls) * 1000) / 1000 : 0;
    const limitations: string[] = [];
    if (accessRestricted) limitations.push("دسترسی به ترب محدود یا با چالش امنیتی متوقف شد");
    if (unavailable) limitations.push("بعضی درخواست‌های ترب با قطعی یا عدم دسترسی مواجه شدند");
    if (budgetExhaustedReason !== "none") limitations.push(`محدودیت بودجهٔ استعلام (${budgetExhaustedReason}) باعث توقف پیش از پایان کامل شد`);
    if (pagesRemaining > 0) limitations.push(`${pagesRemaining} صفحهٔ بعدی جست‌وجو بررسی نشد`);
    if (promisingUninspectedCount > 0) limitations.push(`${promisingUninspectedCount} کارت بالقوه مرتبط بدون استعلام جزئیات باقی ماند`);
    if (sellerTruncated) limitations.push("فهرست فروشندگان یک یا چند کارت توسط ترب برش خورده است");
    if (searchResponseTruncated) limitations.push("تعداد نتایج صفحهٔ جست‌وجو بیش از سقف دریافت در یک صفحه بود");

    let status: TorobCoverageStatus = statusOverride ?? "complete_within_scope";
    if (!statusOverride) {
      if (accessRestricted || (unavailable && search.queries.length === 0 && !options.prk)) {
        status = "unavailable";
      } else if (
        budgetExhaustedReason !== "none" ||
        pagesRemaining > 0 ||
        promisingUninspectedCount > 0 ||
        sellerTruncated ||
        searchResponseTruncated ||
        unavailable
      ) {
        status = "partial";
      } else if (
        (search.queries.length === 0 && Boolean(options.prk)) ||
        (reviewRequiredSellerListings > 0 && confirmedSellerListings === 0) ||
        inspected.some((i) => i.extraction === "incomplete" || i.extraction === "unavailable")
      ) {
        status = "uncertain";
      } else {
        status = "complete_within_scope";
      }
    }

    return {
      mode,
      status,
      stoppingReason,
      budgetExhaustedReason,
      queriesGenerated: queryPlan.length,
      queriesExecuted: search.queries.filter((q) => q.rows != null || q.cached).length,
      pagesRequested: search.queries.length,
      pagesRemaining,
      sortModesUsed: [...sortModesUsed],
      categoriesUsed: [...categoriesUsed],
      similarProbesExecuted,
      uniquePrksDiscovered: candidates.size,
      candidatePrksInspected: inspected.length,
      candidatePrksNotInspected: Math.max(0, candidates.size - inspected.length),
      promisingUninspectedCount,
      sellerListingsExtracted: evaluatedOffers.length,
      confirmedSellerListings,
      reviewRequiredSellerListings,
      rejectedSellerListings,
      apiRequestsMade,
      cacheHits,
      cacheHitRate,
      searchDurationMs,
      verifyDurationMs,
      searchResponseTruncated,
      sellerOffersTruncated: sellerTruncated,
      sourceUnavailable: unavailable,
      accessRestricted,
      limitations,
    };
  };

  const fail = (status: TorobSourceAssessment["status"], reason: string, extraMeta: Record<string, unknown> = {}): SourceResult => {
    const coverage = buildCoverage(status === "SOURCE_UNAVAILABLE" ? "unavailable" : undefined, []);
    return {
      source: "torob",
      prk: options.prk,
      offers: [],
      totalSellerCount: 0,
      fetchedAt: options.now,
      ok: false,
      error: reason,
      torob: {
        status,
        reason,
        sellerRows: null,
        reportedSellers: null,
        search: trackSearch(coverage),
        coverage,
        ...(status === "IDENTITY_MISMATCH" || status === "REVIEW_REQUIRED" ? { identityStatus: status } : {}),
      },
      meta: { ...meta(), coverage, ...extraMeta },
    };
  };

  const queryPlan = options.prk ? [] : buildSearchQueryPlan(options.productName, options.sku);
  let searchRequestsUsed = 0;
  let searchTimeLeft = budgets.searchBudgetMs;

  const isDuplicateSearchFailure = () => {
    if (search.queries.length < 2) return false;
    const prev = search.queries[search.queries.length - 1];
    const curr = search.queries[search.queries.length - 2];
    return Boolean(prev.issue && curr.issue && prev.rows == null && curr.rows == null);
  };

  const ingestCards = (decoded: DecodedTorobSearch, queryIdx: number, searchKeyStr: string): { newPrks: number; newPromising: number } => {
    let newPrks = 0;
    let newPromising = 0;
    for (const card of decoded.candidates) {
      const existing = candidates.get(card.prk);
      const titleFa = card.titleFa || null;
      const titleEn = card.titleEn || null;
      const observations = existing?.observations ?? [];
      if (!observations.some((item) => item.query === queryIdx && item.titleFa === titleFa && item.titleEn === titleEn)) {
        observations.push({ query: queryIdx, titleFa, titleEn });
      }
      const searchKeys = existing?.searchKeys ?? new Set<string>();
      searchKeys.add(searchKeyStr);
      const merged = existing ? mergeCards(target, existing.card, card) : card;
      candidates.set(card.prk, { card: merged, observations, searchKeys });
      if (!existing) {
        newPrks++;
        const scored = evaluateTorobCandidate(target, merged);
        if (isHighAlignmentReviewCandidate(target, targetTitle, scored) ||
            (codeless && isSellerEvidenceProbeCandidate(target, targetTitle, scored))) {
          newPromising++;
        }
      }
    }
    return { newPrks, newPromising };
  };

  const executeSearchAction = async (
    action: QueuedSearchAction,
    deadline: number,
  ): Promise<{ blocked?: boolean; challenged?: boolean; abortedBudget?: boolean; decoded?: DecodedTorobSearch; newPromising: number }> => {
    if (searchRequestsUsed >= budgets.maxSearchRequests) {
      budgetExhaustedReason = "search_requests";
      stoppingReason = "request_budget";
      return { abortedBudget: true, newPromising: 0 };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      budgetExhaustedReason = "search_time";
      stoppingReason = "time_budget";
      search.queries.push({
        query: action.req.query,
        rows: null,
        mapped: 0,
        issue: "search_budget",
        page: action.req.page ?? 1,
        sort: action.req.sort ?? "popularity",
        ...(action.req.category ? { category: action.req.category } : {}),
        strategy: action.strategy,
      });
      return { abortedBudget: true, newPromising: 0 };
    }

    const req: TorobSearchRequest = { sort: "popularity", page: 1, ...action.req };
    const key = searchCacheKey(req);
    if (executedKeys.has(key)) return { newPromising: 0 };
    executedKeys.add(key);
    executedNormalizedQueries.add(normalizeText(req.query));
    sortModesUsed.add(req.sort ?? "popularity");
    if (req.category) categoriesUsed.add(req.category);

    searchRequestsUsed++;
    const cachedRead = options.cache?.getSearch(key, options.now.getTime());
    let read: TorobRead<unknown>;
    let isCached = false;
    if (cachedRead) {
      read = cachedRead;
      isCached = true;
      cacheHits++;
    } else {
      apiRequestsMade++;
      read = await singleFlight("search", key, () => options.search(req, Math.min(remaining, budgets.searchTimeoutMs)));
    }

    const decoded = read.data === undefined ? null : decodeTorobSearch(read.data, req.limit, req.page ?? 1);
    const issue = read.issue ?? decoded?.issue;
    if (!isCached && options.cache && decoded && !issue && !read.blocked && !read.unavailable) {
      options.cache.setSearch(key, read, decoded.candidates.length === 0, options.now.getTime());
    }

    if (read.blocked) {
      accessRestricted = true;
      stoppingReason = "access_restricted";
      search.queries.push({
        query: req.query,
        rows: decoded?.rows ?? null,
        mapped: decoded?.candidates.length ?? 0,
        issue,
        origin: read.origin,
        page: req.page,
        sort: req.sort,
        ...(req.category ? { category: req.category } : {}),
        strategy: action.strategy,
        cached: isCached,
      });
      return { blocked: true, challenged: read.challenged, newPromising: 0 };
    }

    unavailable ||= Boolean(read.unavailable);
    extractionIssue ||= Boolean(decoded?.issue || (issue && !read.unavailable));
    completedSearch ||= decoded?.rows != null;
    if (decoded?.truncated) searchResponseTruncated = true;

    const queryIdx = search.queries.length + 1;
    const yieldCounts = decoded ? ingestCards(decoded, queryIdx, action.streamKey) : { newPrks: 0, newPromising: 0 };
    search.queries.push({
      query: req.query,
      rows: decoded?.rows ?? null,
      mapped: decoded?.candidates.length ?? 0,
      issue,
      origin: read.origin,
      page: req.page,
      sort: req.sort,
      ...(req.category ? { category: req.category } : {}),
      strategy: action.strategy,
      hasNextPage: decoded?.hasNextPage,
      totalMatches: decoded?.totalMatches,
      newPrks: yieldCounts.newPrks,
      cached: isCached,
    });

    if (decoded) {
      for (const s of decoded.suggestedQueries) observedSuggestedQueries.add(s);
      for (const cat of decoded.suggestedCategories) {
        if (!discoveredCategories.some((existing) => existing.id === cat.id)) discoveredCategories.push(cat);
      }
      const prevStream = streamLastPage.get(action.streamKey);
      streamLastPage.set(action.streamKey, {
        page: req.page ?? 1,
        hasNextPage: decoded.hasNextPage,
        query: req.query,
        sort: req.sort,
        category: req.category,
        promisingYield: (prevStream?.promisingYield ?? 0) + yieldCounts.newPromising,
        totalMatches: decoded.totalMatches,
        rows: decoded.rows ?? 0,
      });
    }

    return { decoded: decoded ?? undefined, newPromising: yieldCounts.newPromising };
  };

  const recomputeRanking = () => {
    const outcome = selectBestTorobSearchMatch(target, [...candidates.values()].map(({ card }) => card), options.matchConfig?.minSellerCount);
    ranked = outcome.allRanked;
    explanation = outcome.explanation;
    for (const r of ranked) {
      const p = scoreInspectionPriority(target, targetTitle, r, candidates.get(r.candidate.prk), codeless, knownPrkSet, knownPrkHints);
      priorityMap.set(r.candidate.prk, p.priority);
    }
    return outcome;
  };

  const toAction = (planned: PlannedSearchQuery): QueuedSearchAction => ({
    req: { query: planned.query, limit: ROW_LIMIT, page: 1, sort: "popularity" },
    strategy: planned.strategy,
    priority: planned.priority,
    streamKey: `${normalizeText(planned.query)}|popularity|`,
  });

  const buildExpansionActions = (): QueuedSearchAction[] => {
    const actions: QueuedSearchAction[] = [];
    const expandExecutedCount = search.queries.filter((q) =>
      q.strategy && ["alternative_wording", "vocabulary_expansion", "broad_fallback"].includes(q.strategy)).length;
    const phase2ExecCount = Math.max(0, search.queries.length - fastQueries.length);
    const paginationExecutedCount = search.queries.filter((q) => q.strategy === "pagination").length;
    const sellersSortExecuted = sortModesUsed.has("sellers");

    // 1. Diversified planned expansion queries (alternative wording, brandless tech, Persian brands).
    let boostedAlt = false;
    let boostedBrand = false;
    for (const planned of queryPlan) {
      const action = toAction(planned);
      if (!executedKeys.has(searchCacheKey({ page: 1, sort: "popularity", ...action.req }))) {
        let priority = action.priority;
        if (planned.phase === "expand" && expandExecutedCount === 0 && !boostedAlt && planned.strategy === "alternative_wording") {
          priority = 94;
          boostedAlt = true;
        } else if (planned.phase === "expand" && !boostedBrand && planned.strategy === "brand" && phase2ExecCount > 0) {
          priority = 89;
          boostedBrand = true;
        }
        actions.push({ ...action, priority });
      }
    }
    // 2. Vocabulary expansions from Torob suggestions and high-alignment observed titles.
    const highAlignTitles = ranked
      .filter((r) => isHighAlignmentReviewCandidate(target, targetTitle, r))
      .slice(0, 6)
      .map((r) => `${r.candidate.titleFa ?? ""} ${r.candidate.titleEn ?? ""}`.trim());
    const vocabExpansions = mode === "extended" || ranked.filter((r) => !r.rejected).length <= 1
      ? extractVocabularyExpansions(
          profile,
          highAlignTitles,
          [...observedSuggestedQueries],
          executedNormalizedQueries,
          2,
        )
      : [];
    for (const planned of vocabExpansions) {
      actions.push(toAction(planned));
    }
    // 3. Selective page-2/3 retrieval balanced against query & sort diversity.
    const paginatable = [...streamLastPage.entries()]
      .filter(([, stream]) => stream.hasNextPage && stream.page < budgets.maxPagesPerQuery)
      .sort((a, b) => b[1].promisingYield - a[1].promisingYield || (b[1].totalMatches ?? 0) - (a[1].totalMatches ?? 0));
    paginatable.slice(0, 2).forEach(([streamKey, stream], idx) => {
      const nextPage = stream.page + 1;
      const req: TorobSearchRequest = { query: stream.query, limit: ROW_LIMIT, page: nextPage, sort: stream.sort ?? "popularity", category: stream.category };
      if (!executedKeys.has(searchCacheKey(req))) {
        const yieldBoost = Math.min(1, stream.promisingYield);
        const basePrio = nextPage === 2 && idx === 0 && paginationExecutedCount === 0
          ? 91
          : nextPage === 2
            ? Math.max(76, 85 - paginationExecutedCount * 4)
            : Math.max(70, (mode === "extended" ? 82 : 74) - paginationExecutedCount * 3);
        const lowYieldPenalty = nextPage > 2 && stream.promisingYield === 0 ? 6 : 0;
        actions.push({ req, strategy: "pagination", priority: basePrio + yieldBoost - lowYieldPenalty, streamKey });
      }
    });
    // 4. Alternative sort modes (sellers & price) when top popularity stream has overflow / many results.
    const richStream = [...streamLastPage.values()]
      .filter((s) => (s.sort ?? "popularity") === "popularity" && !s.category &&
        (s.page > 1 || s.hasNextPage || (s.totalMatches ?? 0) > ROW_LIMIT || s.rows >= ROW_LIMIT))
      .sort((a, b) => b.promisingYield - a.promisingYield)[0];
    if (richStream) {
      for (const [sort, strategy, prio] of [
        ["sellers", "sort_sellers", sellersSortExecuted ? 78 : 93] as const,
        ["price", "sort_price", 82] as const,
      ]) {
        const req: TorobSearchRequest = { query: richStream.query, limit: ROW_LIMIT, page: 1, sort };
        if (!executedKeys.has(searchCacheKey(req))) {
          actions.push({ req, strategy, priority: prio, streamKey: `${normalizeText(richStream.query)}|${sort}|` });
        }
      }
    }
    // 5. Category-restricted search when unfiltered broad searches suffer heavy class/off-domain noise.
    if (discoveredCategories.length && ranked.length >= 10) {
      const classMismatchCount = ranked.filter((r) =>
        (targetTitle.head && r.parsed?.head && r.parsed.head.cls !== targetTitle.head.cls) ||
        (targetTitle.head && !r.parsed?.head && r.rejected),
      ).length;
      if (classMismatchCount >= 4 && classMismatchCount / ranked.length >= 0.35) {
        const bestCat = discoveredCategories.find((c) => {
          const catParsed = parseTitle(c.title);
          return !targetTitle.head || !catParsed.head || catParsed.head.cls === targetTitle.head.cls;
        }) ?? discoveredCategories[0];
        const baseQuery = queryPlan[1]?.query ?? queryPlan[0]?.query;
        if (bestCat && baseQuery) {
          const req: TorobSearchRequest = { query: baseQuery, limit: ROW_LIMIT, page: 1, sort: "popularity", category: bestCat.id };
          if (!executedKeys.has(searchCacheKey(req))) {
            actions.push({ req, strategy: "category", priority: 95, streamKey: `${normalizeText(baseQuery)}|popularity|${bestCat.id}` });
          }
        }
      }
    }
    return actions.sort((a, b) => b.priority - a.priority);
  };

  let fastIdx = 0;
  const fastQueries = queryPlan.filter((q) => q.phase === "fast");

  const runSearchPhase = async (allowEarlyConsolidationStop: boolean): Promise<SourceResult | undefined> => {
    const searchStart = Date.now();
    const deadline = searchStart + searchTimeLeft;
    try {
      // Phase 1: Fast discovery.
      while (fastIdx < fastQueries.length) {
        // When a previous request failed with a transient error and no results were returned yet,
        // execute sequentially to avoid fanning out into an unavailable endpoint.
        const lastFailed = search.queries.length > 0 && search.queries[search.queries.length - 1].rows == null;
        const waveSize = (allowEarlyConsolidationStop || lastFailed || candidates.size === 0)
          ? 1
          : Math.min(budgets.searchConcurrency, fastQueries.length - fastIdx);
        const batch = fastQueries.slice(fastIdx, fastIdx + waveSize).map(toAction);
        fastIdx += waveSize;
        const outcomes = await Promise.all(batch.map((action) => executeSearchAction(action, deadline)));
        const blocked = outcomes.find((o) => o.blocked);
        if (blocked) return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: blocked.challenged, accessRestricted: true });
        const bestOutcome = recomputeRanking();
        if (outcomes.some((o) => o.abortedBudget)) break;

        if (allowEarlyConsolidationStop && mode === "interactive" && bestOutcome.confident && bestOutcome.best) {
          const bestCard = bestOutcome.best.candidate;
          const bestCodeRel = bestOutcome.best.codeRelation;
          const bestHint = knownPrkHints.get(bestCard.prk);
          const knownSelfOnly = Boolean(bestHint && bestHint.ownStorePresent && (bestHint.externalCompetitorCount ?? 0) === 0);
          const otherPromising = ranked.some((r) => r.candidate.prk !== bestCard.prk && (!r.rejected || isSellerEvidenceProbeCandidate(target, targetTitle, r)));
          const lastDecoded = outcomes.find((o) => o.decoded)?.decoded;
          const hasExpansionSignals =
            Boolean(options.matchConfig?.preferBroadDiscovery) ||
            knownSelfOnly ||
            (bestCard.sellerCount ?? 1) <= 3 ||
            otherPromising ||
            Boolean(lastDecoded?.hasNextPage) ||
            (lastDecoded?.rows ?? 0) >= ROW_LIMIT ||
            (bestCodeRel !== "equal" && bestCodeRel !== "alias");
          if (!hasExpansionSignals) {
            stoppingReason = "confirmed_consolidated";
            return undefined;
          }
        }
        if (isDuplicateSearchFailure() && candidates.size === 0 && fastIdx >= fastQueries.length) break;
      }

      // Phase 2: Selective adaptive expansion when signals show additional PRKs may exist.
      const bestOutcome = recomputeRanking();
      const confirmedCards = ranked.filter((r) => r.status === "MATCH_CONFIRMED");
      const fragmentedConfirmed = confirmedCards.some((r) =>
        (r.candidate.sellerCount ?? 1) <= 2 ||
        Boolean(knownPrkHints.get(r.candidate.prk)?.ownStorePresent && (knownPrkHints.get(r.candidate.prk)?.externalCompetitorCount ?? 0) === 0));
      const needsExpansion =
        budgetExhaustedReason === "none" &&
        (codeless ||
          mode === "extended" ||
          Boolean(options.matchConfig?.preferBroadDiscovery) ||
          !bestOutcome.confident ||
          fragmentedConfirmed ||
          ranked.some((r) => !r.rejected && r.status !== "MATCH_CONFIRMED") ||
          [...streamLastPage.values()].some((s) => s.hasNextPage));

      if (!needsExpansion) return undefined;
      if (bestOutcome.confident && candidates.size > 0 && fastQueries.length <= 3 && !codeless && !fragmentedConfirmed &&
          ![...streamLastPage.values()].some((s) => s.hasNextPage)) {
        return undefined;
      }

      let zeroGainStreak = 0;
      const triedStrategies = new Set<string>();
      const fragmentedCandidateSignal = confirmedCards.some((r) => (r.candidate.sellerCount ?? 1) <= 2);
      const reserveSimilarSearchSlot = Boolean(
        inspected.length === 0 &&
        !options.prk &&
        options.similar &&
        budgets.maxSearchRequests >= 8 &&
        similarProbesExecuted === 0 &&
        (codeless || fragmentedCandidateSignal),
      );
      const loopSearchCap = reserveSimilarSearchSlot ? budgets.maxSearchRequests - 1 : budgets.maxSearchRequests;
      while (budgetExhaustedReason === "none" && searchRequestsUsed < loopSearchCap && deadline - Date.now() > 0) {
        const queue = buildExpansionActions();
        if (!queue.length) break;
        const batch = queue.slice(0, Math.min(budgets.searchConcurrency, loopSearchCap - searchRequestsUsed));
        const outcomes = await Promise.all(batch.map((action) => executeSearchAction(action, deadline)));
        const blocked = outcomes.find((o) => o.blocked);
        if (blocked) return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: blocked.challenged, accessRestricted: true });
        recomputeRanking();
        if (outcomes.some((o) => o.abortedBudget)) break;
        batch.forEach((a) => triedStrategies.add(a.strategy));
        const gainedPromising = outcomes.reduce((sum, o) => sum + o.newPromising, 0);
        if (gainedPromising === 0) {
          zeroGainStreak++;
          const moreDiverseLeft = queue.slice(batch.length).some((a) => !triedStrategies.has(a.strategy));
          if (zeroGainStreak >= 2 && !moreDiverseLeft) {
            stoppingReason = "plateau";
            break;
          }
        } else {
          zeroGainStreak = 0;
        }
      }
      if (!reserveSimilarSearchSlot && searchRequestsUsed >= budgets.maxSearchRequests && budgetExhaustedReason === "none") {
        // Only mark request_budget exhausted if expansion actions still remain.
        if (buildExpansionActions().length > 0) {
          budgetExhaustedReason = "search_requests";
          stoppingReason = "request_budget";
        }
      }
    } finally {
      const elapsed = Date.now() - searchStart;
      searchDurationMs += elapsed;
      searchTimeLeft = Math.max(0, searchTimeLeft - elapsed);
    }
    return undefined;
  };

  if (!options.prk) {
    const searchFailure = await runSearchPhase(!codeless);
    if (searchFailure) return searchFailure;
  }

  const buildInspectionOrder = (detailCapOverride?: number): { cards: TorobCandidateCard[]; hasHighPriorityLeft: (inspectedSet: Set<string>) => boolean } => {
    if (options.prk) {
      return {
        cards: [{ prk: options.prk, titleFa: "", detailsUrl: options.detailsUrl }],
        hasHighPriorityLeft: () => false,
      };
    }
    const remaining = ranked.filter((result) => !inspectedPrks.has(result.candidate.prk));
    const scored = remaining
      .map((result) => ({
        result,
        ...scoreInspectionPriority(target, targetTitle, result, candidates.get(result.candidate.prk), codeless, knownPrkSet, knownPrkHints),
      }))
      .filter((item) => item.priority > -50)
      .sort((a, b) => b.priority - a.priority);

    const picked = new Set<string>();
    const shortlist: TorobCandidateCard[] = [];
    const bucketCounts = new Map<string, number>();
    const coveredStreams = new Set<string>();

    const addCard = (card: TorobCandidateCard, respectBucket: boolean): boolean => {
      if (picked.has(card.prk)) return false;
      const bucket = titleBucketKey(card);
      const count = bucketCounts.get(bucket) ?? 0;
      if (respectBucket && count >= budgets.maxPerTitleBucket) return false;
      picked.add(card.prk);
      bucketCounts.set(bucket, count + 1);
      shortlist.push(card);
      const streams = candidates.get(card.prk)?.searchKeys;
      if (streams) {
        for (const s of streams) coveredStreams.add(s);
      }
      return true;
    };

    // 1. Known PRKs (cached hints) first.
    for (const prk of knownPrkSet) {
      if (inspectedPrks.has(prk)) continue;
      const known = candidates.get(prk)?.card ?? { prk, titleFa: "", detailsUrl: options.detailsUrl };
      addCard(known, false);
    }
    // 2. All MATCH_CONFIRMED candidates (never starved).
    for (const item of scored) {
      if (item.result.status === "MATCH_CONFIRMED") addCard(item.result.candidate, false);
    }
    // 3. Reserve up to 2 probe slots for high-relevance quantity-label / seller-evidence probes.
    let probeCount = 0;
    for (const item of scored) {
      if (probeCount >= 2) break;
      if (item.probe && item.priority >= 115 && addCard(item.result.candidate, true)) probeCount++;
    }
    // 4a. Top-tier high-alignment candidates within 22 pts of best remaining so far-weaker stream outliers don't jump ahead.
    const topUnpickedHigh = scored.find((item) => !picked.has(item.result.candidate.prk) && item.highAlignment)?.priority ?? 0;
    for (const item of scored) {
      if (item.highAlignment && item.priority >= topUnpickedHigh - 22) {
        addCard(item.result.candidate, true);
      }
    }
    // 4b. Query-diversity pass: ensure strong remaining candidates across uncovered search/page/sort streams get represented.
    const topDiverseBase = scored.find((item) => !picked.has(item.result.candidate.prk) && item.highAlignment)?.priority ?? 0;
    for (const item of scored) {
      if (!item.highAlignment || item.priority < topDiverseBase - 35) continue;
      const streams = candidates.get(item.result.candidate.prk)?.searchKeys;
      if (streams && [...streams].some((s) => !coveredStreams.has(s))) {
        addCard(item.result.candidate, true);
      }
    }
    // 5. Remaining high-alignment and reviewable candidates respecting duplicate-title diversity cap.
    for (const item of scored) addCard(item.result.candidate, true);
    // 6. Overflow pass only if space remains after diverse pass.
    for (const item of scored) addCard(item.result.candidate, false);

    const highPriorityPrks = new Set(
      scored.filter((s) => s.result.status === "MATCH_CONFIRMED" || (s.probe && s.priority >= 115) || s.highAlignment || knownPrkSet.has(s.result.candidate.prk))
        .map((s) => s.result.candidate.prk),
    );
    const effectiveCap = detailCapOverride ?? budgets.maxDetails;
    return {
      cards: shortlist.slice(0, Math.max(0, effectiveCap - inspected.length)),
      hasHighPriorityLeft: (doneSet: Set<string>) => [...highPriorityPrks].some((prk) => !doneSet.has(prk)),
    };
  };

  const reserveDetailSlotForSimilar = Boolean(
    !options.prk &&
    options.similar &&
    budgets.maxDetails >= 6 &&
    budgets.maxSearchRequests >= 8 &&
    candidates.size > budgets.maxDetails &&
    ranked.some((r) => !r.rejected && ((r.candidate.sellerCount ?? 1) <= 2 || Boolean(knownPrkHints.get(r.candidate.prk)?.ownStorePresent))),
  );
  const initialPlan = buildInspectionOrder(reserveDetailSlotForSimilar ? budgets.maxDetails - 1 : budgets.maxDetails);
  if (!initialPlan.cards.length) {
    if (extractionIssue) return fail("EXTRACTION_INCOMPLETE", "ساختار بعضی پاسخ‌ها یا شناسه‌های کارت ترب قابل استخراج نبود");
    if (!completedSearch && unavailable) return fail("SOURCE_UNAVAILABLE", "پاسخی از جستجوی ترب دریافت نشد");
    if (ranked.length && !search.queries.some(({ issue }) => issue)) {
      return fail("IDENTITY_MISMATCH", explanation, { rejectedInSearch: true });
    }
    return fail("REVIEW_REQUIRED", "کارت قابل بررسی در محدودهٔ جستجوی انجام‌شده پیدا نشد");
  }

  const verifyStart = Date.now();
  const detailsDeadline = verifyStart + budgets.detailsBudgetMs;

  const inspectOne = async (card: TorobCandidateCard): Promise<InspectedCard | undefined> => {
    if (inspectedPrks.has(card.prk)) return undefined;
    const remaining = detailsDeadline - Date.now();
    if (remaining <= 0) {
      if (budgetExhaustedReason === "none") budgetExhaustedReason = "details_time";
      stoppingReason = "time_budget";
      return undefined;
    }
    if (inspectedPrks.size >= budgets.maxDetails) {
      if (budgetExhaustedReason === "none") budgetExhaustedReason = "details_requests";
      stoppingReason = "request_budget";
      return undefined;
    }
    inspectedPrks.add(card.prk);
    const cacheKey = detailsCacheKey(card);
    const cachedDetail = options.cache?.getDetails(cacheKey, options.now.getTime());
    let read: TorobRead<TorobDetailsData>;
    if (cachedDetail) {
      read = cachedDetail;
      cacheHits++;
    } else {
      apiRequestsMade++;
      read = await singleFlight("details", cacheKey, () => options.details(card, Math.min(remaining, budgets.detailsTimeoutMs)));
      if (options.cache && !read.blocked && !read.unavailable && !read.issue && read.data) {
        options.cache.setDetails(cacheKey, read, options.now.getTime());
      }
    }
    const item = inspectDetails(target, targetTitle, card, read, options.confirmation, candidates.get(card.prk)?.observations);
    inspected.push(item);
    return item;
  };

  const verifiedOffers = (item: InspectedCard) =>
    resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted"
      ? item.offers.filter((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED")
      : [];

  const inspectShortlist = async (plan: ReturnType<typeof buildInspectionOrder>) => {
    let lowTierNoGainBatches = 0;
    for (let i = 0; i < plan.cards.length; i += budgets.detailsConcurrency) {
      if (inspected.length >= budgets.maxDetails || detailsDeadline - Date.now() <= 0) {
        if (detailsDeadline - Date.now() <= 0 && budgetExhaustedReason === "none") {
          budgetExhaustedReason = "details_time";
          stoppingReason = "time_budget";
        } else if (inspected.length >= budgets.maxDetails && budgetExhaustedReason === "none") {
          budgetExhaustedReason = "details_requests";
          stoppingReason = "request_budget";
        }
        break;
      }
      const batchCards = plan.cards.slice(i, i + Math.min(budgets.detailsConcurrency, budgets.maxDetails - inspected.length));
      const results = (await Promise.all(batchCards.map(inspectOne))).filter((x): x is InspectedCard => Boolean(x));
      if (results.some((item) => item.read.blocked)) {
        accessRestricted = true;
        stoppingReason = "access_restricted";
        break;
      }
      if (!results.length) break;
      const anyConfirmedExternalOffers = inspected.some((item) => verifiedExternalOffers(item).length > 0);
      const batchYieldedRelevant = results.some((item) =>
        verifiedExternalOffers(item).length > 0 || item.offers.some((o) =>
          o.torobIdentity?.status === "REVIEW_REQUIRED" && !ownShopMatcher({ shopName: o.shopName, shopId: o.shopId })));
      if (anyConfirmedExternalOffers && !plan.hasHighPriorityLeft(inspectedPrks)) {
        lowTierNoGainBatches = batchYieldedRelevant ? 0 : lowTierNoGainBatches + 1;
        if (lowTierNoGainBatches >= 2) {
          stoppingReason = "plateau";
          break;
        }
      }
    }
  };

  await inspectShortlist(initialPlan);

  // Similar-product discovery when confirmed or self-only card is fragmented (few external sellers) and budgets permit.
  if (
    !options.prk &&
    options.similar &&
    !accessRestricted &&
    budgetExhaustedReason === "none" &&
    searchTimeLeft > 800
  ) {
    const externalConfirmedPrimary = inspected.find((item) => verifiedExternalOffers(item).length > 0);
    const seedCandidate =
      inspected.find((item) => verifiedOffers(item).length > 0 && buildItemPanelEvidence(item).uniqueExternalSellerCount <= 2) ??
      inspected.find((item) => !item.result.rejected && buildItemPanelEvidence(item).ownStoreOfferCount > 0 && buildItemPanelEvidence(item).uniqueExternalSellerCount === 0);
    const seedExtCount = seedCandidate ? buildItemPanelEvidence(seedCandidate).uniqueExternalSellerCount : 0;
    const hasFragmentation = Boolean(
      seedCandidate &&
      seedExtCount <= 2 &&
      (codeless || candidates.size <= 4 || (!externalConfirmedPrimary && seedExtCount === 0)),
    );
    if (seedCandidate && hasFragmentation && searchRequestsUsed < budgets.maxSearchRequests) {
      similarProbesExecuted++;
      searchRequestsUsed++;
      const simKey = `${seedCandidate.result.candidate.prk}|${ROW_LIMIT}`;
      const cachedSim = options.cache?.getSimilar(simKey, options.now.getTime());
      let simRead: TorobRead<unknown>;
      if (cachedSim) {
        simRead = cachedSim;
        cacheHits++;
      } else {
        apiRequestsMade++;
        simRead = await singleFlight("similar", simKey, () => options.similar!(seedCandidate.result.candidate, ROW_LIMIT, Math.min(searchTimeLeft, budgets.searchTimeoutMs)));
        if (options.cache && !simRead.blocked && !simRead.unavailable && !simRead.issue && simRead.data !== undefined) {
          options.cache.setSimilar(simKey, simRead, options.now.getTime());
        }
      }
      if (!simRead.blocked && !simRead.unavailable && simRead.data !== undefined) {
        const simDecoded = decodeTorobSearch(simRead.data, ROW_LIMIT, 1);
        ingestCards(simDecoded, search.queries.length + 1, `similar:${seedCandidate.result.candidate.prk}`);
        recomputeRanking();
      }
    }
  }
  if (reserveDetailSlotForSimilar && inspected.length < budgets.maxDetails && !accessRestricted) {
    await inspectShortlist(buildInspectionOrder());
  }

  // Closed-loop search resumption when no independent external offers are verified yet (including self-only panels),
  // OR when inspected card/seller listings reveal unseen market phrasing.
  const hasExternalVerifiedOffersYet = () => inspected.some((item) => item.read.blocked || verifiedExternalOffers(item).length > 0);
  const onlySelfStoreVerifiedSoFar = () => !hasExternalVerifiedOffersYet() &&
    inspected.some((item) => verifiedOwnOffers(item).length > 0 || buildItemPanelEvidence(item).ownStoreOfferCount > 0);
  const noExternalOffersYet = !hasExternalVerifiedOffersYet();
  if (fastIdx < fastQueries.length && searchTimeLeft > 0 && inspected.length < budgets.maxDetails && noExternalOffersYet) {
    const resumedFailure = await runSearchPhase(false);
    if (resumedFailure) return resumedFailure;
    await inspectShortlist(buildInspectionOrder());
  } else if (!options.prk && !accessRestricted && searchTimeLeft > 800 && searchRequestsUsed < budgets.maxSearchRequests &&
      budgetExhaustedReason === "none" && (codeless || mode === "extended" || noExternalOffersYet || onlySelfStoreVerifiedSoFar())) {
    const extraExpansionRounds = onlySelfStoreVerifiedSoFar() ? 2 : 1;
    for (let round = 0; round < extraExpansionRounds; round++) {
      if (accessRestricted || searchTimeLeft <= 800 || searchRequestsUsed >= budgets.maxSearchRequests || budgetExhaustedReason !== "none") break;
      if (round > 0 && hasExternalVerifiedOffersYet()) break;
      const observedTitles = [
        ...inspected.flatMap((i) => i.offers.map((o) => o.listingTitle).filter((t): t is string => Boolean(t))),
        ...inspected.map((i) => i.result.candidate.titleFa).filter((t): t is string => Boolean(t)),
      ];
      const sellerVocab = ((codeless || onlySelfStoreVerifiedSoFar()) && (!hasExternalVerifiedOffersYet() || mode === "extended"))
        ? extractVocabularyExpansions(profile, observedTitles, [...observedSuggestedQueries], executedNormalizedQueries, 2)
        : [];
      const fallbackAction = sellerVocab.length
        ? toAction(sellerVocab[0])
        : buildExpansionActions()[0];
      if (!fallbackAction || !(sellerVocab.length > 0 || noExternalOffersYet || mode === "extended")) break;
      const searchStart = Date.now();
      const outcome = await executeSearchAction(fallbackAction, searchStart + searchTimeLeft);
      searchDurationMs += Date.now() - searchStart;
      searchTimeLeft = Math.max(0, searchTimeLeft - (Date.now() - searchStart));
      if (outcome.blocked) return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: outcome.challenged, accessRestricted: true });
      recomputeRanking();
      if (outcome.newPromising > 0 && inspected.length < budgets.maxDetails) {
        await inspectShortlist(buildInspectionOrder());
      } else if (sellerVocab.length === 0 && !onlySelfStoreVerifiedSoFar()) {
        break;
      }
    }
  }
  if (!options.prk && searchRequestsUsed >= budgets.maxSearchRequests && budgetExhaustedReason === "none" && buildExpansionActions().length > 0) {
    budgetExhaustedReason = "search_requests";
    if (stoppingReason === "scope_completed") stoppingReason = "request_budget";
  }

  verifyDurationMs = Date.now() - verifyStart;

  const rawEvidenceByPrk = new Map<string, PanelCompetitiveEvidence>(
    inspected.map((item) => [item.result.candidate.prk, buildItemPanelEvidence(item)]),
  );
  const rankPanelEntry = (item: InspectedCard): { tier: number; utility: number; confirmedExt: number; score: number } => {
    const ev = rawEvidenceByPrk.get(item.result.candidate.prk)!;
    const id = resolveIdentity(item);
    let tier = 0;
    if (id === "MATCH_CONFIRMED" && item.extraction === "extracted" && !item.result.hasConflict && ev.confirmedCompetitorCount > 0) {
      tier = 5;
    } else if (id === "MATCH_CONFIRMED" && (item.extraction === "extracted" || item.extraction === "empty") && !item.result.hasConflict) {
      tier = 4;
    } else if (item.result.status === "REVIEW_REQUIRED" && item.extraction === "extracted" && !item.result.rejected && !item.result.hasConflict && ev.uniqueExternalSellerCount > 0) {
      tier = 3;
    } else if (item.result.status === "REVIEW_REQUIRED" && (item.extraction === "extracted" || item.extraction === "empty") && !item.result.rejected) {
      tier = 2;
    } else if (!item.result.rejected && item.result.status !== "IDENTITY_MISMATCH") {
      tier = 1;
    }
    const baseScore = item.result.score ?? 0;
    let utility = baseScore;
    if (tier === 5) {
      utility =
        ev.confirmedCompetitorCount * 100 +
        (!ev.offersTruncated ? 25 : 0) +
        (ev.freshExternalCount ?? 0) * 8 +
        baseScore * 0.5 +
        (item.adminConfirmed ? 15 : 0);
    } else if (tier === 4) {
      utility = baseScore + (item.adminConfirmed ? 15 : 0) - (ev.ownStoreOfferCount > 0 && ev.uniqueExternalSellerCount === 0 ? 5 : 0);
    } else if (tier === 3) {
      utility =
        baseScore +
        Math.min(28, Math.log2(ev.uniqueExternalSellerCount + 1) * 10) +
        (!ev.offersTruncated ? 6 : 0) +
        ((ev.freshExternalCount ?? 0) > 0 ? 4 : 0);
    } else {
      utility = baseScore + (ev.uniqueExternalSellerCount > 0 ? Math.min(10, ev.uniqueExternalSellerCount * 2) : 0);
    }
    return { tier, utility, confirmedExt: ev.confirmedCompetitorCount, score: baseScore };
  };
  const inspectedRanked = [...inspected].sort((a, b) => {
    const ra = rankPanelEntry(a);
    const rb = rankPanelEntry(b);
    if (rb.tier !== ra.tier) return rb.tier - ra.tier;
    if (rb.utility !== ra.utility) return rb.utility - ra.utility;
    if (rb.confirmedExt !== ra.confirmedExt) return rb.confirmedExt - ra.confirmedExt;
    return rb.score - ra.score;
  });

  const primary = inspectedRanked[0];
  if (!primary) return fail("EXTRACTION_INCOMPLETE", "مهلت دریافت جزئیات کارت ترب پایان یافت");

  const { candidate } = primary.result;
  const data = primary.read.data;
  const panels = data ? [data] : [];
  const panelIds = [candidate.prk];
  let identityStatus = resolveIdentity(primary);
  let reason = primary.adminConfirmed ? "ارتباط ثبت‌شده با تأیید مدیر و بدون تعارض مشخصات"
    : primary.result.rejectReason ?? primary.result.blockers?.[0] ??
      (primary.sellerCorroborated ? SELLER_EVIDENCE_NOTE : primary.result.notes[0]) ?? "هویت کارت بر اساس عنوان و مشخصات سنجیده شد";

  const searchRank = ranked.find((result) => result.candidate.prk === candidate.prk);
  const uninspectedConflictingMatch = ranked.some((result) =>
    !inspectedPrks.has(result.candidate.prk) &&
    result.status === "MATCH_CONFIRMED" &&
    !areCompatibleConfirmedIdentities(primary.result, result));
  if (!primary.adminConfirmed && searchRank?.status === "REVIEW_REQUIRED" && primary.result.status === "MATCH_CONFIRMED" &&
      evaluateTorobCandidate(target, searchRank.candidate).status === "MATCH_CONFIRMED" && uninspectedConflictingMatch) {
    identityStatus = "REVIEW_REQUIRED";
    reason = searchRank.blockers?.at(-1) ?? "چند کارت هم‌زمان به محصول می‌خورند";
  }

  const blocked = inspected.find((item) => item.read.blocked);
  const aiCandidates = [primary.result, ...ranked.filter((result) => result.candidate.prk !== candidate.prk)
    .map((result) => inspected.find((item) => item.result.candidate.prk === result.candidate.prk)?.result ?? result)]
    .filter((result) => !result.rejected && result.titleState === "present").slice(0, 10);
  if (!blocked && !primary.read.issue && identityStatus !== "IDENTITY_MISMATCH" && aiCandidates.length &&
      options.matchConfig?.aiIdentityEnabled && (!primary.adminConfirmed || aiCandidates.length > 1) && await aiEnabled()) {
    aiIdentityCheck = await verifyTorobMatchesWithAI({
      productName: options.productName, sku: options.sku, category: options.category,
      candidates: aiCandidates.map(({ candidate: card }) => card),
    });
    if (aiIdentityCheck?.verdict === "no_match" ||
        (aiIdentityCheck?.verdict === "match" && aiIdentityCheck.primaryPrk && aiIdentityCheck.primaryPrk !== candidate.prk)) {
      identityStatus = "REVIEW_REQUIRED";
      reason = "نظر مدل زبانی با انتخاب تطبیق‌دهنده ناسازگار است و به بررسی مدیر نیاز دارد";
    } else if (data && identityStatus === "MATCH_CONFIRMED" && aiIdentityCheck?.verdict === "match") {
      for (const rankedCard of ranked) {
        const id = rankedCard.candidate.prk;
        if (!aiIdentityCheck.matchedPrks.includes(id) || !areCompatibleConfirmedIdentities(primary.result, rankedCard) ||
            inspected.some((item) => item.result.candidate.prk === id)) continue;
        const item = await inspectOne(rankedCard.candidate);
        if (!item || item.read.blocked) break;
      }
    }
  }

  const restriction = inspected.find((item) => item.read.blocked);
  const selfOnlyPanelPrks: string[] = [];
  if (!restriction && data && identityStatus === "MATCH_CONFIRMED") {
    const confirmed = inspectedRanked.filter((item) => (item.extraction === "extracted" || item.extraction === "empty") &&
      resolveIdentity(item) === "MATCH_CONFIRMED" && !item.result.hasConflict);
    if (confirmed.some((a, i) => confirmed.slice(i + 1).some((b) => !areCompatibleConfirmedIdentities(a.result, b.result)))) {
      identityStatus = "REVIEW_REQUIRED";
      reason = "چند کارت با هویت یا مشخصات متفاوت هم‌زمان با محصول سایت منطبق‌اند";
    } else {
      for (const item of confirmed) {
        if (item === primary) continue;
        const extCount = verifiedExternalOffers(item).length;
        const ownCount = rawEvidenceByPrk.get(item.result.candidate.prk)?.ownStoreOfferCount ?? 0;
        if (item.extraction === "extracted" && item.read.data && extCount > 0 &&
            areCompatibleConfirmedIdentities(primary.result, item.result)) {
          panels.push(item.read.data);
          panelIds.push(item.result.candidate.prk);
        } else if (extCount === 0 && ownCount > 0) {
          selfOnlyPanelPrks.push(item.result.candidate.prk);
        }
      }
    }
  }

  const panelPrks = new Set(panelIds);
  const offers = uniqueOffers(inspected.flatMap((item) => item.offers.map((offer) => {
    const identity = offer.torobIdentity;
    if (identity?.status !== "MATCH_CONFIRMED" ||
        (!restriction && identityStatus === "MATCH_CONFIRMED" && panelPrks.has(identity.prk))) return offer;
    return { ...offer, torobIdentity: { ...identity, status: "REVIEW_REQUIRED" as const,
      reason: item.result.blockers?.[0] ?? "کارت این پیشنهاد در مجموعهٔ پنل‌های تأییدشده و سازگار قرار نگرفت" } };
  })));
  const primaryShopCount = data?.totalSellerCount ?? data?.offers.length ?? 0;
  const total = Math.max(primaryShopCount, offers.filter((offer) => panelPrks.has(offer.torobIdentity?.prk ?? "")).length);
  const hasConfirmedExternalInSelected = offers.some((offer) =>
    panelPrks.has(offer.torobIdentity?.prk ?? "") &&
    offer.torobIdentity?.status === "MATCH_CONFIRMED" &&
    !ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId }));
  const hasOwnConfirmedInSelected = offers.some((offer) =>
    panelPrks.has(offer.torobIdentity?.prk ?? "") &&
    offer.torobIdentity?.status === "MATCH_CONFIRMED" &&
    ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId }));
  const ownStoreOnlyOnPrimary = Boolean(
    primaryEvCheck(rawEvidenceByPrk.get(candidate.prk)) &&
    !hasConfirmedExternalInSelected &&
    (rawEvidenceByPrk.get(candidate.prk)!.ownStoreOfferCount > 0 &&
     rawEvidenceByPrk.get(candidate.prk)!.uniqueExternalSellerCount === 0),
  );
  function primaryEvCheck(ev: PanelCompetitiveEvidence | undefined): ev is PanelCompetitiveEvidence {
    return Boolean(ev);
  }
  let status: TorobSourceAssessment["status"] = identityStatus;
  if (restriction) {
    status = "SOURCE_UNAVAILABLE";
    reason = "ترب دسترسی دریافت جزئیات را محدود کرده است";
  } else if (primary.extraction === "unavailable" || primary.extraction === "incomplete") {
    status = "EXTRACTION_INCOMPLETE";
    reason = ({
      details_prk_mismatch: "شناسهٔ پاسخ جزئیات با کارت درخواست‌شده متفاوت است",
      details_timeout: "مهلت دریافت جزئیات کارت ترب پایان یافت",
    } as Record<string, string>)[primary.read.issue ?? ""] ?? "کارت ترب مشخص است ولی دریافت یا استخراج جزئیات کامل نشد";
    const http = /^(mcp|torob)_http_(\d{3})$/.exec(primary.read.issue ?? "");
    if (http) reason += ` (${http[1] === "mcp" ? "MCP" : "Torob"} HTTP ${http[2]})`;
  } else if (identityStatus === "EXTRACTION_INCOMPLETE") {
    reason = primary.sellerTitle
      ? "عنوان فروشنده پیدا شد و برای بازبینی ثبت شد. عنوان معتبر کارت ترب در دسترس نیست"
      : "عنوان قابل استفادهٔ کارت ترب در جستجو و جزئیات دریافت نشد";
  } else if (identityStatus === "MATCH_CONFIRMED" && !hasConfirmedExternalInSelected) {
    const needsSellerReview = offers.some((offer) =>
      panelPrks.has(offer.torobIdentity?.prk ?? "") &&
      !ownShopMatcher({ shopName: offer.shopName, shopId: offer.shopId }) &&
      offer.torobIdentity?.status === "REVIEW_REQUIRED");
    if (hasOwnConfirmedInSelected && !needsSellerReview) {
      status = "NO_VALID_OFFERS";
      reason = "تنها پیشنهاد تأییدشده روی کارت ترب مربوط به فروشگاه خودمان است و رقیب مستقلی یافت نشد";
    } else {
      status = needsSellerReview ? "REVIEW_REQUIRED" : "NO_VALID_OFFERS";
      reason = needsSellerReview ? "هویت کارت احراز شد و هویت پیشنهادهای فروشندگان نیازمند بازبینی است"
        : "جزئیات کارت دریافت شد و پیشنهاد قابل استفاده‌ای برای قیمت‌گذاری استخراج نشد";
    }
  }
  if (status === "IDENTITY_MISMATCH") reason = `عدم تطابق هویت کارت ترب · ${reason}`;

  const panelEvidence: PanelCompetitiveEvidence[] = [];
  const selectedPanelPrks: string[] = [];
  const reviewPanelPrks: string[] = [];
  const rejectedPanelPrks: string[] = [];
  for (const item of inspectedRanked) {
    const prk = item.result.candidate.prk;
    const baseEv = rawEvidenceByPrk.get(prk) ?? buildItemPanelEvidence(item);
    let groupRole: PanelGroupRole;
    let selectionReason: string | null = null;
    let exclusionReason: string | null = null;
    if (!restriction && identityStatus === "MATCH_CONFIRMED" && panelPrks.has(prk)) {
      if (item === primary) {
        groupRole = ownStoreOnlyOnPrimary ? "self_only" : "primary";
        selectionReason = ownStoreOnlyOnPrimary
          ? "تنها کارت تأییدشدهٔ موجود؛ فقط شامل پیشنهاد فروشگاه خودمان است"
          : `انتخاب‌شده به‌عنوان مرجع اصلی بازار (${baseEv.confirmedCompetitorCount} رقیب مستقل تأییدشده)`;
      } else {
        groupRole = "compatible_secondary";
        selectionReason = `کارت سازگار تکمیلی با ${baseEv.confirmedCompetitorCount} رقیب مستقل تأییدشده`;
      }
      selectedPanelPrks.push(prk);
      if (groupRole === "self_only" && !selfOnlyPanelPrks.includes(prk)) selfOnlyPanelPrks.push(prk);
    } else if (baseEv.ownStoreOfferCount > 0 && baseEv.uniqueExternalSellerCount === 0 && baseEv.identityStatus !== "IDENTITY_MISMATCH" && !item.result.rejected) {
      groupRole = "self_only";
      exclusionReason = "فقط شامل پیشنهاد فروشگاه خودمان است (فاقد رقیب مستقل)";
      if (!selfOnlyPanelPrks.includes(prk)) selfOnlyPanelPrks.push(prk);
    } else if (baseEv.identityStatus === "IDENTITY_MISMATCH" || item.result.rejected) {
      groupRole = "rejected";
      exclusionReason = item.result.rejectReason ?? item.result.blockers?.[0] ?? "عدم تطابق هویت یا مشخصات با کالای هدف";
      rejectedPanelPrks.push(prk);
    } else {
      groupRole = item === primary && baseEv.uniqueExternalSellerCount > 0 ? "review_required" : "review_required";
      if (item === primary) {
        selectionReason = baseEv.uniqueExternalSellerCount > 0
          ? `نامزد اولویت‌دار بازبینی با ${baseEv.uniqueExternalSellerCount} فروشندهٔ مستقل؛ نیازمند تأیید هویت`
          : reason;
      } else {
        exclusionReason = item.result.blockers?.[0] ?? reason;
      }
      reviewPanelPrks.push(prk);
    }
    panelEvidence.push({ ...baseEv, groupRole, selectionReason, exclusionReason });
  }
  const panelEvidenceMap = new Map(panelEvidence.map((ev) => [ev.prk, ev]));

  const shouldFetchPriceTrend = Boolean(
    status === "MATCH_CONFIRMED" &&
    data &&
    !data.offersTruncated &&
    primary.offers.length === data.sellerRows &&
    primary.offers.every((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED"),
  );
  let priceTrend: MarketPriceTrend | null = null;
  if (shouldFetchPriceTrend) {
    const trendKey = detailsCacheKey(candidate);
    const cachedTrend = options.cache?.getPriceTrend(trendKey, options.now.getTime());
    if (cachedTrend?.hit) {
      priceTrend = cachedTrend.value;
      cacheHits++;
    } else {
      apiRequestsMade++;
      priceTrend = await singleFlight("trend", trendKey, () => options.priceTrend(candidate));
      options.cache?.setPriceTrend(trendKey, priceTrend, options.now.getTime());
    }
  }

  const offersTruncated = panels.some((panel) => panel.offersTruncated);
  const coverage = buildCoverage(
    status === "SOURCE_UNAVAILABLE" ? "unavailable" : undefined,
    offers,
    offersTruncated,
  );
  const searchTrace = trackSearch(coverage);
  if (searchTrace) {
    for (const c of searchTrace.candidates) {
      const pe = panelEvidenceMap.get(c.prk);
      if (pe) c.panelEvidence = pe;
    }
  }
  const selected = {
    ...candidateTrace(primary.result, primary.extraction, candidates.get(candidate.prk)?.observations.map(({ query }) => query) ?? [], priorityMap.get(candidate.prk)),
    origin: primary.read.origin,
    ...(panelEvidenceMap.get(candidate.prk) ? { panelEvidence: panelEvidenceMap.get(candidate.prk) } : {}),
  };
  const complete = status !== "EXTRACTION_INCOMPLETE" && status !== "SOURCE_UNAVAILABLE";

  return {
    source: "torob",
    prk: candidate.prk,
    productTitle: candidate.titleFa || undefined,
    productTitleEn: candidate.titleEn ?? null,
    detailsUrl: safeTorobDetailsUrl(candidate.detailsUrl, candidate.prk),
    fetchedAt: options.now,
    offers,
    totalSellerCount: total,
    inPersonSellerCount: Math.max(data?.inPersonSellerCount ?? 0, offers.filter((offer) => offer.sellerType === "in_person").length),
    priceTrend,
    ok: complete,
    ...(status !== "MATCH_CONFIRMED" ? { error: reason } : {}),
    torob: {
      status,
      reason,
      identityStatus,
      titleOrigin: primary.origin,
      identityScore: selected.score,
      search: searchTrace,
      selected,
      sellerRows: data?.sellerRows == null ? null : panels.reduce((sum, panel) => sum + (panel.sellerRows ?? 0), 0),
      reportedSellers: data?.totalSellerCount ?? null,
      adminConfirmed: primary.adminConfirmed,
      offerIdentityEvaluated: true,
      coverage,
      panelEvidence,
      selectedPanelPrks,
      selfOnlyPanelPrks,
      reviewPanelPrks,
      rejectedPanelPrks,
      ownStoreOnlyOnPrimary,
    },
    meta: {
      ...meta(),
      ...(restriction ? { challenged: restriction.read.challenged, accessRestricted: true } : {}),
      extractionIssue: primary.read.issue,
      ...(primary.read.issue ? { diagnostics: [primary.read.issue] } : {}),
      sellerTitle: primary.sellerTitle,
      matchScore: selected.score,
      matchExplanation: reason,
      panels: panels.map((panel, i) => listingPanel(panelIds[i], panel.offers, panel.totalSellerCount ?? panel.offers.length)),
      ...(panelIds.length > 1 ? { mergedPanelPrks: panelIds } : {}),
      offersTruncated,
      onlineOfferCount: data?.onlineOfferCount ?? 0,
      coverage,
    },
  };
}
