"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIRMED_HINT_FRESHNESS_DAYS = exports.InMemoryTorobHybridIndex = void 0;
exports.buildCharTrigrams = buildCharTrigrams;
exports.jaccardTrigramSimilarity = jaccardTrigramSimilarity;
exports.canonicalizeCatalogEntry = canonicalizeCatalogEntry;
exports.buildLinkRecordsFromSource = buildLinkRecordsFromSource;
exports.loadProductDiscoveryHints = loadProductDiscoveryHints;
exports.persistDiscoveryGraphAndCatalog = persistDiscoveryGraphAndCatalog;
exports.syncAdminPrkLink = syncAdminPrkLink;
const index_ts_1 = require("../../db/index.ts");
const matcher_1 = require("../pricing/matcher");
const parse_1 = require("../pricing/match/parse");
const text_1 = require("../pricing/match/text");
const torob_identity_1 = require("./torob-identity");
const PERSIAN_NUMBER_WORD_BY_VALUE = new Map(Object.entries(text_1.NUMBER_WORDS).map(([word, num]) => [num, word]));
const CONTROLLED_SYNONYM_MAP = [
    [/(?:^|\s)(?:کد\s*لرن|لرن\s*کد|کدلرن|لرن|learn\s*code)(?=\s|$)/u, ["لرن", "کد لرن", "syn:learn_code"]],
    [/(?:^|\s)(?:دیواری|wall\s*mount(?:ed)?)(?=\s|$)/u, ["دیواری", "syn:wall_mount"]],
    [/(?:^|\s)(?:بلوتوثی|بلوتوث|bluetooth)(?=\s|$)/u, ["بلوتوث", "بلوتوثی", "syn:bt"]],
    [/(?:^|\s)(?:ریموت|ریموت\s*کنترل|کنترل)(?=\s|$)/u, ["ریموت", "کنترل", "syn:remote"]],
];
function formatAttrTokens(key, values) {
    if (!values?.length)
        return [];
    const out = [];
    for (const val of values) {
        out.push(`attr:${key}:${String(val)}`);
        if (key === "frequency" && typeof val === "number") {
            if (val >= 1_000_000) {
                const mhz = val / 1_000_000;
                out.push(String(mhz), `${mhz}mhz`, `${mhz} مگاهرتز`, `فرکانس ${mhz}`);
            }
            else if (val >= 1_000) {
                const khz = val / 1_000;
                out.push(String(khz), `${khz}khz`, `${khz} کیلوهرتز`);
            }
        }
        else if (key === "ch" && typeof val === "number") {
            const word = PERSIAN_NUMBER_WORD_BY_VALUE.get(val);
            out.push(`${val} کانال`, `${val}ch`, ...(word ? [`${word} کانال`] : []));
        }
        else if (key === "buttons" && typeof val === "number") {
            const word = PERSIAN_NUMBER_WORD_BY_VALUE.get(val);
            out.push(`${val} دکمه`, `${val} کلید`, ...(word ? [`${word} دکمه`] : []));
        }
    }
    return out;
}
function buildCharTrigrams(input) {
    const clean = `  ${(0, text_1.normalizeText)(input)}  `;
    const grams = new Set();
    if (clean.length < 3) {
        if (clean.trim())
            grams.add(clean.trim());
        return grams;
    }
    for (let i = 0; i <= clean.length - 3; i++) {
        grams.add(clean.slice(i, i + 3));
    }
    return grams;
}
function jaccardTrigramSimilarity(a, b) {
    if (!a.size || !b.size)
        return 0;
    let intersect = 0;
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const gram of smaller)
        if (larger.has(gram))
            intersect++;
    const union = a.size + b.size - intersect;
    return union > 0 ? intersect / union : 0;
}
/** Canonicalize card titles, specs, and corroborated seller text into an indexable document. */
function canonicalizeCatalogEntry(input) {
    const combinedRaw = [input.titleFa, input.titleEn].filter(Boolean).join(" ").trim();
    const parsed = (0, parse_1.parseIdentityTitle)(combinedRaw, input.specs);
    const normalizedTitle = (0, text_1.normalizeText)(combinedRaw);
    const tokens = new Set((0, text_1.tokenize)(normalizedTitle));
    const canonicalAttrs = {};
    for (const [k, vals] of Object.entries(parsed.attrs)) {
        if (!vals?.length)
            continue;
        canonicalAttrs[k] = vals;
        for (const tok of formatAttrTokens(k, vals)) {
            for (const sub of (0, text_1.tokenize)(tok))
                tokens.add(sub);
            tokens.add(tok);
        }
    }
    if (parsed.head?.cls)
        tokens.add(`class:${parsed.head.cls}`);
    const brands = [...new Set([...parsed.brands, ...parsed.impliedBrands])];
    for (const b of brands)
        tokens.add(`brand:${b}`);
    const models = parsed.codes.filter((c) => !c.inCompat).map((c) => c.canon);
    for (const m of models)
        tokens.add(`code:${m}`);
    for (const sTitle of (input.sellerTitles ?? []).slice(0, 12)) {
        const sNorm = (0, text_1.normalizeText)(sTitle);
        if (!sNorm)
            continue;
        for (const t of (0, text_1.tokenize)(sNorm))
            tokens.add(t);
        const sParsed = (0, parse_1.parseIdentityTitle)(sNorm, input.specs);
        for (const [k, vals] of Object.entries(sParsed.attrs)) {
            for (const tok of formatAttrTokens(k, vals))
                tokens.add(tok);
        }
    }
    if (input.category) {
        for (const t of (0, text_1.tokenize)((0, text_1.normalizeText)(input.category)))
            tokens.add(t);
    }
    const expansionSource = [normalizedTitle, ...(input.sellerTitles ?? []).map((t) => (0, text_1.normalizeText)(t))].join(" ");
    for (const [pattern, aliases] of CONTROLLED_SYNONYM_MAP) {
        if (pattern.test(expansionSource)) {
            for (const alias of aliases) {
                for (const sub of (0, text_1.tokenize)(alias))
                    tokens.add(sub);
                tokens.add(alias);
            }
        }
    }
    const searchDocument = [...tokens].join(" ");
    return {
        normalizedTitle,
        searchDocument,
        tokenSet: tokens,
        trigrams: buildCharTrigrams(normalizedTitle || searchDocument),
        brands,
        models,
        canonicalAttrs,
        parsed,
    };
}
function buildTargetQuerySignals(productName, sku, category) {
    const doc = canonicalizeCatalogEntry({ titleFa: productName, titleEn: sku ?? null, category });
    const queryTerms = new Set((0, text_1.tokenize)((0, text_1.normalizeText)([productName, sku].filter(Boolean).join(" "))));
    for (const tok of doc.tokenSet)
        queryTerms.add(tok);
    return { doc, queryTerms };
}
function rrfRankScore(cards, targetInput, limit) {
    if (!cards.length)
        return [];
    const { doc: targetDoc, queryTerms } = buildTargetQuerySignals(targetInput.productName, targetInput.sku, targetInput.category);
    const target = {
        productName: targetInput.productName,
        sku: targetInput.sku,
        anchorPriceToman: targetInput.anchorPriceToman,
    };
    const eligible = [];
    for (const entry of cards) {
        if (targetDoc.parsed.head?.cls && entry.doc.parsed.head?.cls &&
            targetDoc.parsed.head.cls !== entry.doc.parsed.head.cls)
            continue;
        const matcherRes = (0, matcher_1.evaluateTorobCandidate)(target, {
            prk: entry.prk,
            titleFa: entry.titleFa ?? "",
            titleEn: entry.titleEn,
            specs: entry.specs,
            priceToman: entry.lastPriceToman,
            sellerCount: entry.reportedSellerCount,
        });
        const cardElig = (0, torob_identity_1.assessDiscoveryEligibility)(target, targetDoc.parsed, matcherRes, { fromSimilarOrKnown: true });
        // Stage A high-recall gate: block only hard structural contradictions; allow weak/cosmetic canonical cards
        // and cards whose stronger identity evidence lives in seller listing titles.
        if (cardElig.hardContradictions.length > 0)
            continue;
        let bestMatcherScore = matcherRes.score;
        let bestMatcherStatus = matcherRes.status;
        let bestHardRejected = matcherRes.rejected;
        let sellerEligible = false;
        if (entry.sellerTitles?.length) {
            for (const sTitle of entry.sellerTitles.slice(0, 12)) {
                const sRes = (0, matcher_1.evaluateTorobCandidate)(target, {
                    prk: entry.prk,
                    titleFa: sTitle,
                    titleEn: entry.titleEn,
                    specs: entry.specs,
                });
                const sElig = (0, torob_identity_1.assessDiscoveryEligibility)(target, targetDoc.parsed, sRes, { fromSimilarOrKnown: true });
                if (sElig.eligible && sElig.hardContradictions.length === 0) {
                    sellerEligible = true;
                    if (sRes.score > bestMatcherScore) {
                        bestMatcherScore = sRes.score;
                        bestMatcherStatus = sRes.status === "MATCH_CONFIRMED" && matcherRes.status !== "MATCH_CONFIRMED"
                            ? "REVIEW_REQUIRED"
                            : sRes.status;
                        bestHardRejected = false;
                    }
                }
            }
        }
        if (!cardElig.eligible && !sellerEligible)
            continue;
        let lexOverlap = 0;
        for (const term of queryTerms) {
            if (entry.doc.tokenSet.has(term))
                lexOverlap += term.startsWith("syn:") ? 1.5 : 1;
        }
        const lexicalScore = queryTerms.size > 0 ? lexOverlap / Math.max(1, Math.sqrt(queryTerms.size * Math.max(1, entry.doc.tokenSet.size))) : 0;
        const trigramScore = jaccardTrigramSimilarity(targetDoc.trigrams, entry.doc.trigrams);
        let structuredHits = 0;
        let structuredDenom = 0;
        for (const [k, tVals] of Object.entries(targetDoc.canonicalAttrs)) {
            if (!tVals?.length)
                continue;
            structuredDenom++;
            const cVals = entry.doc.canonicalAttrs[k];
            if (cVals?.some((v) => tVals.includes(v)))
                structuredHits += 2;
        }
        if (targetDoc.brands.length) {
            structuredDenom++;
            if (entry.doc.brands.some((b) => targetDoc.brands.includes(b)))
                structuredHits += 2;
        }
        if (targetDoc.models.length) {
            structuredDenom += 2;
            if (entry.doc.models.some((m) => targetDoc.models.includes(m)))
                structuredHits += 4;
        }
        if (targetDoc.parsed.head?.cls && entry.doc.parsed.head?.cls === targetDoc.parsed.head.cls) {
            structuredHits += 1;
        }
        const structuredScore = structuredHits / Math.max(1, structuredDenom + 1);
        if (lexicalScore <= 0 && trigramScore < 0.08 && structuredScore <= 0 && !sellerEligible)
            continue;
        eligible.push({
            entry,
            lexicalScore,
            trigramScore,
            structuredScore,
            matcherScore: bestMatcherScore,
            matcherStatus: bestMatcherStatus,
            hardRejected: bestHardRejected,
        });
    }
    if (!eligible.length)
        return [];
    const RRF_K = 30;
    const lexOrder = [...eligible].sort((a, b) => b.lexicalScore - a.lexicalScore);
    const triOrder = [...eligible].sort((a, b) => b.trigramScore - a.trigramScore);
    const strOrder = [...eligible].sort((a, b) => b.structuredScore - a.structuredScore || b.matcherScore - a.matcherScore);
    const lexRank = new Map(lexOrder.map((x, i) => [x.entry.prk, i + 1]));
    const triRank = new Map(triOrder.map((x, i) => [x.entry.prk, i + 1]));
    const strRank = new Map(strOrder.map((x, i) => [x.entry.prk, i + 1]));
    return eligible
        .map((item) => {
        const rl = lexRank.get(item.entry.prk) ?? eligible.length;
        const rt = triRank.get(item.entry.prk) ?? eligible.length;
        const rs = strRank.get(item.entry.prk) ?? eligible.length;
        const rrfScore = 1.1 / (RRF_K + rl) +
            0.75 / (RRF_K + rt) +
            1.35 / (RRF_K + rs) +
            (item.entry.reportedSellerCount && item.entry.reportedSellerCount >= 3 ? 0.008 : 0) -
            // جریمهٔ رد فقط برای ناسازگاری ساختاری (IDENTITY_MISMATCH)؛ ردّ قیمت-محورِ غیرساختاری نباید
            // کاندید هویت-سازگار را از پنجرهٔ hint خارج کند (recall، بدون عبور از گیت تعارض سخت).
            (item.hardRejected && item.matcherStatus === "IDENTITY_MISMATCH" ? 0.015 : 0);
        return {
            prk: item.entry.prk,
            titleFa: item.entry.titleFa ?? null,
            titleEn: item.entry.titleEn ?? null,
            rrfScore: Math.round(rrfScore * 10_000) / 10_000,
            lexicalScore: Math.round(item.lexicalScore * 1000) / 1000,
            trigramScore: Math.round(item.trigramScore * 1000) / 1000,
            structuredScore: Math.round(item.structuredScore * 1000) / 1000,
            matcherScore: item.matcherScore,
            matcherStatus: item.matcherStatus,
            reportedSellerCount: item.entry.reportedSellerCount ?? null,
            hint: {
                prk: item.entry.prk,
                title: item.entry.titleFa ?? item.entry.titleEn ?? null,
                identityStatus: item.matcherStatus,
                externalCompetitorCount: item.entry.reportedSellerCount ?? null,
                confidence: item.matcherScore / 100,
                lastVerifiedAt: item.entry.lastVerifiedAt ?? item.entry.lastSeenAt ?? null,
            },
        };
    })
        .sort((a, b) => b.rrfScore - a.rrfScore || b.matcherScore - a.matcherScore)
        .slice(0, limit);
}
/** Deterministic in-memory hybrid discovery index + product-to-PRK graph (used in tests and fallback paths). */
class InMemoryTorobHybridIndex {
    cards = new Map();
    links = new Map();
    upsertCards(inputs) {
        for (const input of inputs) {
            const existing = this.cards.get(input.prk);
            const mergedSellerNames = [...new Set([...(existing?.sellerNames ?? []), ...(input.sellerNames ?? [])])].slice(0, 30);
            const mergedSellerTitles = [...new Set([...(existing?.sellerTitles ?? []), ...(input.sellerTitles ?? [])])].slice(0, 20);
            const titleFa = input.titleFa || existing?.titleFa || null;
            const titleEn = input.titleEn || existing?.titleEn || null;
            const specs = input.specs?.length ? input.specs : existing?.specs ?? [];
            const doc = canonicalizeCatalogEntry({
                titleFa,
                titleEn,
                category: input.category ?? existing?.category,
                specs,
                sellerNames: mergedSellerNames,
                sellerTitles: mergedSellerTitles,
            });
            this.cards.set(input.prk, {
                ...existing,
                ...input,
                titleFa,
                titleEn,
                specs,
                sellerNames: mergedSellerNames,
                sellerTitles: mergedSellerTitles,
                doc,
            });
        }
    }
    upsertProductLinks(records) {
        for (const rec of records) {
            let byPrk = this.links.get(rec.productId);
            if (!byPrk) {
                byPrk = new Map();
                this.links.set(rec.productId, byPrk);
            }
            const prev = byPrk.get(rec.prk);
            byPrk.set(rec.prk, {
                ...rec,
                discoveringQueries: [...new Set([...(prev?.discoveringQueries ?? []), ...rec.discoveringQueries])].slice(0, 12),
            });
        }
    }
    getProductLinks(productId, now = new Date()) {
        const byPrk = this.links.get(productId);
        if (!byPrk)
            return [];
        const freshConfirmCutoffMs = exports.CONFIRMED_HINT_FRESHNESS_DAYS * 86_400_000;
        return [...byPrk.values()]
            .filter((r) => r.relationStatus !== "rejected")
            .sort((a, b) => {
            if (a.relationStatus !== b.relationStatus) {
                const order = { confirmed: 3, review_required: 2, self_only: 1, rejected: 0 };
                return order[b.relationStatus] - order[a.relationStatus];
            }
            return b.externalCompetitorCount - a.externalCompetitorCount || (b.confidence ?? 0) - (a.confidence ?? 0);
        })
            .map((r) => {
            const confirmedFresh = r.relationStatus === "confirmed" &&
                r.lastVerifiedAt != null &&
                now.getTime() - new Date(r.lastVerifiedAt).getTime() <= freshConfirmCutoffMs;
            return {
                prk: r.prk,
                title: this.cards.get(r.prk)?.titleFa ?? this.cards.get(r.prk)?.titleEn ?? null,
                identityStatus: confirmedFresh ? "MATCH_CONFIRMED" : "REVIEW_REQUIRED",
                externalCompetitorCount: r.externalCompetitorCount,
                ownStorePresent: r.ownStorePresent,
                confidence: r.confidence,
                lastVerifiedAt: r.lastVerifiedAt,
            };
        });
    }
    search(query, limit = 6) {
        return rrfRankScore([...this.cards.values()], query, limit);
    }
}
exports.InMemoryTorobHybridIndex = InMemoryTorobHybridIndex;
function buildLinkRecordsFromSource(opts) {
    const evList = opts.source.torob?.panelEvidence ?? [];
    const selectedSet = new Set(opts.source.torob?.selectedPanelPrks ?? (opts.source.prk ? [opts.source.prk] : []));
    const seenPrks = new Set(evList.map((ev) => ev.prk));
    const evRecords = evList.map((ev) => {
        const relationStatus = ev.groupRole === "self_only" ? "self_only"
            : ev.groupRole === "rejected" || ev.identityStatus === "IDENTITY_MISMATCH" ? "rejected"
                : (ev.groupRole === "primary" || ev.groupRole === "compatible_secondary") && ev.identityStatus === "MATCH_CONFIRMED" ? "confirmed"
                    : "review_required";
        return {
            productId: opts.productId,
            prk: ev.prk,
            relationStatus,
            identityScore: ev.score ?? null,
            confidence: ev.matchConfidence,
            origin: ev.retrievalOrigin === "hybrid_index" ? "hybrid_index" : "auto_discovery",
            isPrimary: selectedSet.has(ev.prk) && ev.groupRole === "primary",
            ownStorePresent: ev.ownStoreOfferCount > 0,
            externalCompetitorCount: ev.confirmedCompetitorCount > 0 ? ev.confirmedCompetitorCount : ev.uniqueExternalSellerCount,
            reportedSellerCount: ev.reportedSellerCount,
            discoveringQueries: ev.discoveringQueries ?? [],
            lastReason: ev.selectionReason ?? ev.exclusionReason ?? null,
            lastVerifiedAt: opts.now,
        };
    });
    // §12 سند رخداد — diagRecords باید دلیل/تعارض کامل را برای ممیزی و اعتبارسنجی مجدد نگه دارند.
    const diagRecords = (opts.source.torob?.discoveryDiagnostics ?? [])
        .filter((d) => !seenPrks.has(d.prk))
        .map((d) => ({
        productId: opts.productId,
        prk: d.prk,
        relationStatus: d.classification === "CONFIRMED_COMPATIBLE" ? "confirmed"
            : d.classification === "CONFIRMED_INCOMPATIBLE" ? "rejected"
                : "review_required",
        identityScore: null,
        confidence: null,
        origin: d.retrievalOrigin === "hybrid_index" ? "hybrid_index" : "auto_discovery",
        isPrimary: false,
        ownStorePresent: false,
        externalCompetitorCount: d.externalCompetitorCount,
        reportedSellerCount: null,
        discoveringQueries: [],
        lastReason: [d.reasonForInclusionOrExclusion, ...d.hardContradictions].filter(Boolean).join(" · ") || null,
        lastVerifiedAt: opts.now,
    }));
    return [...evRecords, ...diagRecords];
}
/**
 * Load known multi-PRK graph links + PostgreSQL hybrid discovery candidates as non-authoritative discovery hints.
 * Gracefully degrades to empty hints if DB tables aren't present or DB is offline.
 */
