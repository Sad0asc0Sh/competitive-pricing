"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.torobAdapter = void 0;
exports.getTorobApiBase = getTorobApiBase;
exports.extractPrk = extractPrk;
exports.looksLikeTorobChallenge = looksLikeTorobChallenge;
exports.normalizeTorobSeller = normalizeTorobSeller;
exports.normalizeTorobInPersonSeller = normalizeTorobInPersonSeller;
exports.parseTorobJson = parseTorobJson;
exports.searchTorobProductV4 = searchTorobProductV4;
exports.fetchTorobPriceTrendV4 = fetchTorobPriceTrendV4;
const client_1 = require("../ai/client");
const filters_1 = require("../pricing/filters");
const matcher_1 = require("../pricing/matcher");
const sourcing_1 = require("../pricing/sourcing");
const humanize_1 = require("./humanize");
const torob_mcp_client_1 = require("./torob-mcp-client");
const DEFAULT_TOROB_API_BASE = "https://api.torob.com";
function getTorobApiBase() {
    return (process.env.TOROB_API_BASE || DEFAULT_TOROB_API_BASE).replace(/\/+$/, "");
}
/** استخراج prk از URL ترب: https://torob.com/p/<prk>/<slug>/ */
function extractPrk(url, prk) {
    if (prk && prk.trim()) {
        const clean = prk.trim();
        const m = clean.match(/\/p\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : clean;
    }
    if (!url)
        return null;
    const m = url.match(/\/p\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
}
const num = (v) => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
        return (0, sourcing_1.parsePriceToToman)(v, "toman");
    }
    return 0;
};
const str = (v) => (v == null ? "" : String(v));
/** تشخیص کپچا / چالش ربات ترب (HTTP 490 یا صفحه arCAPTCHA طبق منطق torob-mcp) */
function looksLikeTorobChallenge(status, contentType, body) {
    if (status === 490)
        return true;
    if (contentType.toLowerCase().includes("json"))
        return false;
    return /arcaptcha|ربات هستید|captcha/i.test(body.slice(0, 4000));
}
function normalizeTorobSeller(s, now = new Date()) {
    const price = num(s.price ?? s.price_value ?? s.min_price ?? s.price_text ?? s.price_string);
    const shopName = str(s.shop_name ?? s.seller_name ?? s.name1 ?? "نامشخص").trim();
    if (!price || price <= 0)
        return null;
    const shopCity = str(s.shop_city ?? s.city ?? s.shop_name2 ?? "").trim() || null;
    const rawChanged = str(s.last_price_change_date ?? s.last_price_change ?? s.updated_at ?? s.price_updated_at ?? "").trim();
    const lastChangedAt = rawChanged ? (0, filters_1.parsePersianRelativeDate)(rawChanged, now) : null;
    const availabilityVal = s.availability ?? s.stock_status;
    let inStock = true;
    if (typeof availabilityVal === "boolean") {
        inStock = availabilityVal;
    }
    else if (typeof availabilityVal === "string" && availabilityVal.trim()) {
        inStock = !["out_of_stock", "unavailable", "false", "0", "ناموجود"].includes(availabilityVal.trim().toLowerCase());
    }
    const moreInfo = s.more_info ?? {};
    const postageText = str(s.postage_fee ?? s.postage_text ?? "").trim();
    const postageFee = postageText ? (0, sourcing_1.parsePriceToToman)(postageText, "toman") : null;
    const guaranteeInfo = s.guarantee_info ?? {};
    const shopScoreRaw = Number(s.shop_score);
    const shopVotesRaw = Number(s.shop_votes_count ?? s.shop_votes ?? 0);
    const shopPercentileRaw = Number(s.shop_score_percentile);
    return {
        shopName: shopName || "نامشخص",
        shopId: str(s.shop_id ?? s.shop_slug ?? "") || undefined,
        shopCity,
        sellerType: "online",
        shopScore: Number.isFinite(shopScoreRaw) && shopScoreRaw > 0 ? Math.round(shopScoreRaw * 10) / 10 : null,
        shopVotes: Number.isFinite(shopVotesRaw) && shopVotesRaw > 0 ? Math.round(shopVotesRaw) : 0,
        shopScorePercentile: Number.isFinite(shopPercentileRaw) ? Math.round(shopPercentileRaw) : null,
        price,
        postageFee: postageFee && postageFee > 0 ? postageFee : null,
        deliveredPrice: price + (postageFee && postageFee > 0 ? postageFee : 0),
        freeShipping: typeof moreInfo.free_shipping === "boolean" ? moreInfo.free_shipping : null,
        sameDayDelivery: str(moreInfo.same_day_delivery ?? "") || null,
        paymentOnDelivery: typeof moreInfo.payment_on_delivery === "boolean" ? moreInfo.payment_on_delivery : null,
        guarantee: str(guaranteeInfo.status ?? s.guarantee ?? "") || null,
        priceUnreliable: Boolean(s.is_price_unreliable ?? s.price_unreliable ?? false),
        lastChangedAt,
        lastChangedText: rawChanged || null,
        isAd: Boolean(s.is_adv ?? s.is_ad ?? s.sponsored ?? false),
        inStock,
        url: str(s.page_url ?? s.url ?? s.shop_url ?? "") || undefined,
    };
}
function normalizeTorobInPersonSeller(s, now = new Date()) {
    const price = num(s.price ?? s.price_string ?? s.price_text);
    const shopName = str(s.shop_name ?? "فروشگاه حضوری").trim();
    if (!price || price <= 0)
        return null;
    const shopCity = str(s.city ?? s.shop_name2 ?? "").trim() || null;
    const rawChanged = str(s.last_price_change_date ?? "").trim();
    const lastChangedAt = rawChanged ? (0, filters_1.parsePersianRelativeDate)(rawChanged, now) : null;
    const scoreInfo = s.score_info ?? {};
    const scoreRaw = Number(scoreInfo.score ?? s.score);
    return {
        shopName,
        shopId: str(s.shop_id ?? "") || undefined,
        shopCity,
        sellerType: "in_person",
        shopScore: Number.isFinite(scoreRaw) && scoreRaw > 0 ? Math.round(scoreRaw * 10) / 10 : null,
        price,
        deliveredPrice: price,
        priceUnreliable: Boolean(s.is_price_unreliable ?? s.price_unreliable ?? false),
        lastChangedAt,
        lastChangedText: rawChanged || null,
        isAd: false,
        inStock: true,
        url: s.shop_id ? `https://torob.com/shop/${str(s.shop_id)}/` : undefined,
    };
}
function parseTorobJson(json, now = new Date()) {
    const pi = json.products_info ?? {};
    const onlineCandidates = pi.result ??
        json.sellers ??
        json.products ??
        json.result ??
        [];
    const inStoreBlock = json.products_in_store_info ?? {};
    const inPersonCandidates = Array.isArray(inStoreBlock.result)
        ? inStoreBlock.result
        : [];
    const onlineOffers = onlineCandidates
        .map((s) => normalizeTorobSeller(s, now))
        .filter((o) => !!o);
    const inPersonOffers = inPersonCandidates
        .map((s) => normalizeTorobInPersonSeller(s, now))
        .filter((o) => !!o);
    const offers = [...onlineOffers, ...inPersonOffers];
    const totalOnline = num(json.shop_count ?? json.sellers_count ?? pi.count ?? json.count) || onlineOffers.length;
    const inPersonCount = num(inStoreBlock.count) || inPersonOffers.length;
    const title = str(json.name1 ?? json.name ?? json.title ?? "") || undefined;
    const prk = str(json.random_key ?? json.prk ?? "") || undefined;
    return {
        offers,
        title,
        prk,
        total: Math.max(totalOnline + inPersonCount, offers.length),
        inPersonCount,
    };
}
/**
 * جستجوی هوشمند محصول در API v4 ترب با نام و کد مدل + پالایش ۲۴ نتیجه اول با موتور ۷ لایه تطبیق هویت
 */
