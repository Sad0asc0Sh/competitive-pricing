"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSearchQueries = void 0;
exports.analyzeMcpPriceHistory = analyzeMcpPriceHistory;
exports.extractSellerCountFromMcpCard = extractSellerCountFromMcpCard;
exports.convertMcpDetailsToOffers = convertMcpDetailsToOffers;
exports.callTorobMcpToolWithDiag = callTorobMcpToolWithDiag;
exports.callTorobMcpTool = callTorobMcpTool;
exports.fetchViaTorobMcpServer = fetchViaTorobMcpServer;
const filters_1 = require("../pricing/filters");
const text_1 = require("../pricing/match/text");
const torob_discovery_1 = require("./torob-discovery");
const torob_details_resilience_1 = require("./torob-details-resilience");
const torob_payload_1 = require("./torob-payload");
var torob_discovery_2 = require("./torob-discovery");
Object.defineProperty(exports, "buildSearchQueries", { enumerable: true, get: function () { return torob_discovery_2.buildSearchQueries; } });
function analyzeMcpPriceHistory(chart) {
    if (!chart?.series?.length)
        return null;
    const minSeries = chart.series.find((s) => s.label?.includes("کمترین")) ?? chart.series[0];
    const avgSeries = chart.series.find((s) => s.label?.includes("میانگین")) ?? chart.series[1] ?? minSeries;
    const pts = minSeries?.points ?? [];
    if (pts.length < 2) {
        return {
            direction: "unknown",
            changePct30d: 0,
            latestLowest: pts[pts.length - 1]?.value ?? null,
            latestAverage: avgSeries?.points?.[avgSeries.points.length - 1]?.value ?? null,
        };
    }
    const latest = pts[pts.length - 1].value;
    const prev = pts[Math.max(0, pts.length - 2)].value;
    const changePct = prev > 0 ? Math.round(((latest - prev) / prev) * 1000) / 10 : 0;
    let direction = "stable";
    if (changePct <= -2)
        direction = "falling";
    else if (changePct >= 2)
        direction = "rising";
    return {
        direction,
        changePct30d: changePct,
        latestLowest: latest,
        latestAverage: avgSeries?.points?.[avgSeries.points.length - 1]?.value ?? null,
        summaryText: `روند اخیر قیمت در ترب: ${direction === "falling" ? "نزولی" : direction === "rising" ? "صعودی" : "باثبات"} (${changePct >= 0 ? "+" : ""}${changePct}%)`,
    };
}
function extractSellerCountFromMcpCard(card) {
    const name = (0, torob_payload_1.firstText)(card.shop_name);
    return (0, torob_payload_1.countOf)(card.shop_count) ?? (0, torob_payload_1.countSellerText)(name) ?? (name ? 1 : null);
}
function convertMcpDetailsToOffers(details, now = new Date()) {
    const offers = [];
    const onlineRows = Array.isArray(details.offers) ? details.offers : [];
    const inPersonRows = Array.isArray(details.in_person_sellers) ? details.in_person_sellers : [];
    for (const o of onlineRows) {
        if (!o || typeof o !== "object")
            continue;
        const shopName = (0, torob_payload_1.firstText)(o.shop_name);
        const price = (0, torob_payload_1.torobPrice)(o.price_toman) || (0, torob_payload_1.torobPrice)(o.price_text);
        if (!shopName || price <= 0)
            continue;
        offers.push({
            shopName,
            listingTitle: (0, torob_payload_1.firstText)(o.product_title, (0, torob_payload_1.record)(o)?.listing_title, (0, torob_payload_1.record)(o)?.name1),
            listingSpecs: (0, torob_payload_1.readTorobSpecs)((0, torob_payload_1.record)(o) ?? {}),
            imageUrls: (0, torob_payload_1.readTorobImages)((0, torob_payload_1.record)(o) ?? {}),
            currency: "toman",
            observedAt: now,
            shopId: (0, torob_payload_1.firstText)(o.shop_id) ?? undefined,
            shopCity: (0, torob_payload_1.firstText)(o.shop_city),
            sellerType: "online",
            shopScore: Number.isFinite(o.shop_score) ? o.shop_score : null,
            shopVotes: (0, torob_payload_1.countOf)(o.shop_votes) ?? 0,
            shopScorePercentile: (0, torob_payload_1.countOf)(o.shop_score_percentile),
            price,
            postageFee: (0, torob_payload_1.torobPrice)(o.postage_fee_toman) || null,
            deliveredPrice: (0, torob_payload_1.torobPrice)(o.delivered_price_toman) || price,
            freeShipping: o.free_shipping ?? null,
            sameDayDelivery: (0, torob_payload_1.firstText)(o.same_day_delivery),
            paymentOnDelivery: o.payment_on_delivery ?? null,
            guarantee: (0, torob_payload_1.firstText)(o.guarantee),
            priceUnreliable: o.price_unreliable === true,
            lastChangedText: (0, torob_payload_1.firstText)(o.last_price_change_date),
            lastChangedAt: (0, filters_1.parsePersianRelativeDate)((0, torob_payload_1.firstText)(o.last_price_change_date), now),
            isAd: o.is_adv === true,
            inStock: (0, torob_payload_1.torobStock)(o.available),
            url: (0, torob_payload_1.offerSourceUrl)(o.buy_url, o.url),
        });
    }
    for (const s of inPersonRows) {
        if (!s || typeof s !== "object")
            continue;
        const shopName = (0, torob_payload_1.firstText)(s.shop_name);
        const price = (0, torob_payload_1.torobPrice)(s.price_toman) || (0, torob_payload_1.torobPrice)(s.price_text);
        if (!shopName || price <= 0)
            continue;
        offers.push({
            shopName,
            listingTitle: (0, torob_payload_1.firstText)(s.product_title, (0, torob_payload_1.record)(s)?.listing_title),
            listingSpecs: (0, torob_payload_1.readTorobSpecs)((0, torob_payload_1.record)(s) ?? {}),
            imageUrls: (0, torob_payload_1.readTorobImages)((0, torob_payload_1.record)(s) ?? {}),
            currency: "toman",
            observedAt: now,
            shopId: (0, torob_payload_1.firstText)(s.shop_id) ?? undefined,
            shopCity: (0, torob_payload_1.firstText)(s.city),
            sellerType: "in_person",
            shopScore: Number.isFinite(s.score) ? s.score : null,
            price,
            deliveredPrice: price,
            priceUnreliable: s.price_unreliable === true,
            lastChangedText: (0, torob_payload_1.firstText)(s.last_price_change_date),
            lastChangedAt: (0, filters_1.parsePersianRelativeDate)((0, torob_payload_1.firstText)(s.last_price_change_date), now),
            isAd: false,
            inStock: (0, torob_payload_1.torobStock)(s.available),
            url: (0, torob_payload_1.offerSourceUrl)(s.url),
        });
    }
    const onlineOfferCount = Math.max((0, torob_payload_1.countOf)(details.offer_count) ?? 0, onlineRows.length);
    const inPersonSellerCount = Math.max((0, torob_payload_1.countOf)(details.in_person_count) ?? 0, inPersonRows.length);
    return {
        offers,
        totalSellerCount: onlineOfferCount + inPersonSellerCount,
        inPersonSellerCount,
        onlineOfferCount,
        offersTruncated: details.offers_truncated === true || onlineOfferCount > onlineRows.length || inPersonSellerCount > inPersonRows.length,
    };
}
function mcpFailure(code, message, status) {
    const challenged = status === 490 || /\b490\b|arcaptcha|captcha|bot challenge|challenged/i.test(message);
    const blocked = challenged || status === 429 || status === 403 || status === 401 ||
        /\b(?:HTTP\s*)?(?:429|403|401)\b|rate limit|access denied/i.test(message);
    const schema = code === "mcp_response_schema" || /response schema|API shape may have changed/i.test(message);
    const wrongId = /different product id in the details response/i.test(message);
    // سند P0 resilience — «not found» گذرا نیست؛ کد اختصاصی می‌گیرد تا retry/fallback نشود
    const notFound = code === "mcp_tool_error" && /not found/i.test(message);
    const rateLimited = status === 429 || /(?:^|\s)429(?:\s|$)/.test(message);
    return { data: null,
        issue: challenged ? "access_challenge"
            : rateLimited ? "access_rate_limited"
                : blocked ? "access_restricted"
                    : wrongId ? "details_prk_mismatch"
                        : notFound ? "not_found"
                            : schema ? "mcp_response_schema"
                                : code,
        unavailable: blocked || (!schema && !wrongId && !notFound), blocked, challenged };
}
async function callTorobMcpToolWithDiag(mcpEndpointUrl, toolName, args, timeoutMs = 8000) {
    try {
        const signal = AbortSignal.timeout(timeoutMs);
        // سند P0 resilience — خواندن بدنه هم با همان مهلت قطع می‌شود؛ هدرِ رسیده با بدنهٔ معلق نباید استعلام را بی‌نهایت نگه دارد
        const bodyAbort = new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true });
        });
        // وقتی مسابقه با شاخهٔ دیگر تمام شده، ردّ bodyAbort نباید unhandled rejection بسازد
        bodyAbort.catch(() => undefined);
        const res = await fetch(mcpEndpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: toolName, arguments: args } }),
            signal,
            cache: "no-store",
        });
        if (!res.ok) {
            return { ...mcpFailure(`mcp_http_${res.status}`, "", res.status), endpointUnavailable: res.status >= 500 && res.status !== 490 };
        }
        const rawText = await Promise.race([res.text(), bodyAbort]);
        try {
            const payload = res.headers.get("content-type")?.includes("text/event-stream") || /^\s*(?:data:|event:)/.test(rawText)
                ? rawText.split(/\r?\n/).filter((line) => line.startsWith("data:")).at(-1)?.slice(5).trim() ?? "" : rawText;
            const rpc = (0, torob_payload_1.record)(JSON.parse(payload));
            const rpcError = (0, torob_payload_1.record)(rpc?.error);
            const result = (0, torob_payload_1.record)(rpc?.result);
            if (rpcError)
                return mcpFailure("mcp_rpc_error", (0, torob_payload_1.firstText)(rpcError.message) ?? "");
            if (!result)
                return mcpFailure("mcp_response_schema", "");
            const text = Array.isArray(result.content)
                ? result.content.find((block) => (0, torob_payload_1.record)(block)?.type === "text")?.text : undefined;
            if (result.isError === true)
                return mcpFailure("mcp_tool_error", typeof text === "string" ? text : "");
            if ((0, torob_payload_1.record)(result.structuredContent))
                return { data: result.structuredContent };
            return typeof text === "string" ? { data: JSON.parse(text) } : mcpFailure("mcp_response_schema", "");
        }
        catch {
            return mcpFailure("mcp_response_schema", "");
        }
    }
    catch (error) {
        const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
        return { data: null, issue: timeout ? "mcp_timeout" : "mcp_connection", unavailable: true, endpointUnavailable: !timeout };
    }
}
async function callTorobMcpTool(mcpEndpointUrl, toolName, args, timeoutMs = 8000) {
    return (await callTorobMcpToolWithDiag(mcpEndpointUrl, toolName, args, timeoutMs)).data;
}
function decodeMcpDetails(value, now) {
    const payload = (0, torob_payload_1.record)(value);
    const details = (0, torob_payload_1.record)(payload?.data) ?? payload;
    if (!details)
        return { issue: "details_schema" };
    const online = Array.isArray(details.offers) ? details.offers : null;
    const inPerson = Array.isArray(details.in_person_sellers) ? details.in_person_sellers : null;
    const returnedRows = (online?.length ?? 0) + (inPerson?.length ?? 0);
    const sellerRows = online || inPerson ? Math.max((0, torob_payload_1.countOf)(details.seller_rows_seen) ?? 0, returnedRows) : null;
    const { offers, ...counts } = convertMcpDetailsToOffers(details, now);
    const faultyRows = [...(online ?? []), ...(inPerson ?? [])].some((row) => !(0, torob_payload_1.firstText)((0, torob_payload_1.record)(row)?.shop_name));
    const issue = sellerRows == null || faultyRows || details.seller_schema_incomplete === true ||
        (details.offers != null && online == null) || (details.in_person_sellers != null && inPerson == null) ||
        (counts.onlineOfferCount > 0 && !online?.length) || (counts.inPersonSellerCount > 0 && !inPerson?.length) ? "details_schema" : undefined;
    return {
        issue,
        origin: "torob_mcp",
        data: {
            ...counts,
            ...(0, torob_payload_1.readTorobTitles)(details),
            prk: (0, torob_payload_1.cleanPrk)(details.prk ?? details.random_key),
            specs: (0, torob_payload_1.readTorobSpecs)(details),
            imageUrls: (0, torob_payload_1.readTorobImages)(details),
            offers,
            sellerRows,
            totalSellerCount: sellerRows != null || counts.totalSellerCount > 0 ? counts.totalSellerCount : null,
        },
    };
}
let detailsCorrelationSeq = 0;
async function fetchViaTorobMcpServer(opts) {
    const now = opts.now ?? new Date();
    let endpointUnavailable = false;
    // سند P0 resilience — شناسهٔ همبستگی + ردّ تلاش‌های جزئیات برای اتصال یک استعلام به همهٔ درخواست‌های PRK
    const detailsCorrelationId = `dtl-${now.getTime().toString(36)}-${(detailsCorrelationSeq += 1)}`;
    const detailsAttemptTraces = [];
    let seenDetailsCall = false;
    const invokeFallbackSearch = (req, timeoutMs) => {
        if (!opts.fallbackSearch)
            return Promise.resolve({ unavailable: true });
        if (opts.fallbackSearch.length >= 3) {
            return opts.fallbackSearch(req.query, req.limit, timeoutMs);
        }
        return opts.fallbackSearch(req, timeoutMs);
    };
    const result = await (0, torob_discovery_1.resolveTorobSource)({
        ...opts,
        mode: opts.mode ?? opts.matchConfig?.discoveryMode ?? "interactive",
        now,
        via: "torob_mcp_server",
        search: async (req, timeoutMs) => {
            if (endpointUnavailable && opts.fallbackSearch)
                return invokeFallbackSearch(req, timeoutMs);
            const started = Date.now();
            const mcpArgs = {
                query: req.query,
                limit: req.limit,
                sort: req.sort ?? "popularity",
                ...(req.page && req.page > 1 ? { page: req.page } : {}),
                ...(req.category ? { category: req.category } : {}),
                ...(req.minPriceToman && req.minPriceToman > 0 ? { min_price_toman: req.minPriceToman } : {}),
                ...(req.maxPriceToman && req.maxPriceToman > 0 ? { max_price_toman: req.maxPriceToman } : {}),
            };
            const out = await callTorobMcpToolWithDiag(opts.mcpUrl, "search_products", mcpArgs, timeoutMs);
            endpointUnavailable ||= out.endpointUnavailable === true && !out.blocked;
            const remaining = timeoutMs - (Date.now() - started);
            if (endpointUnavailable && opts.fallbackSearch && remaining > 200)
                return invokeFallbackSearch(req, remaining);
            return { ...out, origin: "torob_mcp", data: out.data ?? undefined };
        },
        details: async (card, timeoutMs) => {
            // سند P0 resilience — بودجهٔ اولین تلاش بخشی از مهلت است؛ بازیابی گذرا + fallback مستقیم در مهلت باقی‌مانده
            const coldStart = !seenDetailsCall;
            seenDetailsCall = true;
            const recovery = await (0, torob_details_resilience_1.retrieveTorobDetailsWithRecovery)({
                prk: card.prk,
                correlationId: detailsCorrelationId,
                timeoutMs,
                coldStart,
                transports: [
                    {
                        kind: "mcp",
                        run: async (attemptTimeoutMs) => {
                            const address = (0, torob_payload_1.safeTorobDetailsUrl)(card.detailsUrl, card.prk, true);
                            const discoveredAddress = address && new URL(address).searchParams.has("search_id") ? address : null;
                            const out = await callTorobMcpToolWithDiag(opts.mcpUrl, "product_details", {
                                prk: card.prk,
                                ...(discoveredAddress ? { details_url: discoveredAddress } : { query: (0, torob_discovery_1.buildSearchQueries)(opts.productName, opts.sku)[0] }),
                                max_offers: 30, max_in_person: 30,
                            }, attemptTimeoutMs);
                            endpointUnavailable ||= out.endpointUnavailable === true && !out.blocked;
                            return out.data != null ? decodeMcpDetails(out.data, now) : {
                                ...out, issue: out.issue === "mcp_timeout" ? "details_timeout" : out.issue, data: undefined,
                            };
                        },
                        // پاسخ بدون عنوانِ قابل استفاده، «قابل استفاده» نیست (رفتار قدیمی canUseFallback)
                        isUsable: (read) => Boolean(read.data) && !read.issue && !read.unavailable && !read.blocked &&
                            Boolean((0, text_1.normalizeText)(read.data?.titleFa) || (0, text_1.normalizeText)(read.data?.titleEn) ||
                                (0, text_1.normalizeText)(card.titleFa) || (0, text_1.normalizeText)(card.titleEn)),
                    },
                    ...(opts.fallbackDetails ? [{
                            kind: "torob_direct",
                            run: (attemptTimeoutMs) => opts.fallbackDetails(card, attemptTimeoutMs),
                        }] : []),
                ],
                onTrace: (trace) => detailsAttemptTraces.push(trace),
            });
            return recovery.read;
        },
        similar: async (card, limit, timeoutMs) => {
            if (endpointUnavailable && opts.fallbackSimilar)
                return opts.fallbackSimilar(card, limit, timeoutMs);
            const started = Date.now();
            const address = (0, torob_payload_1.safeTorobDetailsUrl)(card.detailsUrl, card.prk, true);
            const discoveredAddress = address && new URL(address).searchParams.has("search_id") ? address : null;
            const out = await callTorobMcpToolWithDiag(opts.mcpUrl, "similar_products", {
                prk: card.prk,
                ...(discoveredAddress ? { details_url: discoveredAddress } : {}),
                limit,
            }, timeoutMs);
            const remaining = timeoutMs - (Date.now() - started);
            if (out.endpointUnavailable && opts.fallbackSimilar && remaining > 200) {
                return opts.fallbackSimilar(card, limit, remaining);
            }
            return { ...out, origin: "torob_mcp", data: out.data ?? undefined };
        },
        priceTrend: async (card) => {
            if (endpointUnavailable)
                return null;
            const history = await callTorobMcpTool(opts.mcpUrl, "price_history", { prk: card.prk, ...(card.detailsUrl ? { details_url: card.detailsUrl } : {}), months: 6 }, 4000);
            return history && Array.isArray(history.series) ? analyzeMcpPriceHistory(history) : null;
        },
    });
    const failedTraces = detailsAttemptTraces.filter((trace) => trace.failureKind !== null);
    if (detailsAttemptTraces.length || opts.relayInitMs != null) {
        result.meta = {
            ...result.meta,
            detailsCorrelationId,
            ...(detailsAttemptTraces.length ? { detailsAttempts: detailsAttemptTraces } : {}),
            ...(opts.relayInitMs != null ? { relayInitMs: opts.relayInitMs } : {}),
            ...(failedTraces.length
                ? {
                    detailsFailure: failedTraces.at(-1)?.failureKind,
                    detailsRecovery: detailsAttemptTraces.some((trace) => trace.recoveredByLaterAttempt) ? "recovered" : "failed",
                }
                : {}),
        };
    }
    return result;
}
