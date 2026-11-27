import { aiEnabled, verifyTorobMatchesWithAI } from "@/lib/ai/client";
import { listingPanel } from "@/lib/pricing/listing";
import { areCompatibleConfirmedIdentities, evaluateTorobCandidate, selectBestTorobSearchMatch, type ProductMatchTarget, type ScoredCandidateResult, type TorobCandidateCard } from "@/lib/pricing/matcher";
import { relateCodes } from "@/lib/pricing/match/compare";
import { areKnownBrandSetsCompatible, PACK_WORDS } from "@/lib/pricing/match/lexicon";
import { parseTitle, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import { compactShopKey } from "@/lib/pricing/own-shop";
import type { MarketPriceTrend, RawOffer, SourceResult, TorobCandidateTrace, TorobIdentityStatus, TorobLinkConfirmation, TorobSearchTrace, TorobSourceAssessment, TorobTitleOrigin } from "@/lib/pricing/types";
import { decodeTorobSearch, safeTorobDetailsUrl, torobProductUrl, type TorobDetailsData } from "./torob-payload";
import type { SourceMatchConfig } from "./types";

const MAX_QUERIES = 5;
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
    const remote = parsed.head?.cls === "acc:remote";
    // Remote seller listings are often indexed under a shorter, brandless Torob card.
    if (!remote && words.length && (brand || head.length)) add([...head, brand, ...words].filter(Boolean).join(" "));
    if (head.length && !parsed.codes.some((item) => !item.inCompat)) {
      const frequency = identity.attrs.frequency;
      if (frequency?.length === 1 && typeof frequency[0] === "number") {
        const hz = frequency[0];
        const label = hz >= 1_000_000 ? String(hz / 1_000_000) : hz >= 1_000 ? `${hz / 1_000} khz` : `${hz} hz`;
        add([...head, label, brand].join(" "));
      }
      // Try the distinctive shape first (e.g. "بنزی"), then the same words without the manufacturer.
      for (const word of remote ? [...words].reverse() : words) add([...head, word, brand].filter(Boolean).join(" "));
      if (remote) for (const word of [...words].reverse()) add([...head, word].join(" "));
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
}

interface DiscoveryOptions {
  productName: string;
  sku?: string | null;
  category?: string | null;
  anchorPriceToman?: number | null;
  matchConfig?: SourceMatchConfig;
  prk?: string | null;
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
  };
}