async function searchTorobProductV4(query, targetPrk, opts) {
    const cleanQuery = query.replace(/[\u200c\u200d]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanQuery)
        return null;
    try {
        const apiBase = getTorobApiBase();
        await (0, humanize_1.politeDelay)("api.torob.com", 150, 400);
        const params = new URLSearchParams({
            q: cleanQuery,
            page: "0",
            size: "24",
            source: "next_desktop",
        });
        const res = await (0, humanize_1.fetchWithRetry)(`${apiBase}/v4/base-product/search/?${params.toString()}`, {
            headers: (0, humanize_1.browserHeaders)("https://torob.com/"),
        });
        const bodyText = await res.text();
        const ct = res.headers.get("content-type") ?? "";
        if (looksLikeTorobChallenge(res.status, ct, bodyText)) {
            return { prk: null, detailsUrl: null, title: null, challenged: true };
        }
        if (!res.ok)
            return null;
        const raw = JSON.parse(bodyText);
        const rows = Array.isArray(raw.results) ? raw.results : [];
        if (!rows.length)
            return null;
        if (targetPrk) {
            const exact = rows.find((r) => str(r.random_key).trim() === targetPrk.trim());
            if (exact) {
                return {
                    prk: str(exact.random_key).trim(),
                    detailsUrl: str(exact.more_info_url).trim() || null,
                    title: str(exact.name1).trim() || null,
                    matchScore: 100,
                    matchExplanation: "تطابق مستقیم با شناسه یکتای قفل‌شده ترب (PRK)",
                };
            }
        }
        const candidates = rows
            .map((r) => {
            const prk = str(r.random_key).trim();
            if (!prk)
                return null;
            const shopText = str(r.shop_text ?? "")
                .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
                .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
            const sellerCountMatch = shopText.match(/(\d+)/);
            const sellerCount = num(r.shop_count ?? r.sellers_count) ||
                (sellerCountMatch ? Number(sellerCountMatch[1]) : 1);
            return {
                prk,
                titleFa: str(r.name1).trim(),
                titleEn: str(r.name2).trim() || null,
                priceToman: num(r.price ?? r.price_text_striked) || null,
                sellerCount,
                available: !str(r.stock_status ?? "").includes("ناموجود"),
                detailsUrl: str(r.more_info_url).trim() || null,
                shopName: shopText || null,
            };
        })
            .filter((x) => !!x);
        const outcome = (0, matcher_1.selectBestTorobSearchMatch)({
            productName: cleanQuery,
            sku: opts?.sku,
            anchorPriceToman: opts?.anchorPriceToman,
        }, candidates);
        if (!outcome.best) {
            return {
                prk: null,
                detailsUrl: null,
                title: null,
                rejectedAll: true,
                matchExplanation: outcome.explanation,
            };
        }
        return {
            prk: outcome.best.candidate.prk,
            detailsUrl: outcome.best.candidate.detailsUrl ?? null,
            title: outcome.best.candidate.titleFa || null,
            matchScore: outcome.best.score,
            matchExplanation: outcome.explanation,
        };
    }
    catch {
        return null;
    }
}
async function fetchTorobPriceTrendV4(prk) {
    try {
        const apiBase = getTorobApiBase();
        const res = await (0, humanize_1.fetchWithRetry)(`${apiBase}/v4/base-product/price-chart/?prk=${encodeURIComponent(prk)}`, { headers: (0, humanize_1.browserHeaders)(`https://torob.com/p/${prk}/`) }, { retries: 0, timeoutMs: 4000 });
        if (!res.ok)
            return null;
        const raw = (await res.json());
        const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => str(l)) : [];
        const series = (raw.dataSets ?? []).map((ds) => ({
            label: str(ds.label),
            points: (ds.entries ?? [])
                .filter((e) => typeof e.i === "number" && typeof e.val === "number")
                .map((e) => ({ date: labels[e.i] ?? "", value: Math.round(e.val) })),
        }));
        return (0, torob_mcp_client_1.analyzeMcpPriceHistory)({ series });
    }
    catch {
        return null;
    }
}
function extractNextData(html) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m)
        return null;
    try {
        return JSON.parse(m[1]);
    }
    catch {
        return null;
    }
}
function findDetailsInNextData(nd) {
    const stack = [nd];
    let guard = 0;
    while (stack.length && guard++ < 5000) {
        const cur = stack.pop();
        if (cur && typeof cur === "object") {
            const rec = cur;
            if (rec.products_info && typeof rec.products_info === "object")
                return rec;
            for (const v of Object.values(rec))
                if (v && typeof v === "object")
                    stack.push(v);
        }
    }
    return null;
}
exports.torobAdapter = {
    id: "torob",
    label: "ترب (مجهز به Torob MCP)",
    async fetchOffers(product) {
        const fetchedAt = new Date();
        let prk = extractPrk(product.torobUrl, product.torobPrk);
        let detailsUrl = product.torobDetailsUrl ?? null;
        const anchorPriceToman = product.currentFinalPrice && product.currentFinalPrice > 0
            ? product.currentFinalPrice
            : product.costPrice > 0
                ? product.costPrice
                : null;
        // --- لایه ۰: اتصال به سرور Torob MCP در صورت تنظیم متغیر محیطی TOROB_MCP_URL
        const mcpUrl = process.env.TOROB_MCP_URL?.trim();
        if (mcpUrl) {
            const mcpResult = await (0, torob_mcp_client_1.fetchViaTorobMcpServer)({
                mcpUrl,
                prk,
                detailsUrl,
                productName: product.name,
                sku: product.sku,
                anchorPriceToman,
                now: fetchedAt,
            });
            if (mcpResult) {
                if (mcpResult.ok || mcpResult.meta?.challenged || mcpResult.meta?.rejectedInSearch) {
                    return mcpResult;
                }
            }
        }
        // --- لایه ۱: موتور مستقیم Torob API v4 با تطبیق هویت ۷ لایه
        let matchMeta = {};
        if ((!prk || !detailsUrl) && product.name) {
            const discovered = await searchTorobProductV4(product.name, prk, {
                sku: product.sku,
                anchorPriceToman,
            });
            if (discovered?.challenged) {
                return {
                    source: "torob",
                    prk,
                    offers: [],
                    totalSellerCount: 0,
                    fetchedAt,
                    ok: false,
                    error: "ترب درخواست را با چالش امنیتی (HTTP 490 / arCAPTCHA) متوقف کرد. برای استعلام از سرور خارج از کشور، آدرس Relay/Worker ایرانی را در TOROB_API_BASE تنظیم کنید.",
                    meta: { challenged: true },
                };
            }
            if (discovered?.rejectedAll) {
                return {
                    source: "torob",
                    offers: [],
                    totalSellerCount: 0,
                    fetchedAt,
                    ok: false,
                    error: discovered.matchExplanation ?? "هیچ کارتی در ترب با مشخصات و کد مدل محصول مطابقت نداشت",
                };
            }
            if (discovered && discovered.prk) {
                prk = prk ?? discovered.prk;
                detailsUrl = detailsUrl ?? discovered.detailsUrl;
                matchMeta = {
                    matchScore: discovered.matchScore,
                    matchExplanation: discovered.matchExplanation,
                };
            }
        }
        if (!prk) {
            return {
                source: "torob",
                offers: [],
                totalSellerCount: 0,
                fetchedAt,
                ok: false,
                error: "شناسه/لینک ترب (prk) تعریف نشده و در جستجوی خودکار هیچ کارتی با مشخصات و کد مدل محصول مطابقت دقیق نداشت",
            };
        }
        const pageUrl = product.torobUrl ?? `https://torob.com/p/${prk}/`;
        const apiBase = getTorobApiBase();
        try {
            await (0, humanize_1.politeDelay)("api.torob.com", 150, 400);
            const targetApiUrl = detailsUrl && detailsUrl.startsWith("http")
                ? detailsUrl.replace(/^https?:\/\/api\.torob\.com/, apiBase)
                : `${apiBase}/v4/base-product/details/?prk=${encodeURIComponent(prk)}&source=next_desktop`;
            const res = await (0, humanize_1.fetchWithRetry)(targetApiUrl, { headers: (0, humanize_1.browserHeaders)(pageUrl) });
            const bodyText = await res.text();
            const ct = res.headers.get("content-type") ?? "";
            if (looksLikeTorobChallenge(res.status, ct, bodyText)) {
                return {
                    source: "torob",
                    prk,
                    offers: [],
                    totalSellerCount: 0,
                    fetchedAt,
                    ok: false,
                    error: "ترب درخواست را با چالش امنیتی (HTTP 490 / arCAPTCHA) متوقف کرد. برای رفع آن از پروکسی/Relay ایرانی (TOROB_API_BASE) استفاده کنید.",
                    meta: { challenged: true },
                };
            }
            if (res.ok) {
                const json = JSON.parse(bodyText);
                const parsed = parseTorobJson(json, fetchedAt);
                if (parsed.offers.length) {
                    const priceTrend = await fetchTorobPriceTrendV4(prk);
                    return {
                        source: "torob",
                        productTitle: parsed.title ?? undefined,
                        prk: parsed.prk ?? prk,
                        detailsUrl: targetApiUrl,
                        offers: parsed.offers,
                        totalSellerCount: parsed.total,
                        inPersonSellerCount: parsed.inPersonCount,
                        priceTrend,
                        fetchedAt,
                        ok: true,
                        meta: { via: detailsUrl ? "torob_v4_details_url" : "torob_v4_api", ...matchMeta },
                    };
                }
            }
        }
        catch {
            // ادامه به لایه ۲ (HTML)
        }
        // --- لایه ۲: HTML صفحه + __NEXT_DATA__
        let html = "";
        try {
            await (0, humanize_1.politeDelay)("torob.com", 150, 400);
            const res = await (0, humanize_1.fetchWithRetry)(pageUrl, {
                headers: {
                    ...(0, humanize_1.browserHeaders)(),
                    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                },
            }, { retries: 0, timeoutMs: 5000 });
            html = await res.text();
            const nd = extractNextData(html);
            const details = nd ? findDetailsInNextData(nd) : null;
            if (details) {
                const parsed = parseTorobJson(details, fetchedAt);
                if (parsed.offers.length) {
                    return {
                        source: "torob",
                        productTitle: parsed.title ?? undefined,
                        prk,
                        offers: parsed.offers,
                        totalSellerCount: parsed.total,
                        inPersonSellerCount: parsed.inPersonCount,
                        fetchedAt,
                        ok: true,
                        meta: { via: "html_next_data", ...matchMeta },
                    };
                }
            }
        }
        catch {
            // ادامه به لایه ۳ (AI)
        }
        // --- لایه ۳: استخراج با هوش مصنوعی از HTML
        if (html && !looksLikeTorobChallenge(200, "text/html", html)) {
            const ai = await (0, client_1.extractOffersWithAI)(html, product.name);
            if (ai && ai.offers.length) {
                return {
                    source: "torob",
                    productTitle: ai.title ?? undefined,
                    prk,
                    offers: ai.offers,
                    totalSellerCount: ai.totalSellerCount || ai.offers.length,
                    fetchedAt,
                    ok: true,
                    meta: { via: "ai_html_extractor", ...matchMeta },
                };
            }
        }
        return {
            source: "torob",
            prk,
            offers: [],
            totalSellerCount: 0,
            fetchedAt,
            ok: false,
            error: "دسترسی به ترب ممکن نشد (مسدودسازی IP دیتاسنتر خارجی توسط ترب). می‌توانید TOROB_API_BASE را تنظیم کنید.",
        };
    },
};
