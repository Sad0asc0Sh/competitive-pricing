"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSearchQueries = buildSearchQueries;
exports.resolveTorobSource = resolveTorobSource;
const client_1 = require("../ai/client");
const listing_1 = require("../pricing/listing");
const matcher_1 = require("../pricing/matcher");
const parse_1 = require("../pricing/match/parse");
const text_1 = require("../pricing/match/text");
const own_shop_1 = require("../pricing/own-shop");
const torob_identity_1 = require("./torob-identity");
const torob_payload_1 = require("./torob-payload");
const MAX_QUERIES = 6;
const ROW_LIMIT = 24;
const MAX_DETAILS = 4;
const SEARCH_BUDGET_MS = 15_000;
const DETAILS_BUDGET_MS = 16_000;
const SEARCH_TIMEOUT_MS = 4_500;
const DETAILS_TIMEOUT_MS = 7_000;
function buildSearchQueries(productName, sku) {
    const queries = [];
    const seen = new Set();
    const add = (query) => {
        const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
        const normalized = (0, text_1.normalizeText)(text);
        if (normalized.length < 3 || seen.has(normalized) || queries.length >= MAX_QUERIES)
            return;
        seen.add(normalized);
        queries.push(text);
    };
    const parsed = (0, parse_1.parseTitle)(productName, { sku });
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
            .find((word) => (0, text_1.normalizeText)(word).replace(/[^0-9a-z]/g, "").toUpperCase() === code.canon) ?? code.raw;
        add(original);
        if (brand && !original.toLowerCase().startsWith(brand))
            add(`${brand} ${original}`);
    }
    if (parsed.family === "remotag" && (!parsed.head || parsed.head.cls === "access_control")) {
        const brandLabel = brand === "beta" ? "بتا" : brand ?? "";
        add(`ریموتگ ${brandLabel}`);
        add(`اکسس کنترل ریموتگ ${brandLabel}`);
        const intercom = parsed.tokens.includes("ایفون");
        add(`برد کنترل دسترسی ریموتگ ${intercom ? "آیفون " : ""}${brandLabel}`);
        if (intercom)
            add(`ماژول کارتی ریموتی آیفون ${brandLabel}`);
    }
    else if (!code) {
        const identity = (0, parse_1.parseTitle)(core);
        const head = identity.head ? identity.tokens.slice(identity.head.at, identity.head.at + identity.head.len) : [];
        const words = identity.words.slice(0, 3);
        const remote = identity.head?.cls === "acc:remote";
        if (!remote && words.length && (brand || head.length))
            add([...head, brand, ...words].filter(Boolean).join(" "));
        if (head.length && !parsed.codes.some((item) => !item.inCompat)) {
            const [frequency] = identity.attrs.frequency ?? [];
            const rf = typeof frequency === "number" && identity.attrs.frequency.length === 1
                ? frequency >= 1_000_000 ? String(frequency / 1_000_000) : frequency >= 1_000 ? `${frequency / 1_000} khz` : `${frequency} hz`
                : undefined;
            const [descriptor] = words;
            const [buttons] = identity.attrs.buttons ?? [];
            if (remote) {
                add([...head, descriptor, rf, brand].filter(Boolean).join(" "));
                if (rf)
                    add([...head, rf, brand].filter(Boolean).join(" "));
                if (descriptor && brand)
                    add([...head, descriptor, brand].join(" "));
                if (descriptor)
                    add([...head, descriptor].join(" "));
                if (descriptor && buttons)
                    add([...head, descriptor, buttons, "دکمه"].join(" "));
            }
            else {
                if (rf)
                    add([...head, rf, brand].filter(Boolean).join(" "));
                for (const word of words)
                    add([...head, word, brand].filter(Boolean).join(" "));
            }
        }
    }
    return queries;
}
function candidateTrace(result, extraction, queries) {
    const { candidate, parsed } = result;
    return {
        prk: candidate.prk,
        url: (0, torob_payload_1.torobProductUrl)(candidate.prk),
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
function mergeCards(target, prev, next) {
    const prevResult = (0, matcher_1.evaluateTorobCandidate)(target, prev);
    const nextResult = (0, matcher_1.evaluateTorobCandidate)(target, next);
    const [stronger, fallback] = !nextResult.hasConflict && nextResult.score > prevResult.score ? [next, prev] : [prev, next];
    const titleFa = (0, text_1.normalizeText)(stronger.titleFa) ? stronger.titleFa : fallback.titleFa;
    const titleEn = (0, text_1.normalizeText)(stronger.titleEn) ? stronger.titleEn : fallback.titleEn;
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
function inspectDetails(target, targetTitle, card, read, confirmation, observations = []) {
    if (read.data?.prk && read.data.prk !== card.prk) {
        read = { issue: "details_prk_mismatch" };
    }
    const details = read.data;
    const hasDetailTitle = Boolean((0, text_1.normalizeText)(details?.titleFa) || (0, text_1.normalizeText)(details?.titleEn));
    const hasSearchTitle = Boolean((0, text_1.normalizeText)(card.titleFa) || (0, text_1.normalizeText)(card.titleEn));
    const prices = details?.offers.map(({ price }) => price).filter((price) => price > 0).sort((a, b) => a - b) ?? [];
    const candidate = {
        ...card,
        ...(hasDetailTitle ? { titleFa: details?.titleFa ?? "", titleEn: details?.titleEn, titleEvidence: details?.titleEvidence } : {}),
        ...(!hasDetailTitle && !hasSearchTitle && details?.titleEvidence?.fields.length ? { titleEvidence: details.titleEvidence } : {}),
        specs: details?.specs,
        imageUrls: [...new Set([...(details?.imageUrls ?? []), ...(card.imageUrls ?? [])])].slice(0, 4),
        sellerCount: details?.totalSellerCount ?? card.sellerCount,
        priceToman: card.priceToman ?? (prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null),
        detailsUrl: card.detailsUrl ?? details?.detailsUrl,
    };
    let cardResult = { ...(0, matcher_1.evaluateTorobCandidate)(target, { ...candidate, priceToman: null }), candidate };
    let quantityLabel = false;
    for (const observation of observations) {
        const observed = { ...candidate, titleFa: observation.titleFa ?? "", titleEn: observation.titleEn, specs: undefined };
        const evaluated = { ...(0, matcher_1.evaluateTorobCandidate)(target, { ...observed, priceToman: null }), candidate: observed };
        if (evaluated.parsed?.pack && (0, torob_identity_1.isSellerEvidenceProbeCandidate)(target, targetTitle, evaluated)) {
            quantityLabel = true;
            continue;
        }
        if (cardResult.status !== "IDENTITY_MISMATCH" && (evaluated.hasConflict ||
            (cardResult.parsed && evaluated.parsed && (0, torob_identity_1.conflictingEvidence)(cardResult.parsed, evaluated.parsed)))) {
            cardResult = { ...(0, torob_identity_1.reviewCard)(cardResult, target, "شواهد عنوان کارت در جست‌وجو و جزئیات ترب متناقض است"), hasConflict: true };
            break;
        }
    }
    const extraction = read.unavailable ? "unavailable" : !details || details.sellerRows == null || read.issue
        ? "incomplete" : details.sellerRows === 0 ? "empty" : "extracted";
    const cardSource = hasDetailTitle ? "product_details" : hasSearchTitle ? "search_card" : undefined;
    const { result, sellerCorroborated, offers, ambiguousPack } = (0, torob_identity_1.inspectSellerOffers)(target, targetTitle, cardResult, details?.offers ?? [], {
        origin: read.origin, cardSource, complete: extraction === "extracted", truncated: Boolean(details?.offersTruncated), quantityLabel,
    });
    const sellerTitle = !hasDetailTitle && !hasSearchTitle
        ? details?.offers.find((offer) => (0, text_1.normalizeText)(offer.listingTitle))?.listingTitle ?? undefined : undefined;
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
function resolveIdentity(inspected) {
    if (inspected.adminConfirmed)
        return "MATCH_CONFIRMED";
    return inspected.result.status;
}
function uniqueOffers(offers) {
    const confirmed = new Map();
    const excluded = [];
    for (const offer of offers) {
        if (offer.torobIdentity?.status !== "MATCH_CONFIRMED") {
            excluded.push(offer);
            continue;
        }
        const key = `${offer.shopId ? `id:${(0, own_shop_1.compactShopKey)(offer.shopId)}` : `name:${(0, own_shop_1.compactShopKey)(offer.shopName)}`}|${offer.sellerType ?? "online"}`;
        const prev = confirmed.get(key);
        const oldTime = prev?.lastChangedAt?.getTime() ?? 0;
        const newTime = offer.lastChangedAt?.getTime() ?? 0;
        if (!prev || newTime > oldTime || (newTime === oldTime && offer.price < prev.price))
            confirmed.set(key, offer);
    }
    return [...confirmed.values(), ...excluded].sort((a, b) => a.price - b.price);
}
async function resolveTorobSource(options) {
    const target = {
        productName: options.productName,
        sku: options.sku,
        anchorPriceToman: options.anchorPriceToman,
        rejectBelowPct: options.matchConfig?.rejectBelowPct,
        approveAbovePct: options.matchConfig?.approveAbovePct,
    };
    const targetTitle = (0, parse_1.parseTitle)(target.productName, { sku: target.sku });
    const codeless = !targetTitle.codes.some((code) => !code.inCompat);
    const search = { queries: [], candidates: [], accepted: 0, eligible: 0 };
    const candidates = new Map();
    const inspected = [];
    let ranked = [];
    let aiIdentityCheck = null;
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
    const fail = (status, reason, extraMeta = {}) => ({
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
    const searchCards = async (stopOnConfirmedCard) => {
        const searchDeadline = Date.now() + searchTimeLeft;
        while (nextQuery < queries.length) {
            const query = queries[nextQuery++];
            const remaining = searchDeadline - Date.now();
            if (remaining <= 0) {
                search.queries.push({ query, rows: null, mapped: 0, issue: "search_budget" });
                break;
            }
            const read = await options.search(query, ROW_LIMIT, Math.min(remaining, SEARCH_TIMEOUT_MS));
            const decoded = read.data === undefined ? null : (0, torob_payload_1.decodeTorobSearch)(read.data, ROW_LIMIT);
            const issue = read.issue ?? decoded?.issue;
            search.queries.push({ query, rows: decoded?.rows ?? null, mapped: decoded?.candidates.length ?? 0, issue, origin: read.origin });
            if (read.blocked)
                return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: read.challenged, accessRestricted: true });
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
            const outcome = (0, matcher_1.selectBestTorobSearchMatch)(target, [...candidates.values()].map(({ card }) => card), options.matchConfig?.minSellerCount);
            ranked = outcome.allRanked;
            explanation = outcome.explanation;
            if (outcome.confident && stopOnConfirmedCard)
                break;
        }
        searchTimeLeft = Math.max(0, searchDeadline - Date.now());
        return undefined;
    };
    const detailShortlist = () => {
        if (options.prk)
            return [{ prk: options.prk, titleFa: "", detailsUrl: options.detailsUrl }];
        const remaining = ranked.filter((result) => !inspected.some((item) => item.result.candidate.prk === result.candidate.prk));
        const reviewable = remaining.filter((result) => !result.rejected);
        const sellerProbes = codeless ? remaining.filter((result) => result.rejected &&
            (0, torob_identity_1.isSellerEvidenceProbeCandidate)(target, targetTitle, result)) : [];
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
    if (searchFailure)
        return searchFailure;
    const shortlist = detailShortlist();
    if (!shortlist.length) {
        if (extractionIssue)
            return fail("EXTRACTION_INCOMPLETE", "ساختار بعضی پاسخ‌ها یا شناسه‌های کارت ترب قابل استخراج نبود");
        if (!completedSearch && unavailable)
            return fail("SOURCE_UNAVAILABLE", "پاسخی از جستجوی ترب دریافت نشد");
        if (ranked.length && !search.queries.some(({ issue }) => issue)) {
            return fail("IDENTITY_MISMATCH", explanation, { rejectedInSearch: true });
        }
        return fail("REVIEW_REQUIRED", "کارت قابل بررسی در محدودهٔ جستجوی انجام‌شده پیدا نشد");
    }
    const detailsDeadline = Date.now() + DETAILS_BUDGET_MS;
    const inspect = async (card) => {
        const remaining = detailsDeadline - Date.now();
        if (remaining <= 0 || inspected.length >= MAX_DETAILS)
            return undefined;
        const read = await options.details(card, Math.min(remaining, DETAILS_TIMEOUT_MS));
        const item = inspectDetails(target, targetTitle, card, read, options.confirmation, candidates.get(card.prk)?.observations);
        inspected.push(item);
        return item;
    };
    const verifiedOffers = (item) => resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted"
        ? item.offers.filter((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED") : [];
    const inspectShortlist = async (cards) => {
        for (const card of cards) {
            const item = await inspect(card);
            if (!item || item.read.blocked)
                break;
            if (!codeless && verifiedOffers(item).length > 2)
                break;
        }
    };
    await inspectShortlist(shortlist);
    // A model-code hit can stop the first search stage, but the card may have no eligible sellers.
    if (nextQuery < queries.length && searchTimeLeft > 0 && inspected.length < MAX_DETAILS &&
        !inspected.some((item) => item.read.blocked || verifiedOffers(item).length > 0)) {
        const resumedFailure = await searchCards(false);
        if (resumedFailure)
            return resumedFailure;
        await inspectShortlist(detailShortlist());
    }
    const primary = inspected.find((item) => verifiedOffers(item).length > 0)
        ?? inspected.find((item) => resolveIdentity(item) === "MATCH_CONFIRMED" &&
            (item.extraction === "extracted" || item.extraction === "empty"))
        ?? inspected.find((item) => item.result.status === "REVIEW_REQUIRED" && item.extraction === "extracted")
        ?? inspected.find((item) => !item.result.rejected) ?? inspected[0];
    if (!primary)
        return fail("EXTRACTION_INCOMPLETE", "مهلت دریافت جزئیات کارت ترب پایان یافت");
    const { candidate } = primary.result;
    const data = primary.read.data;
    const panels = data ? [data] : [];
    const panelIds = [candidate.prk];
    let identityStatus = resolveIdentity(primary);
    let reason = primary.adminConfirmed ? "ارتباط ثبت‌شده با تأیید مدیر و بدون تعارض مشخصات"
        : primary.result.rejectReason ?? primary.result.blockers?.[0] ??
            (primary.sellerCorroborated ? torob_identity_1.SELLER_EVIDENCE_NOTE : primary.result.notes[0]) ?? "هویت کارت بر اساس عنوان و مشخصات سنجیده شد";
    const searchRank = ranked.find((result) => result.candidate.prk === candidate.prk);
    if (!primary.adminConfirmed && searchRank?.status === "REVIEW_REQUIRED" && primary.result.status === "MATCH_CONFIRMED" &&
        (0, matcher_1.evaluateTorobCandidate)(target, searchRank.candidate).status === "MATCH_CONFIRMED") {
        identityStatus = "REVIEW_REQUIRED";
        reason = searchRank.blockers?.at(-1) ?? "چند کارت هم‌زمان به محصول می‌خورند";
    }
    const blocked = inspected.find((item) => item.read.blocked);
    const aiCandidates = [primary.result, ...ranked.filter((result) => result.candidate.prk !== candidate.prk)
            .map((result) => inspected.find((item) => item.result.candidate.prk === result.candidate.prk)?.result ?? result)]
        .filter((result) => !result.rejected && result.titleState === "present").slice(0, 10);
    if (!blocked && !primary.read.issue && identityStatus !== "IDENTITY_MISMATCH" && aiCandidates.length &&
        options.matchConfig?.aiIdentityEnabled && (!primary.adminConfirmed || aiCandidates.length > 1) && await (0, client_1.aiEnabled)()) {
        aiIdentityCheck = await (0, client_1.verifyTorobMatchesWithAI)({
            productName: options.productName, sku: options.sku, category: options.category,
            candidates: aiCandidates.map(({ candidate: card }) => card),
        });
        if (aiIdentityCheck?.verdict === "no_match" ||
            (aiIdentityCheck?.verdict === "match" && aiIdentityCheck.primaryPrk && aiIdentityCheck.primaryPrk !== candidate.prk)) {
            identityStatus = "REVIEW_REQUIRED";
            reason = "نظر مدل زبانی با انتخاب تطبیق‌دهنده ناسازگار است و به بررسی مدیر نیاز دارد";
        }
        else if (data && identityStatus === "MATCH_CONFIRMED" && aiIdentityCheck?.verdict === "match") {
            for (const rankedCard of ranked) {
                const id = rankedCard.candidate.prk;
                if (!aiIdentityCheck.matchedPrks.includes(id) || !(0, matcher_1.areCompatibleConfirmedIdentities)(primary.result, rankedCard) ||
                    inspected.some((item) => item.result.candidate.prk === id))
                    continue;
                const item = await inspect(rankedCard.candidate);
                if (!item || item.read.blocked)
                    break;
            }
        }
    }
    const restriction = inspected.find((item) => item.read.blocked);
    if (!restriction && data && identityStatus === "MATCH_CONFIRMED") {
        const confirmed = inspected.filter((item) => (item.extraction === "extracted" || item.extraction === "empty") &&
            item.result.status === "MATCH_CONFIRMED" && !item.result.hasConflict);
        if (confirmed.some((a, i) => confirmed.slice(i + 1).some((b) => !(0, matcher_1.areCompatibleConfirmedIdentities)(a.result, b.result)))) {
            identityStatus = "REVIEW_REQUIRED";
            reason = "چند کارت با هویت یا مشخصات متفاوت هم‌زمان با محصول سایت منطبق‌اند";
        }
        else {
            for (const item of confirmed) {
                if (item !== primary && item.extraction === "extracted" && item.read.data &&
                    (0, matcher_1.areCompatibleConfirmedIdentities)(primary.result, item.result)) {
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
            (!restriction && identityStatus === "MATCH_CONFIRMED" && panelPrks.has(identity.prk)))
            return offer;
        return { ...offer, torobIdentity: { ...identity, status: "REVIEW_REQUIRED",
                reason: item.result.blockers?.[0] ?? "کارت این پیشنهاد در مجموعهٔ پنل‌های تأییدشده و سازگار قرار نگرفت" } };
    })));
    const primaryShopCount = data?.totalSellerCount ?? data?.offers.length ?? 0;
    const total = Math.max(primaryShopCount, offers.filter((offer) => panelPrks.has(offer.torobIdentity?.prk ?? "")).length);
    let status = identityStatus;
    if (restriction) {
        status = "SOURCE_UNAVAILABLE";
        reason = "ترب دسترسی دریافت جزئیات را محدود کرده است";
    }
    else if (primary.extraction === "unavailable" || primary.extraction === "incomplete") {
        status = "EXTRACTION_INCOMPLETE";
        reason = {
            details_prk_mismatch: "شناسهٔ پاسخ جزئیات با کارت درخواست‌شده متفاوت است",
            details_timeout: "مهلت دریافت جزئیات کارت ترب پایان یافت",
        }[primary.read.issue ?? ""] ?? "کارت ترب مشخص است ولی دریافت یا استخراج جزئیات کامل نشد";
        const http = /^(mcp|torob)_http_(\d{3})$/.exec(primary.read.issue ?? "");
        if (http)
            reason += ` (${http[1] === "mcp" ? "MCP" : "Torob"} HTTP ${http[2]})`;
    }
    else if (identityStatus === "EXTRACTION_INCOMPLETE") {
        reason = primary.sellerTitle
            ? "عنوان فروشنده پیدا شد و برای بازبینی ثبت شد. عنوان معتبر کارت ترب در دسترس نیست"
            : "عنوان قابل استفادهٔ کارت ترب در جستجو و جزئیات دریافت نشد";
    }
    else if (identityStatus === "MATCH_CONFIRMED" && !offers.some((offer) => offer.torobIdentity?.status === "MATCH_CONFIRMED")) {
        const needsSellerReview = offers.some((offer) => offer.torobIdentity?.status === "REVIEW_REQUIRED");
        status = needsSellerReview ? "REVIEW_REQUIRED" : "NO_VALID_OFFERS";
        reason = needsSellerReview ? "هویت کارت احراز شد و هویت پیشنهادهای فروشندگان نیازمند بازبینی است"
            : "جزئیات کارت دریافت شد و پیشنهاد قابل استفاده‌ای برای قیمت‌گذاری استخراج نشد";
    }
    if (status === "IDENTITY_MISMATCH")
        reason = `عدم تطابق هویت کارت ترب · ${reason}`;
    const selected = { ...candidateTrace(primary.result, primary.extraction, candidates.get(candidate.prk)?.observations.map(({ query }) => query) ?? []),
        origin: primary.read.origin };
    const complete = status !== "EXTRACTION_INCOMPLETE" && status !== "SOURCE_UNAVAILABLE";
    return {
        source: "torob",
        prk: candidate.prk,
        productTitle: candidate.titleFa || undefined,
        productTitleEn: candidate.titleEn ?? null,
        detailsUrl: (0, torob_payload_1.safeTorobDetailsUrl)(candidate.detailsUrl, candidate.prk),
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
            panels: panels.map((panel, i) => (0, listing_1.listingPanel)(panelIds[i], panel.offers, panel.totalSellerCount ?? panel.offers.length)),
            ...(panelIds.length > 1 ? { mergedPanelPrks: panelIds } : {}),
            offersTruncated: panels.some((panel) => panel.offersTruncated),
            onlineOfferCount: data?.onlineOfferCount ?? 0,
        },
    };
}