function mergeCards(prev: TorobCandidateCard, next: TorobCandidateCard): TorobCandidateCard {
  const titleFa = normalizeText(prev.titleFa) ? prev.titleFa : next.titleFa;
  const titleEn = normalizeText(prev.titleEn) ? prev.titleEn : next.titleEn;
  return {
    ...prev,
    titleFa,
    titleEn,
    titleEvidence: {
      fields: [...new Set([...(prev.titleEvidence?.fields ?? []), ...(next.titleEvidence?.fields ?? [])])],
      parsed: Boolean(prev.titleEvidence?.parsed || next.titleEvidence?.parsed),
    },
    priceToman: prev.priceToman ?? next.priceToman,
    sellerCount: prev.sellerCount ?? next.sellerCount,
    available: prev.available ?? next.available,
    detailsUrl: prev.detailsUrl ?? next.detailsUrl,
    shopName: prev.shopName ?? next.shopName,
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
}

const SELLER_EVIDENCE_NOTE = "عنوان فروشندگان شواهد تطابق هویت کارت ترب را تکمیل کرد";

function identityBrands(title: ParsedTitle): string[] {
  return [...title.brands, ...title.impliedBrands];
}

function hasSellerEvidenceConflict(target: ParsedTitle, result: ScoredCandidateResult): boolean {
  const card = result.parsed;
  if (!card || result.hasConflict || !areKnownBrandSetsCompatible(identityBrands(target), identityBrands(card))) return true;
  if (card.codes.some((code) => !code.inCompat && !target.codes.some((other) =>
    !other.inCompat && ["equal", "alias", "tail"].includes(relateCodes(code, other))))) return true;
  if (card.bundleWith.some((cls) => !target.bundleWith.includes(cls)) ||
      card.withAccessories.some((cls) => !target.withAccessories.includes(cls)) ||
      (card.trailingAccessory && card.trailingAccessory !== target.trailingAccessory)) return true;
  return card.head?.cls === "acc:remote" && card.hits.some(({ cls }) =>
    cls !== "acc:remote" && !target.hits.some((hit) => hit.cls === cls));
}

function cardForSellerEvidence(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult): ScoredCandidateResult | undefined {
  const parsed = result.parsed;
  if (!parsed) return undefined;
  if (parsed.pack && !targetTitle.pack) {
    const { qty, word } = parsed.pack;
    const ratio = (result.candidate.priceToman ?? 0) / (target.anchorPriceToman ?? 0);
    if (parsed.head?.cls !== "acc:remote" || targetTitle.head?.cls !== "acc:remote" ||
        qty == null || qty > 16 || parsed.attrs.buttons?.length || !/ (?:عددی|تایی)$/.test(word) ||
        (targetTitle.attrs.buttons?.length && !targetTitle.attrs.buttons.includes(qty)) ||
        !(ratio >= 0.55 && ratio <= 1.85) || parsed.tokens.some((token) => PACK_WORDS.has(token))) return undefined;

    // Re-evaluate the card with only the ambiguous quantity phrase removed.
    const stripQuantity = (title: string | null | undefined) => ` ${normalizeText(title)} `.replace(` ${word} `, " ").trim();
    const { candidate } = result;
    result = evaluateTorobCandidate(target, { ...candidate, titleFa: stripQuantity(candidate.titleFa), titleEn: stripQuantity(candidate.titleEn) });
    if (result.parsed?.pack) return undefined;
  }
  return hasSellerEvidenceConflict(targetTitle, result) ? undefined : result;
}

function isSellerEvidenceProbeCandidate(target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult): boolean {
  const card = result.parsed;
  if (!card?.head || card.head.cls !== targetTitle.head?.cls) return false;
  // A Torob card can omit the manufacturer while its individual seller titles name it.
  // Require at least one positive hint on the card before spending a details request.
  const sharedBrand = Boolean(identityBrands(card).length && identityBrands(targetTitle).length &&
    areKnownBrandSetsCompatible(identityBrands(card), identityBrands(targetTitle)));
  const sharedDescriptor = card.words.some((word) => targetTitle.tokens.includes(word));
  const sharedSpec = Object.entries(card.attrs).some(([key, values]) =>
    targetTitle.attrs[key]?.some((value) => values.includes(value)));
  if (!sharedBrand && !sharedDescriptor && !sharedSpec) return false;
  const evidence = cardForSellerEvidence(target, targetTitle, result);
  if (!evidence?.parsed) return false;
  if (!evidence.rejected) return true;
  const title = evidence.parsed;
  // A low-scoring title is eligible only when it omits evidence without adding an unverified spec or descriptor.
  return Object.entries(title.attrs).every(([key, values]) => targetTitle.attrs[key]?.some((value) => values.includes(value))) &&
    title.words.every((word) => targetTitle.tokens.includes(word)) &&
    (Object.keys(targetTitle.attrs).some((key) => !title.attrs[key]?.length) ||
      targetTitle.words.some((word) => !title.tokens.includes(word)));
}

function hasConflictingRemoteSpecs(titles: ParsedTitle[]): boolean {
  return ["frequency", "buttons"].some((key) => new Set(titles.flatMap((title) => title.attrs[key] ?? [])).size > 1);
}

function corroborateWithSellerTitles(
  target: ProductMatchTarget, targetTitle: ParsedTitle, result: ScoredCandidateResult, offers: RawOffer[],
): ScoredCandidateResult {
  const evidence = cardForSellerEvidence(target, targetTitle, result);
  if (!evidence?.parsed) return result;
  const { candidate } = result;
  const sellers = offers.flatMap(({ listingTitle, price }) => listingTitle && normalizeText(listingTitle)
    ? [evaluateTorobCandidate(target, { ...candidate, titleFa: listingTitle, titleEn: undefined, specs: undefined, priceToman: price })]
    : []);
  if (sellers.some((seller) => seller.rejected || hasSellerEvidenceConflict(targetTitle, seller))) return result;
  if (targetTitle.head?.cls === "acc:remote" &&
      hasConflictingRemoteSpecs([evidence.parsed, ...sellers.flatMap(({ parsed }) => parsed ? [parsed] : [])])) return result;

  const best = sellers.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score <= result.score) return result;
  const corroborated = evaluateTorobCandidate(target, {
    ...evidence.candidate,
    titleFa: best.candidate.titleFa,
    titleEn: [evidence.candidate.titleFa, evidence.candidate.titleEn].filter(Boolean).join(" "),
  });
  if (corroborated.rejected || corroborated.score <= result.score || hasSellerEvidenceConflict(targetTitle, corroborated)) return result;
  return { ...corroborated, candidate, notes: [...corroborated.notes, SELLER_EVIDENCE_NOTE] };
}

