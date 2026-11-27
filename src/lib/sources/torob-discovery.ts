import { aiEnabled, verifyTorobMatchesWithAI } from "@/lib/ai/client";
import { listingPanel } from "@/lib/pricing/listing";
import { areCompatibleConfirmedIdentities, evaluateTorobCandidate, selectBestTorobSearchMatch, type ProductMatchTarget, type ScoredCandidateResult, type TorobCandidateCard } from "@/lib/pricing/matcher";
import { parseTitle, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import { compactShopKey } from "@/lib/pricing/own-shop";
import type { MarketPriceTrend, RawOffer, SourceResult, TorobCandidateTrace, TorobDataOrigin, TorobIdentityStatus, TorobLinkConfirmation, TorobSearchTrace, TorobSourceAssessment, TorobTitleOrigin } from "@/lib/pricing/types";
import { conflictingEvidence, inspectSellerOffers, isSellerEvidenceProbeCandidate, reviewCard, SELLER_EVIDENCE_NOTE } from "./torob-identity";
import { decodeTorobSearch, safeTorobDetailsUrl, torobProductUrl, type TorobDetailsData } from "./torob-payload";
import type { SourceMatchConfig } from "./types";

const MAX_QUERIES = 6;
const ROW_LIMIT = 24;
const MAX_DETAILS = 4;
const SEARCH_BUDGET_MS = 15_000;
const DETAILS_BUDGET_MS = 16_000;
const SEARCH_TIMEOUT_MS = 4_500;
const DETAILS_TIMEOUT_MS = 7_000;

export function buildSearchQueries(productName: string, sku?: string | null): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (query: string) => {
    const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
    const normalized = normalizeText(text);
    if (normalized.length < 3 || seen.has(normalized) || queries.length >= MAX_QUERIES) return;
    seen.add(normalized);
    queries.push(text);
  };
  const parsed = parseTitle(productName, { sku });
  const code = parsed.codes.filter((item) => !item.inCompat && item.canon.length >= 5)
    .sort((a, b) => b.canon.length - a.canon.length)[0];
  const core = productName
    .replace(/\s*[([]\s*(?:مناسب|مخصوص|ویژه|جهت|برای|compatible|for)\s[^)\]]*[)\]]/gi, " ")
    .split(/\s+(?:مناسب\s+برای|مخصوص|ویژهٔ?|جهت|compatible\s+with)\s+/i)[0]
    .trim();
  add(core || productName);
  const brand = parsed.brands[0] ?? code?.brandHint;
  if (code) {
    const original = productName.split(/[\s،,;()[\]]+/)
      .find((word) => normalizeText(word).replace(/[^0-9a-z]/g, "").toUpperCase() === code.canon) ?? code.raw;
    add(original);
    if (brand && !original.toLowerCase().startsWith(brand)) add(`${brand} ${original}`);
  }
  if (parsed.family === "remotag" && (!parsed.head || parsed.head.cls === "access_control")) {
    const brandLabel = brand === "beta" ? "بتا" : brand ?? "";
    add(`ریموتگ ${brandLabel}`);
    add(`اکسس کنترل ریموتگ ${brandLabel}`);
    const intercom = parsed.tokens.includes("ایفون");
    add(`برد کنترل دسترسی ریموتگ ${intercom ? "آیفون " : ""}${brandLabel}`);
    if (intercom) add(`ماژول کارتی ریموتی آیفون ${brandLabel}`);
  } else if (!code) {
    const identity = parseTitle(core);
    const head = identity.head ? identity.tokens.slice(identity.head.at, identity.head.at + identity.head.len) : [];
    const words = identity.words.slice(0, 3);
    const remote = identity.head?.cls === "acc:remote";
    if (!remote && words.length && (brand || head.length)) add([...head, brand, ...words].filter(Boolean).join(" "));
    if (head.length && !parsed.codes.some((item) => !item.inCompat)) {
      const [frequency] = identity.attrs.frequency ?? [];
      const rf = typeof frequency === "number" && identity.attrs.frequency.length === 1
        ? frequency >= 1_000_000 ? String(frequency / 1_000_000) : frequency >= 1_000 ? `${frequency / 1_000} khz` : `${frequency} hz`
        : undefined;
      const [descriptor] = words;
      const [buttons] = identity.attrs.buttons ?? [];
      if (remote) {
        add([...head, descriptor, rf, brand].filter(Boolean).join(" "));
        if (rf) add([...head, rf, brand].filter(Boolean).join(" "));
        if (descriptor && brand) add([...head, descriptor, brand].join(" "));
        if (descriptor) add([...head, descriptor].join(" "));
        if (descriptor && buttons) add([...head, descriptor, buttons, "دکمه"].join(" "));
      } else {
        if (rf) add([...head, rf, brand].filter(Boolean).join(" "));
        for (const word of words) add([...head, word, brand].filter(Boolean).join(" "));
      }
    }
  }
  return queries;
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
  detailsUrl?: string | null;
  confirmation?: TorobLinkConfirmation | null;
  now: Date;
  via: string;
  search: (query: string, limit: number, timeoutMs: number) => Promise<TorobRead<unknown>>;
  details: (card: TorobCandidateCard, timeoutMs: number) => Promise<TorobRead<TorobDetailsData>>;
  priceTrend: (card: TorobCandidateCard) => Promise<MarketPriceTrend | null>;
}

