"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.firstText = firstText;
exports.readTorobTitles = readTorobTitles;
exports.cleanPrk = cleanPrk;
exports.prkFromTorobUrl = prkFromTorobUrl;
exports.torobProductUrl = torobProductUrl;
exports.safeTorobDetailsUrl = safeTorobDetailsUrl;
exports.offerSourceUrl = offerSourceUrl;
exports.readTorobImages = readTorobImages;
exports.torobStock = torobStock;
exports.torobPrice = torobPrice;
exports.countOf = countOf;
exports.countSellerText = countSellerText;
exports.decodeTorobSearch = decodeTorobSearch;
exports.readTorobSpecs = readTorobSpecs;
const text_1 = require("../pricing/match/text");
const sourcing_1 = require("../pricing/sourcing");
function record(value) {
    return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function firstText(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim().slice(0, 320);
    }
    return null;
}
const FA_TITLE_FIELDS = ["name_fa", "name1", "title_fa", "product_title", "title", "name"];
const EN_TITLE_FIELDS = ["name_en", "name2", "title_en"];
const TITLE_FIELD = /^(?:name\d*|title\d*|(?:display|product|base_product|card|listing)[_-]?(?:name|title)|(?:name|title)[_-]?(?:fa|en|persian|english))$/i;
function readTorobTitles(row) {
    const titleFor = (keys) => keys.map((key) => firstText(row[key])).find((value) => (0, text_1.normalizeText)(value)) ?? null;
    const titleFa = titleFor(FA_TITLE_FIELDS);
    const titleEn = titleFor(EN_TITLE_FIELDS);
    const fields = Object.keys(row).filter((key) => {
        if (!TITLE_FIELD.test(key))
            return false;
        const value = row[key];
        return value != null && (typeof value !== "string" || value.trim() !== "");
    });
    const upstreamFields = Array.isArray(row.title_source_fields)
        ? row.title_source_fields.filter((key) => typeof key === "string" && key.length <= 40 && TITLE_FIELD.test(key)) : [];
    const sourceFields = [...new Set([...fields, ...upstreamFields])].slice(0, 12);
    return { titleFa, titleEn, titleEvidence: { fields: sourceFields, parsed: Boolean((0, text_1.normalizeText)(titleFa) || (0, text_1.normalizeText)(titleEn)) } };
}
function cleanPrk(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-z0-9_-]{1,128}$/i.test(trimmed))
        return null;
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}
function prkFromTorobUrl(value) {
    if (typeof value !== "string")
        return null;
    try {
        const url = new URL(value, "https://torob.com");
        if (!["https:", "http:"].includes(url.protocol) || !["torob.com", "www.torob.com"].includes(url.host) ||
            url.username || url.password)
            return null;
        return cleanPrk(url.pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1]);
    }
    catch {
        return null;
    }
}
function torobProductUrl(prk) {
    return `https://torob.com/p/${encodeURIComponent(prk)}/`;
}
function safeTorobDetailsUrl(value, prk, keepSearchContext = false) {
    if (typeof value !== "string" || !value.trim())
        return null;
    try {
        const url = new URL(value, "https://api.torob.com");
        if (url.origin !== "https://api.torob.com" || url.username || url.password ||
            url.pathname !== "/v4/base-product/details/")
            return null;
        const ids = url.searchParams.getAll("prk");
        if (ids.length > 1 || (ids.length && cleanPrk(ids[0]) !== prk))
            return null;
        const params = new URLSearchParams({ prk, source: "next_desktop" });
        const searchId = url.searchParams.get("search_id");
        if (keepSearchContext && searchId && /^[a-z0-9._~:-]{1,256}$/i.test(searchId))
            params.set("search_id", searchId);
        return `https://api.torob.com/v4/base-product/details/?${params}`;
    }
    catch {
        return null;
    }
}
function offerSourceUrl(...values) {
    for (const value of values) {
        if (typeof value !== "string")
            continue;
        try {
            const url = new URL(value);
            if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
                continue;
            // Torob's purchase redirects carry tracking/session parameters and require the full query.
            if (url.hostname === "api.torob.com" && url.search)
                continue;
            return `${url.origin}${url.pathname}`;
        }
        catch {
            // Try the next public URL.
        }
    }
    return undefined;
}
function readTorobImages(row) {
    const values = [row.image, row.image_url, row.thumbnail, row.thumbnail_url];
    for (const images of [row.image_urls, row.images, row.product_images]) {
        if (Array.isArray(images)) {
            values.push(...images.slice(0, 6).map((image) => record(image)?.url ?? record(image)?.image_url ?? image));
        }
    }
    return [...new Set(values.flatMap((value) => {
            if (typeof value !== "string" || value.length > 320)
                return [];
            try {
                const url = new URL(value);
                return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? [url.href] : [];
            }
            catch {
                return [];
            }
        }))].slice(0, 4);
}
function torobStock(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value !== "string" && typeof value !== "number")
        return undefined;
    const status = (0, text_1.normalizeText)(String(value)).replace(/_/g, " ");
    if (/^(?:0|false|out of stock|unavailable|ناموجود|موجود نیست)$/.test(status))
        return false;
    if (/^(?:1|true|in stock|available|موجود)$/.test(status))
        return true;
    return undefined;
}
function torobPrice(value, unit) {
    const declared = typeof unit === "string" ? unit.trim() : "";
    const rial = /^(?:irr|rial|ریال|ريال|﷼)$/i;
    const toman = /^(?:irt|toman|tmn|تومان|تومن)$/i;
    const currency = rial.test(declared) ? "rial" : !declared || toman.test(declared) ? "toman" : null;
    if (typeof value === "string") {
        const match = /^([\d\s,٬.٫]+)\s*(.*)$/.exec((0, text_1.toAsciiDigits)(value).trim());
        if (!match)
            return 0;
        const suffix = match[2].trim();
        const explicitCurrency = rial.test(suffix) ? "rial" : toman.test(suffix) ? "toman" : suffix ? null : currency;
        return explicitCurrency ? (0, sourcing_1.parsePriceToToman)(match[1], explicitCurrency) : 0;
    }
    return currency && typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.round(currency === "rial" ? value / 10 : value) : 0;
}
function countOf(value) {
    const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test((0, text_1.toAsciiDigits)(value.trim()))
        ? Number((0, text_1.toAsciiDigits)(value.trim())) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function countSellerText(shopName) {
    const count = /\d+(?=\s*(?:فروشگاه|فروشنده))/.exec((0, text_1.toAsciiDigits)(shopName ?? ""));
    return count ? Number(count[0]) : null;
}
function decodeTorobSearch(payload, limit, requestedPage = 1) {
    const envelope = record(payload);
    const data = record(envelope?.data) ?? envelope;
    const rows = data?.products ?? data?.results;
    if (!Array.isArray(rows)) {
        return {
            rows: null,
            candidates: [],
            issue: "search_schema",
            page: requestedPage,
            hasNextPage: false,
            totalMatches: null,
            suggestedCategories: [],
            suggestedQueries: [],
            queryCorrected: null,
            truncated: false,
        };
    }
    const candidates = [];
    let unmapped = 0;
    for (const row of rows.slice(0, limit)) {
        const r = record(row);
        const id = cleanPrk(r?.prk) ?? cleanPrk(r?.random_key) ?? cleanPrk(r?.product_prk);
        const urlId = prkFromTorobUrl(r?.url ?? r?.web_client_absolute_url ?? r?.product_page_url);
        const prk = id ?? urlId;
        if (!r || !prk || (id && urlId && id !== urlId)) {
            unmapped++;
            continue;
        }
        const titles = readTorobTitles(r);
        const shopName = firstText(r.shop_name, r.shop_text);
        candidates.push({
            prk,
            ...titles,
            titleFa: titles.titleFa ?? "",
            priceToman: torobPrice(r.price_toman) || torobPrice(r.price ?? r.price_text, r.currency ?? r.price_unit) || null,
            sellerCount: countOf(r.shop_count ?? r.sellers_count) ?? countSellerText(shopName),
            available: torobStock(r.available ?? r.availability ?? r.stock_status),
            detailsUrl: safeTorobDetailsUrl(r.details_url ?? r.more_info_url, prk, true),
            shopName,
            imageUrls: readTorobImages(r),
        });
    }
    const upstreamRowCount = countOf(data?.page_count) ?? rows.length;
    if (Math.min(upstreamRowCount, limit) > rows.length)
        unmapped += Math.min(upstreamRowCount, limit) - rows.length;
    const rawCats = Array.isArray(data?.suggested_categories)
        ? data.suggested_categories
        : Array.isArray(data?.categories) ? data.categories : [];
    const suggestedCategories = rawCats.flatMap((item) => {
        const cat = record(item);
        const id = firstText(cat?.id, cat?.category_id);
        const title = firstText(cat?.title, cat?.name);
        return id && title ? [{ id, title }] : [];
    }).slice(0, 8);
    const suggestedQueries = Array.isArray(data?.suggested_queries)
        ? data.suggested_queries.filter((q) => typeof q === "string" && q.trim().length > 0).slice(0, 8)
        : [];
    const spellcheck = record(data?.spellcheck);
    const queryCorrected = firstText(data?.query_corrected, spellcheck?.corrected_query) ?? null;
    const page = countOf(data?.page) ?? requestedPage;
    const hasNextPage = data?.has_next_page === true || (typeof data?.next === "string" && data.next.trim().length > 0);
    const totalMatches = countOf(data?.total_matches ?? data?.count);
    const truncated = data?.truncated === true || rows.length > limit;
    return {
        rows: Math.max(rows.length, upstreamRowCount),
        candidates,
        ...(unmapped ? { issue: "search_card_id_missing_or_conflicting" } : {}),
        page,
        hasNextPage,
        totalMatches,
        suggestedCategories,
        suggestedQueries,
        queryCorrected,
        truncated,
    };
}
function readTorobSpecs(row) {
    const specs = [];
    const add = (key, value) => {
        const label = firstText(key);
        const text = typeof value === "number" || typeof value === "boolean" ? String(value) : firstText(value);
        if (label && text && text.length <= 100 && specs.length < 80)
            specs.push({ key: label, value: text });
    };
    for (const collection of [row.specs, row.key_specs]) {
        if (!Array.isArray(collection))
            continue;
        for (const item of collection.slice(0, 80)) {
            const spec = record(item);
            if (!spec)
                continue;
            if (Array.isArray(spec.items)) {
                for (const item of spec.items.slice(0, 80)) {
                    const nested = record(item);
                    if (nested)
                        add(nested.key ?? nested.title, nested.value ?? nested.text);
                }
            }
            else
                add(spec.key ?? spec.title ?? spec.name, spec.value ?? spec.text);
        }
    }
    const headers = record(row.structural_specs)?.headers;
    if (Array.isArray(headers)) {
        for (const block of headers.slice(0, 20)) {
            const values = record(record(block)?.specs);
            if (values)
                for (const [key, value] of Object.entries(values).slice(0, 80))
                    add(key, value);
        }
    }
    return specs;
}