function inspectDetails(
  target: ProductMatchTarget, targetTitle: ParsedTitle, card: TorobCandidateCard, read: TorobRead<TorobDetailsData>,
  confirmation?: TorobLinkConfirmation | null,
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
    sellerCount: details?.totalSellerCount ?? card.sellerCount,
    priceToman: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : card.priceToman,
    detailsUrl: card.detailsUrl ?? details?.detailsUrl,
  };
  const cardResult = evaluateTorobCandidate(target, candidate);
  const extraction = read.unavailable ? "unavailable" : !details || details.sellerRows == null || read.issue
    ? "incomplete" : details.sellerRows === 0 ? "empty" : "extracted";
  let result = cardResult;
  let sellerCorroborated = false;
  if (cardResult.parsed && extraction === "extracted" && details) {
    if (cardResult.status === "MATCH_CONFIRMED" && targetTitle.head?.cls === "acc:remote") {
      const sellerTitles = details.offers.flatMap(({ listingTitle }) => listingTitle ? [parseTitle(listingTitle)] : []);
      if (hasConflictingRemoteSpecs([cardResult.parsed, ...sellerTitles])) {
        const score = Math.min(result.score, (target.approveAbovePct ?? 80) - 1);
        result = {
          ...result, status: "REVIEW_REQUIRED", verdict: "review", score, noul: score / 100,
          needsReview: true, hasConflict: true,
          blockers: [...(result.blockers ?? []), "عنوان فروشندگان کارت ترب دربارهٔ فرکانس یا تعداد دکمه‌ها متناقض است"],
        };
      }
    } else if (cardResult.status !== "MATCH_CONFIRMED" && !details.offersTruncated) {
      result = corroborateWithSellerTitles(target, targetTitle, cardResult, details.offers);
      sellerCorroborated = result !== cardResult;
    }
  }
  const sellerTitle = !hasDetailTitle && !hasSearchTitle
    ? details?.offers.find((offer) => normalizeText(offer.listingTitle))?.listingTitle ?? undefined : undefined;
  const adminConfirmed = confirmation?.prk === card.prk && confirmation.origin === "admin_review" &&
    result.titleState === "present" && result.status !== "IDENTITY_MISMATCH" && !result.hasConflict;
  return {
    result,
    read,
    extraction,
    origin: hasDetailTitle ? "product_details" : hasSearchTitle ? "search_card" : sellerTitle ? "seller_listing" : undefined,
    sellerTitle,
    sellerCorroborated,
    adminConfirmed,
  };
}

function resolveIdentity(inspected: InspectedCard): TorobIdentityStatus {
  if (inspected.adminConfirmed) return "MATCH_CONFIRMED";
  return inspected.result.status;
}