type Extraction = TorobCandidateTrace["extraction"];

function candidateTrace(result: ScoredCandidateResult, extraction: Extraction, queries: number[]): TorobCandidateTrace {
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
  if (read.data?.prk && read.data.prk !== card.prk) {
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
  const excluded: RawOffer[] = [];
  for (const offer of offers) {
    if (offer.torobIdentity?.status !== "MATCH_CONFIRMED") {
      excluded.push(offer);
      continue;
    }
    const key = `${offer.shopId ? `id:${compactShopKey(offer.shopId)}` : `name:${compactShopKey(offer.shopName)}`}|${offer.sellerType ?? "online"}`;
    const prev = confirmed.get(key);
    const oldTime = prev?.lastChangedAt?.getTime() ?? 0;
    const newTime = offer.lastChangedAt?.getTime() ?? 0;
    if (!prev || newTime > oldTime || (newTime === oldTime && offer.price < prev.price)) confirmed.set(key, offer);
  }
  return [...confirmed.values(), ...excluded].sort((a, b) => a.price - b.price);
}

export async function resolveTorobSource(options: DiscoveryOptions): Promise<SourceResult> {
  const target = {
    productName: options.productName,
    sku: options.sku,
    anchorPriceToman: options.anchorPriceToman,
    rejectBelowPct: options.matchConfig?.rejectBelowPct,
    approveAbovePct: options.matchConfig?.approveAbovePct,
  };
  const targetTitle = parseTitle(target.productName, { sku: target.sku });
  const codeless = !targetTitle.codes.some((code) => !code.inCompat);
  const search: TorobSearchTrace = { queries: [], candidates: [], accepted: 0, eligible: 0 };
  const candidates = new Map<string, { card: TorobCandidateCard; observations: NonNullable<TorobCandidateTrace["observations"]> }>();
  const inspected: InspectedCard[] = [];
  let ranked: ScoredCandidateResult[] = [];
  let aiIdentityCheck: Awaited<ReturnType<typeof verifyTorobMatchesWithAI>> = null;
  const trackSearch = () => {
    search.candidates = ranked.map((result) => {
      const observations = candidates.get(result.candidate.prk)?.observations ?? [];
      const item = inspected.find((entry) => entry.result.candidate.prk === result.candidate.prk);
      const trace = candidateTrace(result, item?.extraction ?? "not_requested", observations.map(({ query }) => query));
      if (item) {
        const { status, reasons, titleFa, titleEn, specs, imageUrls } = candidateTrace(item.result, item.extraction, []);
        trace.inspection = { status, reasons, titleFa, titleEn, specs, imageUrls, origin: item.read.origin };
      }
      return { ...trace, observations };
    });
    for (const item of inspected) {
      if (!candidates.has(item.result.candidate.prk)) {
        search.candidates.push({ ...candidateTrace(item.result, item.extraction, []), origin: item.read.origin });
      }
    }
    search.accepted = ranked.filter((result) => result.status === "MATCH_CONFIRMED").length;
    search.eligible = ranked.filter((result) => result.status === "MATCH_CONFIRMED" || result.status === "REVIEW_REQUIRED").length;
    return search.queries.length ? search : undefined;
  };
  const meta = () => ({
    via: options.via,
    searchQueries: search.queries.map(({ query, mapped, issue }) => ({ query, cards: mapped, ...(issue ? { error: issue } : {}) })),
    ...(aiIdentityCheck ? { aiIdentityCheck } : {}),
  });
  const fail = (status: TorobSourceAssessment["status"], reason: string, extraMeta: Record<string, unknown> = {}): SourceResult => ({
    source: "torob", prk: options.prk, offers: [], totalSellerCount: 0, fetchedAt: options.now,
    ok: false, error: reason,
    torob: { status, reason, sellerRows: null, reportedSellers: null, search: trackSearch(),
      ...(status === "IDENTITY_MISMATCH" || status === "REVIEW_REQUIRED" ? { identityStatus: status } : {}) },
    meta: { ...meta(), ...extraMeta },
  });

  const queries = options.prk ? [] : buildSearchQueries(options.productName, options.sku);
  let nextQuery = 0;
  let searchTimeLeft = SEARCH_BUDGET_MS;
  let completedSearch = false;
  let unavailable = false;
  let extractionIssue = false;
  let explanation = "هیچ کارت قابل استعلامی از جستجوی ترب دریافت نشد";
  const searchCards = async (stopOnConfirmedCard: boolean): Promise<SourceResult | undefined> => {
    const searchDeadline = Date.now() + searchTimeLeft;
    while (nextQuery < queries.length) {
      const query = queries[nextQuery++];
      const remaining = searchDeadline - Date.now();
      if (remaining <= 0) {
        search.queries.push({ query, rows: null, mapped: 0, issue: "search_budget" });
        break;
      }
      const read = await options.search(query, ROW_LIMIT, Math.min(remaining, SEARCH_TIMEOUT_MS));
      const decoded = read.data === undefined ? null : decodeTorobSearch(read.data, ROW_LIMIT);
      const issue = read.issue ?? decoded?.issue;
      search.queries.push({ query, rows: decoded?.rows ?? null, mapped: decoded?.candidates.length ?? 0, issue, origin: read.origin });
      if (read.blocked) return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: read.challenged, accessRestricted: true });
      unavailable ||= Boolean(read.unavailable);
      extractionIssue ||= Boolean(decoded?.issue || (issue && !read.unavailable));
      completedSearch ||= decoded?.rows != null;
      for (const card of decoded?.candidates ?? []) {
        const existing = candidates.get(card.prk);
        const query = search.queries.length;
        const observations = existing?.observations ?? [];
        const titleFa = card.titleFa || null;
        const titleEn = card.titleEn || null;
        if (!observations.some((item) => item.query === query && item.titleFa === titleFa && item.titleEn === titleEn)) {
          observations.push({ query, titleFa, titleEn });
        }
        candidates.set(card.prk, {
          card: existing ? mergeCards(target, existing.card, card) : card,
          observations,
        });
      }
      const outcome = selectBestTorobSearchMatch(target, [...candidates.values()].map(({ card }) => card), options.matchConfig?.minSellerCount);
      ranked = outcome.allRanked;
      explanation = outcome.explanation;
      if (outcome.confident && stopOnConfirmedCard) break;
    }
    searchTimeLeft = Math.max(0, searchDeadline - Date.now());
    return undefined;
  };

  const detailShortlist = (): TorobCandidateCard[] => {
    if (options.prk) return [{ prk: options.prk, titleFa: "", detailsUrl: options.detailsUrl }];
    const remaining = ranked.filter((result) => !inspected.some((item) => item.result.candidate.prk === result.candidate.prk));
    const reviewable = remaining.filter((result) => !result.rejected);
    const sellerProbes = codeless ? remaining.filter((result) => result.rejected &&
      isSellerEvidenceProbeCandidate(target, targetTitle, result)) : [];
    // Reserve capacity for plausible quantity labels even on a crowded search page.
    const probeSlots = Math.min(2, sellerProbes.length);
    const regularSlots = MAX_DETAILS - probeSlots;
    const regular = reviewable.map(({ candidate }) => candidate);
    if (options.cachedPrk && !candidates.has(options.cachedPrk)) {
      const cached = { prk: options.cachedPrk, titleFa: "", detailsUrl: options.detailsUrl };
      regular.splice(regularSlots - 1, 0, cached);
    }
    return [
      ...regular.slice(0, regularSlots),
      ...sellerProbes.map(({ candidate }) => candidate),
      ...regular.slice(regularSlots),
    ].slice(0, MAX_DETAILS - inspected.length);
  };

  const searchFailure = await searchCards(!codeless);
  if (searchFailure) return searchFailure;
  const shortlist = detailShortlist();
  if (!shortlist.length) {
    if (extractionIssue) return fail("EXTRACTION_INCOMPLETE", "ساختار بعضی پاسخ‌ها یا شناسه‌های کارت ترب قابل استخراج نبود");
    if (!completedSearch && unavailable) return fail("SOURCE_UNAVAILABLE", "پاسخی از جستجوی ترب دریافت نشد");
    if (ranked.length && !search.queries.some(({ issue }) => issue)) {
      return fail("IDENTITY_MISMATCH", explanation, { rejectedInSearch: true });
    }
    return fail("REVIEW_REQUIRED", "کارت قابل بررسی در محدودهٔ جستجوی انجام‌شده پیدا نشد");
  }

  const detailsDeadline = Date.now() + DETAILS_BUDGET_MS;
  const inspect = async (card: TorobCandidateCard) => {
    const remaining = detailsDeadline - Date.now();
    if (remaining <= 0 || inspected.length >= MAX_DETAILS) return undefined;
    const read = await options.details(card, Math.min(remaining, DETAILS_TIMEOUT_MS));
    const item = inspectDetails(target, targetTitle, card, read, options.confirmation, candidates.get(card.prk)?.observations);
    inspected.push(item);
    return item;
  };
  const verifiedOffers = (item: InspectedCard) => resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted"
    ? item.offers.filter((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED") : [];
  const inspectShortlist = async (cards: TorobCandidateCard[]) => {
    for (const card of cards) {
      const item = await inspect(card);
      if (!item || item.read.blocked) break;
      if (!codeless && verifiedOffers(item).length > 2) break;
    }
  };
  await inspectShortlist(shortlist);
  // A model-code hit can stop the first search stage, but the card may have no eligible sellers.
  if (nextQuery < queries.length && searchTimeLeft > 0 && inspected.length < MAX_DETAILS &&
      !inspected.some((item) => item.read.blocked || verifiedOffers(item).length > 0)) {
    const resumedFailure = await searchCards(false);
    if (resumedFailure) return resumedFailure;
    await inspectShortlist(detailShortlist());
  }
  const primary = inspected.find((item) => verifiedOffers(item).length > 0)
    ?? inspected.find((item) => resolveIdentity(item) === "MATCH_CONFIRMED" &&
    (item.extraction === "extracted" || item.extraction === "empty"))
    ?? inspected.find((item) => item.result.status === "REVIEW_REQUIRED" && item.extraction === "extracted")
    ?? inspected.find((item) => !item.result.rejected) ?? inspected[0];
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
  if (!primary.adminConfirmed && searchRank?.status === "REVIEW_REQUIRED" && primary.result.status === "MATCH_CONFIRMED" &&
      evaluateTorobCandidate(target, searchRank.candidate).status === "MATCH_CONFIRMED") {
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
        const item = await inspect(rankedCard.candidate);
        if (!item || item.read.blocked) break;
      }
    }
  }

  const restriction = inspected.find((item) => item.read.blocked);
  if (!restriction && data && identityStatus === "MATCH_CONFIRMED") {
    const confirmed = inspected.filter((item) => (item.extraction === "extracted" || item.extraction === "empty") &&
      item.result.status === "MATCH_CONFIRMED" && !item.result.hasConflict);
    if (confirmed.some((a, i) => confirmed.slice(i + 1).some((b) => !areCompatibleConfirmedIdentities(a.result, b.result)))) {
      identityStatus = "REVIEW_REQUIRED";
      reason = "چند کارت با هویت یا مشخصات متفاوت هم‌زمان با محصول سایت منطبق‌اند";
    } else {
      for (const item of confirmed) {
        if (item !== primary && item.extraction === "extracted" && item.read.data &&
            areCompatibleConfirmedIdentities(primary.result, item.result)) {
          panels.push(item.read.data);
          panelIds.push(item.result.candidate.prk);
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
  } else if (identityStatus === "MATCH_CONFIRMED" && !offers.some((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED")) {
    const needsSellerReview = offers.some((offer) => offer.torobIdentity?.status === "REVIEW_REQUIRED");
    status = needsSellerReview ? "REVIEW_REQUIRED" : "NO_VALID_OFFERS";
    reason = needsSellerReview ? "هویت کارت احراز شد و هویت پیشنهادهای فروشندگان نیازمند بازبینی است"
      : "جزئیات کارت دریافت شد و پیشنهاد قابل استفاده‌ای برای قیمت‌گذاری استخراج نشد";
  }
  if (status === "IDENTITY_MISMATCH") reason = `عدم تطابق هویت کارت ترب · ${reason}`;
  const selected = { ...candidateTrace(primary.result, primary.extraction, candidates.get(candidate.prk)?.observations.map(({ query }) => query) ?? []),
    origin: primary.read.origin };
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
    priceTrend: status === "MATCH_CONFIRMED" && data && !data.offersTruncated && primary.offers.length === data.sellerRows &&
      primary.offers.every((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED") ? await options.priceTrend(candidate) : null,
    ok: complete,
    ...(status !== "MATCH_CONFIRMED" ? { error: reason } : {}),
    torob: {
      status, reason, identityStatus, titleOrigin: primary.origin, identityScore: selected.score, search: trackSearch(),
      selected, sellerRows: data?.sellerRows == null ? null : panels.reduce((sum, panel) => sum + (panel.sellerRows ?? 0), 0),
      reportedSellers: data?.totalSellerCount ?? null, adminConfirmed: primary.adminConfirmed,
      offerIdentityEvaluated: true,
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
      offersTruncated: panels.some((panel) => panel.offersTruncated),
      onlineOfferCount: data?.onlineOfferCount ?? 0,
    },
  };
}