/** §12 سند رخداد — تأیید ذخیره‌شدهٔ قدیمی‌تر از این پنجره، هنگام hintشدن ارتقای MATCH_CONFIRMED نمی‌گیرد (کهنه، نه معتبر). */
exports.CONFIRMED_HINT_FRESHNESS_DAYS = 30;
const CATALOG_CARD_COLUMNS = `prk, title_fa, title_en, normalized_title, search_document, brands, models, specs, canonical_attrs,
                category, seller_names, seller_titles, last_price_toman, reported_seller_count, last_seen_at, last_verified_at`;
const HYBRID_CARD_WHERE = `WHERE
           ($1 <> '' AND to_tsvector('simple', COALESCE("search_document", '')) @@ websearch_to_tsquery('simple', $1))
           OR ($2 <> '' AND to_tsvector('simple', COALESCE("search_document", '')) @@ websearch_to_tsquery('simple', $2))
           OR ($3 <> '' AND "normalized_title" ILIKE '%' || $3 || '%')
           OR ($4 <> '' AND "normalized_title" % $4)`;
function rowsToIndexedCards(rows) {
    const byPrk = new Map();
    for (const r of rows) {
        if (!r?.prk || byPrk.has(r.prk))
            continue;
        byPrk.set(r.prk, {
            prk: r.prk,
            titleFa: r.title_fa,
            titleEn: r.title_en,
            category: r.category,
            specs: r.specs ?? [],
            sellerNames: r.seller_names ?? [],
            sellerTitles: r.seller_titles ?? [],
            lastPriceToman: r.last_price_toman,
            reportedSellerCount: r.reported_seller_count,
            lastSeenAt: r.last_seen_at,
            lastVerifiedAt: r.last_verified_at,
            doc: canonicalizeCatalogEntry({
                titleFa: r.title_fa,
                titleEn: r.title_en,
                category: r.category,
                specs: r.specs ?? [],
                sellerNames: r.seller_names ?? [],
                sellerTitles: r.seller_titles ?? [],
            }),
        });
    }
    return [...byPrk.values()];
}
async function loadProductDiscoveryHints(opts) {
    const hintsMap = new Map();
    if (opts.torobPrk) {
        hintsMap.set(opts.torobPrk, { prk: opts.torobPrk });
    }
    const now = opts.now ?? new Date();
    const freshConfirmCutoffMs = exports.CONFIRMED_HINT_FRESHNESS_DAYS * 86_400_000;
    let hybridHitsUsed = 0;
    try {
        if (opts.multiPrkGraphEnabled !== false) {
            const linkRes = await index_ts_1.pool.query(`SELECT l.prk, l.relation_status, l.own_store_present, l.external_competitor_count, l.confidence, l.last_verified_at
         FROM "product_torob_links" l
         WHERE l.product_id = $1 AND l.relation_status <> 'rejected'
         ORDER BY
           CASE l.relation_status WHEN 'confirmed' THEN 3 WHEN 'review_required' THEN 2 WHEN 'self_only' THEN 1 ELSE 0 END DESC,
           l.last_verified_at DESC NULLS LAST,
           l.external_competitor_count DESC,
           COALESCE(l.confidence, 0) DESC
         LIMIT 16`, [opts.productId]);
            for (const row of linkRes.rows) {
                const confirmedFresh = row.relation_status === "confirmed" &&
                    row.last_verified_at != null &&
                    now.getTime() - new Date(row.last_verified_at).getTime() <= freshConfirmCutoffMs;
                hintsMap.set(row.prk, {
                    prk: row.prk,
                    // تأیید ذخیره‌شده فقط در پنجرهٔ freshness ارتقای MATCH_CONFIRMED می‌گیرد؛ قدیمی‌تر = REVIEW_REQUIRED (کهنه).
                    identityStatus: confirmedFresh ? "MATCH_CONFIRMED" : "REVIEW_REQUIRED",
                    externalCompetitorCount: row.external_competitor_count,
                    ownStorePresent: row.own_store_present,
                    confidence: row.confidence,
                    lastVerifiedAt: row.last_verified_at,
                });
            }
        }
        if (opts.hybridIndexEnabled !== false) {
            // Recall هیبرید: پنجرهٔ دو-بودجه‌ای (نیمی بر اساس شباهت واژگانی/سه‌گرامی برای کارت‌های تک‌فروشنده با عنوان
            // کانونی متفاوت، نیمی بر اساس شمار فروشنده/تازگی) + شاخهٔ OR-FTS و سه‌گرام تا AND-only بودن FTS روی
            // عنوان کامل، کارتِ دارای یک واژهٔ غایب را صفر نکند. گیت‌های هویت در rrfRankScore دست‌نخورده می‌مانند.
            const { doc, queryTerms } = buildTargetQuerySignals(opts.productName, opts.sku, opts.category);
            const tokenFilter = [...queryTerms].filter((t) => !t.includes(":") && t.length >= 2).slice(0, 8);
            const ftsQuery = [doc.normalizedTitle, ...tokenFilter].filter(Boolean).join(" ").trim();
            const orFtsQuery = tokenFilter.join(" or ").trim();
            const likeToken = tokenFilter[0] ?? "";
            const trigramTarget = doc.normalizedTitle;
            let cardRows = [];
            try {
                const wide = await index_ts_1.pool.query(`SELECT * FROM (
             (SELECT ${CATALOG_CARD_COLUMNS} FROM "torob_catalog_cards" ${HYBRID_CARD_WHERE}
              ORDER BY CASE WHEN $4 <> '' THEN similarity("normalized_title", $4) ELSE 0 END DESC, COALESCE("reported_seller_count", 0) DESC, "last_seen_at" DESC
              LIMIT 30)
             UNION ALL
             (SELECT ${CATALOG_CARD_COLUMNS} FROM "torob_catalog_cards" ${HYBRID_CARD_WHERE}
              ORDER BY COALESCE("reported_seller_count", 0) DESC, "last_seen_at" DESC
              LIMIT 30)
           ) AS hybrid_window`, [ftsQuery, orFtsQuery, likeToken, trigramTarget]);
                cardRows = wide.rows;
            }
            catch {
                // پسوند pg_trgm شاید روی پایگاه‌های قدیمی موجود نباشد → پنجرهٔ باریک قدیمی.
                cardRows = (await index_ts_1.pool.query(`SELECT ${CATALOG_CARD_COLUMNS} FROM "torob_catalog_cards"
             WHERE
               ($1 <> '' AND to_tsvector('simple', COALESCE("search_document", '')) @@ websearch_to_tsquery('simple', $1))
               OR ($2 <> '' AND "normalized_title" ILIKE '%' || $2 || '%')
             ORDER BY COALESCE("reported_seller_count", 0) DESC, "last_seen_at" DESC
             LIMIT 40`, [ftsQuery, likeToken])).rows;
            }
            const indexed = rowsToIndexedCards(cardRows);
            if (indexed.length > 0) {
                const rankedHits = rrfRankScore(indexed, {
                    productName: opts.productName,
                    sku: opts.sku,
                    category: opts.category,
                    anchorPriceToman: opts.anchorPriceToman,
                }, 12);
                for (const hit of rankedHits) {
                    if (!hintsMap.has(hit.prk)) {
                        hintsMap.set(hit.prk, hit.hint);
                        hybridHitsUsed++;
                    }
                }
            }
        }
    }
    catch {
        // Migration 0005 may not be applied yet or DB offline in unit test mode; silently degrade without failing discovery.
    }
    const knownPrkHints = [...hintsMap.values()];
    return {
        knownPrks: knownPrkHints.map((h) => h.prk),
        knownPrkHints,
        hybridHitsUsed,
    };
}
/**
 * Persist discovered Torob catalog cards (search + details) and Product-to-PRK graph links.
 * Preserves secondary verified links across runs while tracking self-only vs competitive provenance.
 */