function uniqueOffers(panels: TorobDetailsData[]): RawOffer[] {
  if (panels.length === 1) return panels[0].offers;
  const offers = new Map<string, RawOffer>();
  for (const panel of panels) {
    for (const offer of panel.offers) {
      const key = `${offer.shopId ? `id:${compactShopKey(offer.shopId)}` : `name:${compactShopKey(offer.shopName)}`}|${offer.sellerType ?? "online"}`;
      const prev = offers.get(key);
      const oldTime = prev?.lastChangedAt?.getTime() ?? 0;
      const newTime = offer.lastChangedAt?.getTime() ?? 0;
      if (!prev || newTime > oldTime || (newTime === oldTime && offer.price < prev.price)) offers.set(key, offer);
    }
  }
  return [...offers.values()].sort((a, b) => a.price - b.price);
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
      if (item?.sellerCorroborated) trace.reasons = [...trace.reasons.slice(0, 9), SELLER_EVIDENCE_NOTE];
      return { ...trace, observations };
    });
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

  let shortlist: TorobCandidateCard[];
  if (options.prk) {
    shortlist = [{ prk: options.prk, titleFa: "", detailsUrl: options.detailsUrl }];
  } else {
    const searchDeadline = Date.now() + SEARCH_BUDGET_MS;
    let completedSearch = false;
    let unavailable = false;
    let extractionIssue = false;
    let explanation = "هیچ کارت قابل استعلامی از جستجوی ترب دریافت نشد";
    for (const query of buildSearchQueries(options.productName, options.sku)) {
      const remaining = searchDeadline - Date.now();
      if (remaining <= 0) {
        search.queries.push({ query, rows: null, mapped: 0, issue: "search_budget" });
        break;
      }
      const read = await options.search(query, ROW_LIMIT, Math.min(remaining, SEARCH_TIMEOUT_MS));
      const decoded = read.data === undefined ? null : decodeTorobSearch(read.data, ROW_LIMIT);
      const issue = read.issue ?? decoded?.issue;
      search.queries.push({ query, rows: decoded?.rows ?? null, mapped: decoded?.candidates.length ?? 0, issue });
      if (read.blocked) return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: read.challenged, accessRestricted: true });
      unavailable ||= Boolean(read.unavailable);
      extractionIssue ||= Boolean(decoded?.issue || (issue && !read.unavailable));
      completedSearch ||= decoded?.rows != null;
      for (const card of decoded?.candidates ?? []) {
        const existing = candidates.get(card.prk);
        const query = search.queries.length;
        const observations = existing?.observations ?? [];
        if (observations.at(-1)?.query !== query) observations.push({ query, titleFa: card.titleFa || null, titleEn: card.titleEn ?? null });
        candidates.set(card.prk, {
          card: existing ? mergeCards(existing.card, card) : card,
          observations,
        });
      }
      const outcome = selectBestTorobSearchMatch(target, [...candidates.values()].map(({ card }) => card), options.matchConfig?.minSellerCount);
      ranked = outcome.allRanked;
      explanation = outcome.explanation;
      // A confirmed codeless card does not imply every matching seller is on that card.
      // Continue the bounded query expansion to discover other Torob PRKs.
      if (outcome.confident && !codeless) break;
    }

    const reviewable = ranked.filter((result) => !result.rejected);
    const sellerProbes = codeless ? ranked.filter((result) => result.rejected &&
      isSellerEvidenceProbeCandidate(target, targetTitle, result)) : [];
    // Reserve details capacity for ambiguous cards. Otherwise four high-scoring but
    // incomplete titles can starve a genuine seller-confirmed listing below them.
    const probeSlots = Math.min(2, sellerProbes.length);
    const regularSlots = MAX_DETAILS - probeSlots;
    shortlist = [
      ...reviewable.slice(0, regularSlots),
      ...sellerProbes.slice(0, probeSlots),
      ...reviewable.slice(regularSlots),
      ...sellerProbes.slice(probeSlots),
    ].slice(0, MAX_DETAILS).map((result) => result.candidate);
    if (!shortlist.length) {
      if (extractionIssue) return fail("EXTRACTION_INCOMPLETE", "ساختار بعضی پاسخ‌ها یا شناسه‌های کارت ترب قابل استخراج نبود");
      if (!completedSearch && unavailable) return fail("SOURCE_UNAVAILABLE", "پاسخی از جستجوی ترب دریافت نشد");
      if (ranked.length && !search.queries.some(({ issue }) => issue)) {
        return fail("IDENTITY_MISMATCH", explanation, { rejectedInSearch: true });
      }
      return fail("REVIEW_REQUIRED", "کارت قابل بررسی در محدودهٔ جستجوی انجام‌شده پیدا نشد");
    }
  }

  const detailsDeadline = Date.now() + DETAILS_BUDGET_MS;
  const inspect = async (card: TorobCandidateCard) => {
    const remaining = detailsDeadline - Date.now();
    if (remaining <= 0 || inspected.length >= MAX_DETAILS) return undefined;
    const read = await options.details(card, Math.min(remaining, DETAILS_TIMEOUT_MS));
    const item = inspectDetails(target, targetTitle, card, read, options.confirmation);
    inspected.push(item);
    return item;
  };
  let foundFragmentedCard = false;
  for (const card of shortlist) {
    const item = await inspect(card);
    if (!item || item.read.blocked) break;
    if (resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted") {
      const sellerCount = item.read.data?.totalSellerCount ?? item.read.data?.offers.length ?? 0;
      // Codeless products can be split across independent Torob product cards.
      if (!codeless && !foundFragmentedCard && sellerCount > 2) break;
      foundFragmentedCard = true;
    }
  }
  const primary = inspected.find((item) => resolveIdentity(item) === "MATCH_CONFIRMED" &&
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

  const offers = uniqueOffers(panels);
  const primaryShopCount = data?.totalSellerCount ?? data?.offers.length ?? 0;
  const total = Math.max(primaryShopCount + Math.max(0, offers.length - (data?.offers.length ?? 0)), offers.length);
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
  } else if (identityStatus === "MATCH_CONFIRMED" && !offers.length) {
    status = "NO_VALID_OFFERS";
    reason = "جزئیات کارت دریافت شد و پیشنهاد قابل استفاده‌ای برای قیمت‌گذاری استخراج نشد";
  }
  if (status === "IDENTITY_MISMATCH") reason = `عدم تطابق هویت کارت ترب · ${reason}`;
  const selected = candidateTrace(primary.result, primary.extraction, candidates.get(candidate.prk)?.observations.map(({ query }) => query) ?? []);
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
    priceTrend: status === "MATCH_CONFIRMED" ? await options.priceTrend(candidate) : null,
    ok: complete,
    ...(status !== "MATCH_CONFIRMED" ? { error: reason } : {}),
    torob: {
      status, reason, identityStatus, titleOrigin: primary.origin, identityScore: selected.score, search: trackSearch(),
      selected, sellerRows: data?.sellerRows == null ? null : panels.reduce((sum, panel) => sum + (panel.sellerRows ?? 0), 0),
      reportedSellers: data?.totalSellerCount ?? null, adminConfirmed: primary.adminConfirmed,
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
