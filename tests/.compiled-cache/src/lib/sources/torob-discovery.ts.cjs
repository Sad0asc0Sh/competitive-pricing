"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSearchQueries = buildSearchQueries;
exports.resolveTorobSource = resolveTorobSource;
const client_1 = require("../ai/client");
const listing_1 = require("../pricing/listing");
const matcher_1 = require("../pricing/matcher");
const compare_1 = require("../pricing/match/compare");
const lexicon_1 = require("../pricing/match/lexicon");
const parse_1 = require("../pricing/match/parse");
const text_1 = require("../pricing/match/text");
const own_shop_1 = require("../pricing/own-shop");
const torob_payload_1 = require("./torob-payload");
const MAX_QUERIES = 5;
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
        if (words.length && (brand || head.length))
            add([...head, brand, ...words].filter(Boolean).join(" "));
        if (head.length && !parsed.codes.some((item) => !item.inCompat)) {
            const frequency = identity.attrs.frequency;
            if (frequency?.length === 1 && typeof frequency[0] === "number") {
                const hz = frequency[0];
                const label = hz >= 1_000_000 ? String(hz / 1_000_000) : hz >= 1_000 ? `${hz / 1_000} khz` : `${hz} hz`;
                add([...head, label, brand].join(" "));
            }
            for (const word of words)
                add([...head, word, brand].join(" "));
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
    };
}
function mergeCards(prev, next) {
    const titleFa = (0, text_1.normalizeText)(prev.titleFa) ? prev.titleFa : next.titleFa;
    const titleEn = (0, text_1.normalizeText)(prev.titleEn) ? prev.titleEn : next.titleEn;
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
const SELLER_EVIDENCE_NOTE = "عنوان فروشندگان شواهد تطابق هویت کارت ترب را تکمیل کرد";
function identityBrands(title) {
    return [...title.brands, ...title.impliedBrands];
}
function hasSellerEvidenceConflict(target, result) {
    const card = result.parsed;
    if (!card || result.hasConflict || !(0, lexicon_1.areKnownBrandSetsCompatible)(identityBrands(target), identityBrands(card)))
        return true;
    if (card.codes.some((code) => !code.inCompat && !target.codes.some((other) => !other.inCompat && ["equal", "alias", "tail"].includes((0, compare_1.relateCodes)(code, other)))))
        return true;
    if (card.bundleWith.some((cls) => !target.bundleWith.includes(cls)) ||
        card.withAccessories.some((cls) => !target.withAccessories.includes(cls)) ||
        (card.trailingAccessory && card.trailingAccessory !== target.trailingAccessory))
        return true;
    return card.head?.cls === "acc:remote" && card.hits.some(({ cls }) => cls !== "acc:remote" && !target.hits.some((hit) => hit.cls === cls));
}
function cardForSellerEvidence(target, targetTitle, result) {
    const parsed = result.parsed;
    if (!parsed)
        return undefined;
    if (parsed.pack && !targetTitle.pack) {
        const { qty, word } = parsed.pack;
        const ratio = (result.candidate.priceToman ?? 0) / (target.anchorPriceToman ?? 0);
        if (parsed.head?.cls !== "acc:remote" || targetTitle.head?.cls !== "acc:remote" ||
            qty == null || qty > 16 || parsed.attrs.buttons?.length || !/ (?:عددی|تایی)$/.test(word) ||
            (targetTitle.attrs.buttons?.length && !targetTitle.attrs.buttons.includes(qty)) ||
            !(ratio >= 0.55 && ratio <= 1.85) || parsed.tokens.some((token) => lexicon_1.PACK_WORDS.has(token)))
            return undefined;
        // Re-evaluate the card with only the ambiguous quantity phrase removed.
        const stripQuantity = (title) => ` ${(0, text_1.normalizeText)(title)} `.replace(` ${word} `, " ").trim();
        const { candidate } = result;
        result = (0, matcher_1.evaluateTorobCandidate)(target, { ...candidate, titleFa: stripQuantity(candidate.titleFa), titleEn: stripQuantity(candidate.titleEn) });
        if (result.parsed?.pack)
            return undefined;
    }
    return hasSellerEvidenceConflict(targetTitle, result) ? undefined : result;
}
function isSellerEvidenceProbeCandidate(target, targetTitle, result) {
    const card = result.parsed;
    if (!card?.head || card.head.cls !== targetTitle.head?.cls || !identityBrands(card).length || !identityBrands(targetTitle).length)
        return false;
    const evidence = cardForSellerEvidence(target, targetTitle, result);
    if (!evidence?.parsed)
        return false;
    if (!evidence.rejected)
        return true;
    const title = evidence.parsed;
    // A low-scoring title is eligible only when it omits evidence without adding an unverified spec or descriptor.
    return Object.entries(title.attrs).every(([key, values]) => targetTitle.attrs[key]?.some((value) => values.includes(value))) &&
        title.words.every((word) => targetTitle.tokens.includes(word)) &&
        (Object.keys(targetTitle.attrs).some((key) => !title.attrs[key]?.length) ||
            targetTitle.words.some((word) => !title.tokens.includes(word)));
}
function hasConflictingRemoteSpecs(titles) {
    return ["frequency", "buttons"].some((key) => new Set(titles.flatMap((title) => title.attrs[key] ?? [])).size > 1);
}
function corroborateWithSellerTitles(target, targetTitle, result, offers) {
    const evidence = cardForSellerEvidence(target, targetTitle, result);
    if (!evidence?.parsed)
        return result;
    const { candidate } = result;
    const sellers = offers.flatMap(({ listingTitle, price }) => listingTitle && (0, text_1.normalizeText)(listingTitle)
        ? [(0, matcher_1.evaluateTorobCandidate)(target, { ...candidate, titleFa: listingTitle, titleEn: undefined, specs: undefined, priceToman: price })]
        : []);
    if (sellers.some((seller) => seller.rejected || hasSellerEvidenceConflict(targetTitle, seller)))
        return result;
    if (targetTitle.head?.cls === "acc:remote" &&
        hasConflictingRemoteSpecs([evidence.parsed, ...sellers.flatMap(({ parsed }) => parsed ? [parsed] : [])]))
        return result;
    const best = sellers.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score <= result.score)
        return result;
    const corroborated = (0, matcher_1.evaluateTorobCandidate)(target, {
        ...evidence.candidate,
        titleFa: best.candidate.titleFa,
        titleEn: [evidence.candidate.titleFa, evidence.candidate.titleEn].filter(Boolean).join(" "),
    });
    if (corroborated.rejected || corroborated.score <= result.score || hasSellerEvidenceConflict(targetTitle, corroborated))
        return result;
    return { ...corroborated, candidate, notes: [...corroborated.notes, SELLER_EVIDENCE_NOTE] };
}
function inspectDetails(target, targetTitle, card, read, confirmation) {
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
        sellerCount: details?.totalSellerCount ?? card.sellerCount,
        priceToman: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : card.priceToman,
        detailsUrl: card.detailsUrl ?? details?.detailsUrl,
    };
    const cardResult = (0, matcher_1.evaluateTorobCandidate)(target, candidate);
    const extraction = read.unavailable ? "unavailable" : !details || details.sellerRows == null || read.issue
        ? "incomplete" : details.sellerRows === 0 ? "empty" : "extracted";
    let result = cardResult;
    let sellerCorroborated = false;
    if (cardResult.parsed && extraction === "extracted" && details) {
        if (cardResult.status === "MATCH_CONFIRMED" && targetTitle.head?.cls === "acc:remote") {
            const sellerTitles = details.offers.flatMap(({ listingTitle }) => listingTitle ? [(0, parse_1.parseTitle)(listingTitle)] : []);
            if (hasConflictingRemoteSpecs([cardResult.parsed, ...sellerTitles])) {
                const score = Math.min(result.score, (target.approveAbovePct ?? 80) - 1);
                result = {
                    ...result, status: "REVIEW_REQUIRED", verdict: "review", score, noul: score / 100,
                    needsReview: true, hasConflict: true,
                    blockers: [...(result.blockers ?? []), "عنوان فروشندگان کارت ترب دربارهٔ فرکانس یا تعداد دکمه‌ها متناقض است"],
                };
            }
        }
        else if (cardResult.status !== "MATCH_CONFIRMED" && !details.offersTruncated) {
            result = corroborateWithSellerTitles(target, targetTitle, cardResult, details.offers);
            sellerCorroborated = result !== cardResult;
        }
    }
    const sellerTitle = !hasDetailTitle && !hasSearchTitle
        ? details?.offers.find((offer) => (0, text_1.normalizeText)(offer.listingTitle))?.listingTitle ?? undefined : undefined;
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
function resolveIdentity(inspected) {
    if (inspected.adminConfirmed)
        return "MATCH_CONFIRMED";
    return inspected.result.status;
}
function uniqueOffers(panels) {
    if (panels.length === 1)
        return panels[0].offers;
    const offers = new Map();
    for (const panel of panels) {
        for (const offer of panel.offers) {
            const key = `${offer.shopId ? `id:${(0, own_shop_1.compactShopKey)(offer.shopId)}` : `name:${(0, own_shop_1.compactShopKey)(offer.shopName)}`}|${offer.sellerType ?? "online"}`;
            const prev = offers.get(key);
            const oldTime = prev?.lastChangedAt?.getTime() ?? 0;
            const newTime = offer.lastChangedAt?.getTime() ?? 0;
            if (!prev || newTime > oldTime || (newTime === oldTime && offer.price < prev.price))
                offers.set(key, offer);
        }
    }
    return [...offers.values()].sort((a, b) => a.price - b.price);
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
            if (item?.sellerCorroborated)
                trace.reasons = [...trace.reasons.slice(0, 9), SELLER_EVIDENCE_NOTE];
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
    const fail = (status, reason, extraMeta = {}) => ({
        source: "torob", prk: options.prk, offers: [], totalSellerCount: 0, fetchedAt: options.now,
        ok: false, error: reason,
        torob: { status, reason, sellerRows: null, reportedSellers: null, search: trackSearch(),
            ...(status === "IDENTITY_MISMATCH" || status === "REVIEW_REQUIRED" ? { identityStatus: status } : {}) },
        meta: { ...meta(), ...extraMeta },
    });
    let shortlist;
    if (options.prk) {
        shortlist = [{ prk: options.prk, titleFa: "", detailsUrl: options.detailsUrl }];
    }
    else {
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
            const decoded = read.data === undefined ? null : (0, torob_payload_1.decodeTorobSearch)(read.data, ROW_LIMIT);
            const issue = read.issue ?? decoded?.issue;
            search.queries.push({ query, rows: decoded?.rows ?? null, mapped: decoded?.candidates.length ?? 0, issue });
            if (read.blocked)
                return fail("SOURCE_UNAVAILABLE", "ترب دسترسی جستجو را محدود کرده است", { challenged: read.challenged, accessRestricted: true });
            unavailable ||= Boolean(read.unavailable);
            extractionIssue ||= Boolean(decoded?.issue || (issue && !read.unavailable));
            completedSearch ||= decoded?.rows != null;
            for (const card of decoded?.candidates ?? []) {
                const existing = candidates.get(card.prk);
                const query = search.queries.length;
                const observations = existing?.observations ?? [];
                if (observations.at(-1)?.query !== query)
                    observations.push({ query, titleFa: card.titleFa || null, titleEn: card.titleEn ?? null });
                candidates.set(card.prk, {
                    card: existing ? mergeCards(existing.card, card) : card,
                    observations,
                });
            }
            const outcome = (0, matcher_1.selectBestTorobSearchMatch)(target, [...candidates.values()].map(({ card }) => card), options.matchConfig?.minSellerCount);
            ranked = outcome.allRanked;
            explanation = outcome.explanation;
            if (outcome.confident && (!codeless || (outcome.best?.candidate.sellerCount ?? 0) > 1))
                break;
        }
        shortlist = ranked
            .filter((result) => !result.rejected || (codeless && isSellerEvidenceProbeCandidate(target, targetTitle, result)))
            .slice(0, MAX_DETAILS).map((result) => result.candidate);
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
    }
    const detailsDeadline = Date.now() + DETAILS_BUDGET_MS;
    const inspect = async (card) => {
        const remaining = detailsDeadline - Date.now();
        if (remaining <= 0 || inspected.length >= MAX_DETAILS)
            return undefined;
        const read = await options.details(card, Math.min(remaining, DETAILS_TIMEOUT_MS));
        const item = inspectDetails(target, targetTitle, card, read, options.confirmation);
        inspected.push(item);
        return item;
    };
    let foundFragmentedCard = false;
    for (const card of shortlist) {
        const item = await inspect(card);
        if (!item || item.read.blocked)
            break;
        if (resolveIdentity(item) === "MATCH_CONFIRMED" && item.extraction === "extracted") {
            const sellerCount = item.read.data?.totalSellerCount ?? item.read.data?.offers.length ?? 0;
            if (!foundFragmentedCard && sellerCount > 2)
                break;
            foundFragmentedCard = true;
        }
    }
    const primary = inspected.find((item) => resolveIdentity(item) === "MATCH_CONFIRMED" &&
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
            (primary.sellerCorroborated ? SELLER_EVIDENCE_NOTE : primary.result.notes[0]) ?? "هویت کارت بر اساس عنوان و مشخصات سنجیده شد";
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
    const offers = uniqueOffers(panels);
    const primaryShopCount = data?.totalSellerCount ?? data?.offers.length ?? 0;
    const total = Math.max(primaryShopCount + Math.max(0, offers.length - (data?.offers.length ?? 0)), offers.length);
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
    else if (identityStatus === "MATCH_CONFIRMED" && !offers.length) {
        status = "NO_VALID_OFFERS";
        reason = "جزئیات کارت دریافت شد و پیشنهاد قابل استفاده‌ای برای قیمت‌گذاری استخراج نشد";
    }
    if (status === "IDENTITY_MISMATCH")
        reason = `عدم تطابق هویت کارت ترب · ${reason}`;
    const selected = candidateTrace(primary.result, primary.extraction, candidates.get(candidate.prk)?.observations.map(({ query }) => query) ?? []);
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
            panels: panels.map((panel, i) => (0, listing_1.listingPanel)(panelIds[i], panel.offers, panel.totalSellerCount ?? panel.offers.length)),
            ...(panelIds.length > 1 ? { mergedPanelPrks: panelIds } : {}),
            offersTruncated: panels.some((panel) => panel.offersTruncated),
            onlineOfferCount: data?.onlineOfferCount ?? 0,
        },
    };
}
