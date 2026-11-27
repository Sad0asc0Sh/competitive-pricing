"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.torobAdapter = void 0;
exports.getTorobApiBase = getTorobApiBase;
exports.extractPrk = extractPrk;
exports.looksLikeTorobChallenge = looksLikeTorobChallenge;
exports.normalizeTorobSeller = normalizeTorobSeller;
exports.normalizeTorobInPersonSeller = normalizeTorobInPersonSeller;
exports.parseTorobJson = parseTorobJson;
exports.fetchTorobPriceTrendV4 = fetchTorobPriceTrendV4;
const filters_1 = require("../pricing/filters");
const text_1 = require("../pricing/match/text");
const config_1 = require("../torob-relay/config");
const crypto_1 = require("../torob-relay/crypto");
const humanize_1 = require("./humanize");
const torob_discovery_1 = require("./torob-discovery");
const torob_mcp_client_1 = require("./torob-mcp-client");
const torob_payload_1 = require("./torob-payload");
const DEFAULT_TOROB_API_BASE = "https://api.torob.com";
function getTorobApiBase() {
    return (process.env.TOROB_API_BASE || DEFAULT_TOROB_API_BASE).replace(/\/+$/, "");
}
function extractPrk(url, prk) {
    return (0, torob_payload_1.cleanPrk)(prk) ?? (0, torob_payload_1.prkFromTorobUrl)(prk) ?? (0, torob_payload_1.prkFromTorobUrl)(url);
}
function looksLikeTorobChallenge(status, contentType, body) {
    return status === 490 || (!contentType.toLowerCase().includes("json") && /arcaptcha|ربات هستید|captcha/i.test(body.slice(0, 4000)));
}
async function torobTransportGet(target, path, timeoutMs) {
    const host = target === "api" ? "api.torob.com" : "torob.com";
    const headers = { Accept: target === "api" ? "application/json" : "text/html", "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8" };
    const deadline = Date.now() + timeoutMs;
    try {
        const relay = await (0, config_1.getTorobRelayConfig)();
        await (0, humanize_1.politeDelay)(host, 150, 400);
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return { unavailable: true, issue: "transport_timeout" };
        let status;
        let contentType;
        let body;
        if (relay.enabled && relay.configured && relay.mode === "encrypted_relay") {
            const response = await (0, crypto_1.fetchViaEncryptedRelay)({
                relayUrl: relay.url, relayKey: relay.relayKey, target, path, headers, timeoutMs: remaining,
            });
            status = response.status ?? 502;
            contentType = response.contentType ?? "";
            body = response.body ?? "";
            if (!response.ok && status >= 200 && status < 300)
                return { unavailable: true, issue: "relay_unavailable" };
        }
        else {
            const base = target === "site" ? "https://torob.com"
                : relay.enabled && relay.configured && relay.mode === "plain_https_base" ? relay.url : getTorobApiBase();
            const response = await fetch(`${base}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(remaining) });
            status = response.status;
            contentType = response.headers.get("content-type") ?? "";
            if (status === 401 || status === 403 || status === 429 || status === 490) {
                return { unavailable: true, blocked: true, challenged: status === 490, issue: status === 490 ? "access_challenge" : "access_restricted" };
            }
            body = await response.text();
        }
        if (looksLikeTorobChallenge(status, contentType, body))
            return { unavailable: true, blocked: true, challenged: true, issue: "access_challenge" };
        if (status === 429 || status === 403 || status === 401)
            return { unavailable: true, blocked: true, issue: "access_restricted" };
        if (status < 200 || status >= 300)
            return { unavailable: true, issue: `torob_http_${status}` };
        return { data: body };
    }
    catch (error) {
        const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
        return { unavailable: true, issue: timeout ? "transport_timeout" : "transport_connection" };
    }
}
function jsonValue(body) {
    if (!body)
        return undefined;
    try {
        return JSON.parse(body);
    }
    catch {
        return undefined;
    }
}
function normalizeSeller(s, now, sellerType) {
    const shopName = (0, torob_payload_1.firstText)(s.shop_name, s.seller_name, (0, torob_payload_1.record)(s.shop)?.name);
    const priceNode = (0, torob_payload_1.record)(s.price);
    const unit = priceNode?.currency ?? s.currency ?? s.price_unit;
    const price = (0, torob_payload_1.torobPrice)(s.price_toman) ||
        (0, torob_payload_1.torobPrice)(priceNode?.amount ?? s.price ?? s.price_value ?? s.min_price, unit) ||
        (0, torob_payload_1.torobPrice)(s.price_text ?? s.price_string, unit);
    if (!shopName || price <= 0)
        return null;
    const shopId = typeof s.shop_id === "number" && Number.isSafeInteger(s.shop_id) ? String(s.shop_id) : (0, torob_payload_1.firstText)(s.shop_id, s.shop_slug);
    const shopUrl = shopId ? `https://torob.com/shop/${encodeURIComponent(shopId)}/` : undefined;
    const shopScore = Number(s.shop_score ?? (0, torob_payload_1.record)(s.score_info)?.score ?? s.score);
    const lastChangedText = (0, torob_payload_1.firstText)(s.last_price_change_date, s.last_price_change, s.updated_at, s.price_updated_at);
    const more = (0, torob_payload_1.record)(s.more_info);
    const postageFee = sellerType === "online" ? (0, torob_payload_1.torobPrice)(s.postage_fee_toman ?? s.postage_fee ?? s.postage_text) : 0;
    return {
        shopName,
        shopId: shopId ?? undefined,
        shopCity: (0, torob_payload_1.firstText)(s.shop_city, s.city, s.shop_name2),
        listingTitle: (0, torob_payload_1.firstText)(s.product_title, s.listing_title, s.product_name, sellerType === "online" ? s.name1 : undefined),
        currency: "toman",
        observedAt: now,
        sellerType,
        shopScore: Number.isFinite(shopScore) && shopScore > 0 ? Math.round(shopScore * 10) / 10 : null,
        shopVotes: (0, torob_payload_1.countOf)(s.shop_votes_count ?? s.shop_votes) ?? 0,
        shopScorePercentile: (0, torob_payload_1.countOf)(s.shop_score_percentile),
        price,
        postageFee: postageFee || null,
        deliveredPrice: price + postageFee,
        freeShipping: typeof more?.free_shipping === "boolean" ? more.free_shipping : null,
        sameDayDelivery: (0, torob_payload_1.firstText)(more?.same_day_delivery),
        paymentOnDelivery: typeof more?.payment_on_delivery === "boolean" ? more.payment_on_delivery : null,
        guarantee: (0, torob_payload_1.firstText)((0, torob_payload_1.record)(s.guarantee_info)?.status, s.guarantee),
        priceUnreliable: (s.is_price_unreliable ?? s.price_unreliable) === true,
        lastChangedAt: (0, filters_1.parsePersianRelativeDate)(lastChangedText, now),
        lastChangedText,
        isAd: (s.is_adv ?? s.is_ad ?? s.sponsored) === true,
        inStock: (0, torob_payload_1.torobStock)(s.availability ?? s.available ?? s.stock_status),
        url: (0, torob_payload_1.offerSourceUrl)(s.page_url, s.url, s.shop_url, shopUrl),
    };
}
function normalizeTorobSeller(s, now = new Date()) {
    return normalizeSeller(s, now, "online");
}
function normalizeTorobInPersonSeller(s, now = new Date()) {
    return normalizeSeller(s, now, "in_person");
}
function decodeTorobDetails(value, now) {
    const outer = (0, torob_payload_1.record)(value);
    const row = (0, torob_payload_1.record)(outer?.data) ?? outer;
    if (!row)
        return { issue: "details_schema" };
    const online = (0, torob_payload_1.record)(row.products_info);
    const stores = (0, torob_payload_1.record)(row.products_in_store_info);
    const rawOnline = online?.result ?? row.sellers ?? row.products ?? row.result;
    const rawStores = stores?.result;
    const onlineRows = Array.isArray(rawOnline) ? rawOnline : [];
    const storeRows = Array.isArray(rawStores) ? rawStores : [];
    const sellerRows = Array.isArray(rawOnline) || Array.isArray(rawStores) ? onlineRows.length + storeRows.length : null;
    const onlineOfferCount = Math.max((0, torob_payload_1.countOf)(row.shop_count ?? row.sellers_count ?? online?.count ?? row.count) ?? 0, onlineRows.length);
    const inPersonSellerCount = Math.max((0, torob_payload_1.countOf)(stores?.count) ?? 0, storeRows.length);
    const offers = [...onlineRows.map((item) => ({ item, type: "online" })), ...storeRows.map((item) => ({ item, type: "in_person" }))]
        .flatMap(({ item, type }) => {
        const seller = (0, torob_payload_1.record)(item);
        const offer = seller ? normalizeSeller(seller, now, type) : null;
        return offer ? [offer] : [];
    });
    const faultyRows = Boolean(sellerRows) && [...onlineRows, ...storeRows].every((item) => {
        const seller = (0, torob_payload_1.record)(item);
        return !(0, torob_payload_1.firstText)(seller?.shop_name, seller?.seller_name, (0, torob_payload_1.record)(seller?.shop)?.name);
    });
    const badShape = sellerRows == null || (rawOnline != null && !Array.isArray(rawOnline)) ||
        (rawStores != null && !Array.isArray(rawStores)) || faultyRows ||
        (onlineOfferCount > 0 && onlineRows.length === 0) || (inPersonSellerCount > 0 && storeRows.length === 0);
    return {
        ...(badShape ? { issue: "details_schema" } : {}),
        data: {
            ...(0, torob_payload_1.readTorobTitles)(row),
            prk: (0, torob_payload_1.cleanPrk)(row.random_key ?? row.prk) ?? (0, torob_payload_1.prkFromTorobUrl)(row.web_client_absolute_url ?? row.url),
            specs: (0, torob_payload_1.readTorobSpecs)(row),
            offers,
            sellerRows,
            totalSellerCount: sellerRows != null || onlineOfferCount + inPersonSellerCount > 0 ? onlineOfferCount + inPersonSellerCount : null,
            inPersonSellerCount,
            onlineOfferCount,
            offersTruncated: onlineOfferCount > onlineRows.length || inPersonSellerCount > storeRows.length,
        },
    };
}
function parseTorobJson(value, now = new Date()) {
    const details = decodeTorobDetails(value, now).data;
    return {
        offers: details?.offers ?? [],
        title: details?.titleFa ?? undefined,
        prk: details?.prk ?? undefined,
        total: details?.totalSellerCount ?? 0,
        inPersonCount: details?.inPersonSellerCount ?? 0,
    };
}
async function searchTorobProductV4(query, limit, timeoutMs) {
    const params = new URLSearchParams({ q: query, page: "0", size: String(limit), source: "next_desktop" });
    const response = await torobTransportGet("api", `/v4/base-product/search/?${params}`, timeoutMs);
    if (response.data === undefined)
        return response;
    const data = jsonValue(response.data);
    return data === undefined ? { issue: "search_schema" } : { data };
}
function findDetailsInNextData(html, prk) {
    const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    const stack = [jsonValue(script?.[1])];
    let onlyUnlabelled = null;
    let unlabelledCount = 0;
    for (let examined = 0; stack.length && examined < 5000; examined++) {
        const value = stack.pop();
        if (Array.isArray(value)) {
            for (const item of value)
                stack.push(item);
            continue;
        }
        const node = (0, torob_payload_1.record)(value);
        if (!node)
            continue;
        if ((0, torob_payload_1.record)(node.products_info) || (0, torob_payload_1.record)(node.products_in_store_info)) {
            const id = (0, torob_payload_1.cleanPrk)(node.random_key ?? node.prk) ?? (0, torob_payload_1.prkFromTorobUrl)(node.web_client_absolute_url ?? node.url);
            if (id === prk)
                return node;
            if (id == null) {
                onlyUnlabelled = node;
                unlabelledCount++;
            }
        }
        for (const item of Object.values(node))
            if (item !== null && typeof item === "object")
                stack.push(item);
    }
    return unlabelledCount === 1 ? onlyUnlabelled : null;
}
async function fetchTorobDetails(card, now, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const detailsUrl = (0, torob_payload_1.safeTorobDetailsUrl)(card.detailsUrl ?? "/v4/base-product/details/", card.prk)
        ?? (0, torob_payload_1.safeTorobDetailsUrl)("/v4/base-product/details/", card.prk);
    const requestUrl = (0, torob_payload_1.safeTorobDetailsUrl)(card.detailsUrl, card.prk, true) ?? detailsUrl;
    const api = await torobTransportGet("api", requestUrl.slice(DEFAULT_TOROB_API_BASE.length), Math.min(5000, timeoutMs));
    if (api.blocked)
        return { ...api, data: undefined };
    const parsed = api.data === undefined ? { ...api, data: undefined } : decodeTorobDetails(jsonValue(api.data), now);
    if (parsed.data)
        parsed.data.detailsUrl = detailsUrl;
    if (parsed.data?.prk && parsed.data.prk !== card.prk)
        return { issue: "details_prk_mismatch" };
    const title = (0, text_1.normalizeText)(parsed.data?.titleFa) || (0, text_1.normalizeText)(parsed.data?.titleEn) ||
        (0, text_1.normalizeText)(card.titleFa) || (0, text_1.normalizeText)(card.titleEn);
    const remaining = deadline - Date.now();
    if ((parsed.data && !parsed.issue && title) || remaining < 250) {
        return { ...parsed, issue: parsed.issue === "transport_timeout" ? "details_timeout" : parsed.issue };
    }
    const page = await torobTransportGet("site", `/p/${encodeURIComponent(card.prk)}/`, remaining);
    if (page.blocked)
        return { ...page, data: parsed.data };
    const embedded = page.data && findDetailsInNextData(page.data, card.prk);
    if (embedded) {
        const fromPage = decodeTorobDetails(embedded, now);
        if (fromPage.data)
            fromPage.data.detailsUrl = detailsUrl;
        if (!fromPage.issue || !parsed.data)
            return fromPage;
    }
    return parsed.data ? parsed : {
        unavailable: parsed.unavailable && page.unavailable,
        issue: [parsed.issue, page.issue].includes("transport_timeout") ? "details_timeout" : parsed.issue ?? page.issue ?? "details_schema",
    };
}
async function fetchTorobPriceTrendV4(prk) {
    const res = await torobTransportGet("api", `/v4/base-product/price-chart/?prk=${encodeURIComponent(prk)}`, 4000);
    const raw = (0, torob_payload_1.record)(jsonValue(res.data));
    if (!Array.isArray(raw?.dataSets))
        return null;
    const labels = Array.isArray(raw.labels) ? raw.labels : [];
    const series = raw.dataSets.flatMap((set) => {
        const row = (0, torob_payload_1.record)(set);
        if (!Array.isArray(row?.entries))
            return [];
        const points = row.entries.flatMap((item) => {
            const entry = (0, torob_payload_1.record)(item);
            if (typeof entry?.i !== "number" || typeof entry?.val !== "number")
                return [];
            return [{ date: (0, torob_payload_1.firstText)(labels[entry.i]) ?? "", value: Math.round(entry.val) }];
        });
        return [{ label: (0, torob_payload_1.firstText)(row.label) ?? "", points }];
    });
    return (0, torob_mcp_client_1.analyzeMcpPriceHistory)({ series });
}
exports.torobAdapter = {
    id: "torob",
    label: "ترب (مجهز به Torob MCP)",
    async fetchOffers(product) {
        const now = new Date();
        const prk = extractPrk(product.torobUrl, product.torobPrk);
        const options = {
            productName: product.name,
            sku: product.sku,
            category: product.category,
            prk,
            detailsUrl: prk ? (0, torob_payload_1.safeTorobDetailsUrl)(product.torobDetailsUrl, prk, true) : null,
            confirmation: product.torobLinkConfirmation,
            anchorPriceToman: product.currentFinalPrice && product.currentFinalPrice > 0 ? product.currentFinalPrice
                : product.costPrice > 0 ? product.costPrice : null,
            matchConfig: product.matchConfig,
            now,
        };
        const details = (card, timeoutMs) => fetchTorobDetails(card, now, timeoutMs);
        const mcpUrl = process.env.TOROB_MCP_URL?.trim();
        if (mcpUrl) {
            await (0, config_1.syncTorobRelayToMcp)().catch(() => undefined);
            return (0, torob_mcp_client_1.fetchViaTorobMcpServer)({ ...options, mcpUrl, fallbackSearch: searchTorobProductV4, fallbackDetails: details });
        }
        return (0, torob_discovery_1.resolveTorobSource)({
            ...options, via: "torob_v4", search: searchTorobProductV4, details,
            priceTrend: (card) => fetchTorobPriceTrendV4(card.prk),
        });
    },
};