async function persistDiscoveryGraphAndCatalog(opts) {
    if (opts.isSimulated || opts.source.source !== "torob")
        return;
    const now = opts.now ?? new Date();
    const candidates = opts.source.torob?.search?.candidates ?? [];
    const offersByPrk = new Map();
    for (const offer of opts.source.offers) {
        const prk = offer.torobIdentity?.prk ?? opts.source.prk;
        if (!prk)
            continue;
        let bucket = offersByPrk.get(prk);
        if (!bucket) {
            bucket = { names: new Set(), titles: new Set() };
            offersByPrk.set(prk, bucket);
        }
        if (offer.shopName)
            bucket.names.add(offer.shopName);
        if (offer.listingTitle)
            bucket.titles.add(offer.listingTitle);
    }
    const catalogEntries = new Map();
    for (const c of candidates) {
        const sellerMeta = offersByPrk.get(c.prk);
        catalogEntries.set(c.prk, {
            prk: c.prk,
            titleFa: c.inspection?.titleFa ?? c.titleFa,
            titleEn: c.inspection?.titleEn ?? c.titleEn,
            sellerNames: sellerMeta ? [...sellerMeta.names] : [],
            sellerTitles: sellerMeta ? [...sellerMeta.titles] : [],
            lastPriceToman: c.priceToman ?? null,
            reportedSellerCount: c.panelEvidence?.reportedSellerCount ?? c.sellerCount ?? null,
            lastSeenAt: now,
            lastVerifiedAt: c.extraction === "extracted" ? now : null,
            sourceProvenance: c.origin ?? "torob_mcp",
        });
    }
    if (opts.source.prk && !catalogEntries.has(opts.source.prk)) {
        const sellerMeta = offersByPrk.get(opts.source.prk);
        catalogEntries.set(opts.source.prk, {
            prk: opts.source.prk,
            titleFa: opts.source.productTitle ?? null,
            titleEn: opts.source.productTitleEn ?? null,
            sellerNames: sellerMeta ? [...sellerMeta.names] : [],
            sellerTitles: sellerMeta ? [...sellerMeta.titles] : [],
            reportedSellerCount: opts.source.torob?.reportedSellers ?? opts.source.totalSellerCount,
            lastSeenAt: now,
            lastVerifiedAt: now,
            sourceProvenance: "torob_mcp",
        });
    }
    try {
        if (opts.hybridIndexEnabled !== false) {
            for (const item of catalogEntries.values()) {
                const doc = canonicalizeCatalogEntry(item);
                await index_ts_1.pool.query(`INSERT INTO "torob_catalog_cards" (
            "prk", "title_fa", "title_en", "normalized_title", "search_document",
            "brands", "models", "specs", "canonical_attrs", "category",
            "seller_names", "seller_titles", "last_price_toman", "reported_seller_count",
            "last_seen_at", "last_verified_at", "source_provenance"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10,
            $11::jsonb, $12::jsonb, $13, $14,
            $15, $16, $17
          )
          ON CONFLICT ("prk") DO UPDATE SET
            "title_fa" = COALESCE(EXCLUDED."title_fa", "torob_catalog_cards"."title_fa"),
            "title_en" = COALESCE(EXCLUDED."title_en", "torob_catalog_cards"."title_en"),
            "normalized_title" = CASE WHEN EXCLUDED."normalized_title" <> '' THEN EXCLUDED."normalized_title" ELSE "torob_catalog_cards"."normalized_title" END,
            "search_document" = CASE
              WHEN COALESCE("torob_catalog_cards"."search_document", '') = '' THEN EXCLUDED."search_document"
              WHEN EXCLUDED."search_document" = '' THEN "torob_catalog_cards"."search_document"
              ELSE left("torob_catalog_cards"."search_document" || ' ' || EXCLUDED."search_document", 4000)
            END,
            "brands" = EXCLUDED."brands",
            "models" = EXCLUDED."models",
            "canonical_attrs" = EXCLUDED."canonical_attrs",
            "seller_names" = (
              SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
              FROM (
                SELECT DISTINCT v
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof("torob_catalog_cards"."seller_names") = 'array' THEN "torob_catalog_cards"."seller_names" ELSE '[]'::jsonb END
                  || EXCLUDED."seller_names"
                ) AS t(v)
                LIMIT 30
              ) merged_names
            ),
            "seller_titles" = (
              SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
              FROM (
                SELECT DISTINCT v
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof("torob_catalog_cards"."seller_titles") = 'array' THEN "torob_catalog_cards"."seller_titles" ELSE '[]'::jsonb END
                  || EXCLUDED."seller_titles"
                ) AS t(v)
                LIMIT 20
              ) merged_titles
            ),
            "last_price_toman" = COALESCE(EXCLUDED."last_price_toman", "torob_catalog_cards"."last_price_toman"),
            "reported_seller_count" = COALESCE(EXCLUDED."reported_seller_count", "torob_catalog_cards"."reported_seller_count"),
            "last_seen_at" = EXCLUDED."last_seen_at",
            "last_verified_at" = COALESCE(EXCLUDED."last_verified_at", "torob_catalog_cards"."last_verified_at")`, [
                    item.prk,
                    item.titleFa ?? null,
                    item.titleEn ?? null,
                    doc.normalizedTitle,
                    doc.searchDocument,
                    JSON.stringify(doc.brands),
                    JSON.stringify(doc.models),
                    JSON.stringify(item.specs ?? []),
                    JSON.stringify(doc.canonicalAttrs),
                    item.category ?? null,
                    JSON.stringify(item.sellerNames ?? []),
                    JSON.stringify(item.sellerTitles ?? []),
                    item.lastPriceToman ?? null,
                    item.reportedSellerCount ?? null,
                    now,
                    item.lastVerifiedAt ?? null,
                    item.sourceProvenance ?? "torob_mcp",
                ]);
            }
        }
        if (opts.multiPrkGraphEnabled !== false) {
            const linkRecords = buildLinkRecordsFromSource({ productId: opts.productId, source: opts.source, now });
            for (const link of linkRecords) {
                await index_ts_1.pool.query(`INSERT INTO "product_torob_links" (
            "product_id", "prk", "relation_status", "identity_score", "confidence",
            "origin", "is_primary", "own_store_present", "external_competitor_count",
            "reported_seller_count", "discovering_queries", "last_reason",
            "last_verified_at", "updated_at"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11::jsonb, $12,
            $13, $13
          )
          ON CONFLICT ("product_id", "prk") DO UPDATE SET
            "relation_status" = CASE WHEN "product_torob_links"."origin" = 'admin_review' AND EXCLUDED."relation_status" <> 'rejected' THEN 'confirmed' ELSE EXCLUDED."relation_status" END,
            "identity_score" = EXCLUDED."identity_score",
            "confidence" = EXCLUDED."confidence",
            "is_primary" = EXCLUDED."is_primary",
            "own_store_present" = EXCLUDED."own_store_present",
            "external_competitor_count" = EXCLUDED."external_competitor_count",
            "reported_seller_count" = EXCLUDED."reported_seller_count",
            "discovering_queries" = EXCLUDED."discovering_queries",
            "last_reason" = EXCLUDED."last_reason",
            "last_verified_at" = EXCLUDED."last_verified_at",
            "updated_at" = EXCLUDED."updated_at"`, [
                    link.productId,
                    link.prk,
                    link.relationStatus,
                    link.identityScore,
                    link.confidence,
                    link.origin,
                    link.isPrimary,
                    link.ownStorePresent,
                    link.externalCompetitorCount,
                    link.reportedSellerCount,
                    JSON.stringify(link.discoveringQueries),
                    link.lastReason,
                    now,
                ]);
            }
        }
    }
    catch {
        // Non-fatal if migration 0005 isn't applied yet.
    }
}
async function syncAdminPrkLink(opts) {
    if (!opts.prk)
        return;
    const now = opts.now ?? new Date();
    try {
        await index_ts_1.pool.query(`UPDATE "product_torob_links" SET "is_primary" = false WHERE "product_id" = $1 AND "prk" <> $2`, [opts.productId, opts.prk]);
        await index_ts_1.pool.query(`INSERT INTO "product_torob_links" (
        "product_id", "prk", "relation_status", "confidence", "origin", "is_primary",
        "last_reason", "last_verified_at", "updated_at"
      ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $7)
      ON CONFLICT ("product_id", "prk") DO UPDATE SET
        "relation_status" = CASE WHEN EXCLUDED."relation_status" = 'confirmed' THEN 'confirmed' ELSE "product_torob_links"."relation_status" END,
        "origin" = EXCLUDED."origin",
        "is_primary" = true,
        "last_reason" = EXCLUDED."last_reason",
        "updated_at" = EXCLUDED."updated_at"`, [
            opts.productId,
            opts.prk,
            opts.confirmed ? "confirmed" : "review_required",
            opts.confirmed ? 1 : 0.7,
            opts.origin,
            opts.confirmed ? "تأیید دستی ارتباط در بازبینی مدیر" : "ثبت یا ویرایش لینک توسط مدیر",
            now,
        ]);
    }
    catch {
        // Non-fatal if migration 0005 isn't applied yet.
    }
}
