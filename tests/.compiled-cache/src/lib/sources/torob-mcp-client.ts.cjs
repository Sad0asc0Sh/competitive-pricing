"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSellerCountFromMcpCard = extractSellerCountFromMcpCard;
exports.convertMcpDetailsToOffers = convertMcpDetailsToOffers;
exports.buildSearchQueries = buildSearchQueries;
exports.analyzeMcpPriceHistory = analyzeMcpPriceHistory;
exports.callTorobMcpToolWithDiag = callTorobMcpToolWithDiag;
exports.callTorobMcpTool = callTorobMcpTool;
exports.fetchViaTorobMcpServer = fetchViaTorobMcpServer;
const filters_1 = require("../pricing/filters");
const matcher_1 = require("../pricing/matcher");
const parse_1 = require("../pricing/match/parse");
const sourcing_1 = require("../pricing/sourcing");
/** تبدیل امن هر مقدار ورودی به عدد صحیح نامنفی (NaN/Infinity → 0) */
function toSafeInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
/** استخراج تعداد فروشنده از فیلد `shop_count` یا متن فارسی `shop_name` کارت ترب (مثلاً «در ۱۲ فروشگاه») */
function extractSellerCountFromMcpCard(card) {
    const explicit = toSafeInt(card.shop_count);
    if (explicit > 0)
        return explicit;
    if (!card.shop_name)
        return null;
    const normalized = String(card.shop_name)
        .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
        .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
    const m = normalized.match(/(\d+)\s*فروشگاه/);
    if (m) {
        const count = Number(m[1]);
        if (Number.isFinite(count) && count > 0)
            return count;
    }
    return 1;
}
/** تبدیل خروجی ابزار `product_details` در `torob-mcp` به لیست `RawOffer[]` موتور قیمت‌گذاری */
function convertMcpDetailsToOffers(details, now = new Date()) {
    const offers = [];
    for (const o of details.offers ?? []) {
        const price = o.price_toman ?? (0, sourcing_1.parsePriceToToman)(o.price_text, "toman");
        if (!price || price <= 0)
            continue;
        offers.push({
            shopName: o.shop_name || "نامشخص",
            shopId: o.shop_id ?? undefined,
            shopCity: o.shop_city ?? null,
            sellerType: "online",
            shopScore: o.shop_score ?? null,
            shopVotes: o.shop_votes ?? 0,
            shopScorePercentile: o.shop_score_percentile ?? null,
            price,
            postageFee: o.postage_fee_toman ?? null,
            deliveredPrice: o.delivered_price_toman ?? price,
            freeShipping: o.free_shipping ?? null,
            sameDayDelivery: o.same_day_delivery ?? null,
            paymentOnDelivery: o.payment_on_delivery ?? null,
            guarantee: o.guarantee ?? null,
            priceUnreliable: Boolean(o.price_unreliable),
            lastChangedText: o.last_price_change_date ?? null,
            lastChangedAt: (0, filters_1.parsePersianRelativeDate)(o.last_price_change_date, now),
            isAd: Boolean(o.is_adv),
            inStock: o.available !== false,
            url: o.url ?? o.buy_url ?? undefined,
        });
    }
    for (const s of details.in_person_sellers ?? []) {
        const price = s.price_toman ?? (0, sourcing_1.parsePriceToToman)(s.price_text, "toman");
        if (!price || price <= 0)
            continue;
        offers.push({
            shopName: s.shop_name || "فروشگاه حضوری",
            shopId: s.shop_id ?? undefined,
            shopCity: s.city ?? null,
            sellerType: "in_person",
            shopScore: s.score ?? null,
            price,
            deliveredPrice: price,
            priceUnreliable: Boolean(s.price_unreliable),
            lastChangedText: s.last_price_change_date ?? null,
            lastChangedAt: (0, filters_1.parsePersianRelativeDate)(s.last_price_change_date, now),
            isAd: false,
            inStock: true,
            url: s.url,
        });
    }
    const onlineCount = Math.max(toSafeInt(details.offer_count), (details.offers ?? []).length);
    const inPersonCount = Math.max(toSafeInt(details.in_person_count), (details.in_person_sellers ?? []).length);
    // خروجی ترب «ارزان‌ترین‌های موجود اول» برش خورده است؟ (پرچم صریح یا تعداد کل > تعداد دریافتی)
    const offersTruncated = details.offers_truncated === true || onlineCount > (details.offers ?? []).length;
    return {
        offers,
        totalSellerCount: onlineCount + inPersonCount,
        inPersonSellerCount: inPersonCount,
        offersTruncated,
        onlineOfferCount: onlineCount,
    };
}
/**
 * پرس‌وجوهای جستجوی ترب برای یک محصول، به ترتیب اولویت:
 *  ۱) نام کامل محصول؛ ۲) فقط کد مدل (دقیق‌ترین کلید جستجو برای کالاهای کددار)؛ ۳) برند + کد مدل.
 * کدهایی که داخل بند «مناسب برای …» (لوازم جانبی) آمده‌اند هویت خود کالا نیستند و استفاده نمی‌شوند.
 */
function buildSearchQueries(productName, sku) {
    const out = [];
    const push = (q) => {
        const t = String(q ?? "").replace(/\s+/g, " ").trim();
        if (t.length >= 3 && !out.some((x) => x.toLowerCase() === t.toLowerCase()))
            out.push(t);
    };
    push(productName);
    try {
        const parsed = (0, parse_1.parseTitle)(productName, { sku });
        const codes = parsed.codes
            .filter((c) => !c.inCompat && c.canon.length >= 5)
            .sort((a, b) => b.canon.length - a.canon.length);
        const best = codes[0];
        if (best) {
            // کد با همان املای عنوانِ ورودی (حروف بزرگ/کوچک و خط‌تیره) پرس‌وجو می‌شود؛ parseTitle متن را کوچک می‌کند
            const needle = best.canon.toLowerCase();
            const original = String(productName)
                .split(/[\s،,;()\[\]]+/)
                .find((w) => w.replace(/[^0-9a-z]/gi, "").toLowerCase() === needle) ?? best.raw;
            push(original);
            const brand = parsed.brands[0] ?? best.brandHint ?? null;
            if (brand && !original.toLowerCase().startsWith(String(brand).toLowerCase()))
                push(`${brand} ${original}`);
        }
    }
    catch {
        // تجزیهٔ عنوان نباید جستجو را بشکند
    }
    return out.slice(0, 3);
}
/** تحلیل سری‌های نمودار قیمت ترب (`price_history` در `torob-mcp`) برای استخراج جهت بازار */
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
/** فراخوانی یک ابزار روی سرور HTTP مربوط به `torob-mcp` به همراه تشخیص دقیق خطای کپچا/490 */
async function callTorobMcpToolWithDiag(mcpEndpointUrl, toolName, args, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(mcpEndpointUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: args,
                },
            }),
            signal: ctrl.signal,
            cache: "no-store",
        });
        if (!res.ok) {
            return { data: null, errorText: `MCP HTTP ${res.status}` };
        }
        const rawText = await res.text();
        let payloadText = rawText;
        if (rawText.includes("data:")) {
            const dataLines = rawText
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .filter(Boolean);
            if (dataLines.length > 0)
                payloadText = dataLines[dataLines.length - 1];
        }
        const rpc = JSON.parse(payloadText);
        if (rpc.error) {
            return { data: null, errorText: rpc.error.message ?? "MCP RPC error" };
        }
        if (!rpc.result) {
            return { data: null, errorText: "Empty MCP response" };
        }
        const textBlock = rpc.result.content?.find((c) => c.type === "text")?.text ?? "";
        if (rpc.result.isError) {
            const challenged = /challenged|490|captcha|bot challenge/i.test(textBlock);
            return { data: null, errorText: textBlock || "خطای ابزار torob-mcp", challenged };
        }
        if (!textBlock)
            return { data: null };
        return { data: JSON.parse(textBlock) };
    }
    catch (e) {
        return { data: null, errorText: e instanceof Error ? e.message : String(e) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** فراخوانی یک ابزار روی سرور HTTP مربوط به `torob-mcp` (پروتکل JSON-RPC 2.0) */
async function callTorobMcpTool(mcpEndpointUrl, toolName, args, timeoutMs = 8000) {
    const out = await callTorobMcpToolWithDiag(mcpEndpointUrl, toolName, args, timeoutMs);
    return out.data;
}
/**
 * واکشی کامل پیشنهادهای یک محصول از طریق سرور `torob-mcp` با فیلتر ۷ لایه تطبیق هویت محصول.
 *
 * مسیر جستجو (وقتی prk شناخته‌شده نیست) چندمرحله‌ای است: نام کامل ← فقط کد مدل ← برند+کد. نتایج مراحل روی هم
 * انباشته و دوباره با تطبیق‌دهنده رتبه‌بندی می‌شوند؛ به محض اینکه یک کارت «تایید خودکار» شد جستجو متوقف می‌شود.
 * اطلاعات بریدگی خروجی (offers_truncated / offer_count / price_range_toman) و عنوان انگلیسی کارت به موتور داده می‌شود.
 */
async function fetchViaTorobMcpServer(opts) {
    const now = opts.now ?? new Date();
    let prk = opts.prk?.trim() || null;
    let detailsUrl = opts.detailsUrl?.trim() || null;
    let matchExplanation = null;
    let matchScore = null;
    const searchLog = [];
    const challengedResult = (where, errorText) => ({
        source: "torob",
        prk,
        offers: [],
        totalSellerCount: 0,
        fetchedAt: now,
        ok: false,
        error: "فایروال ترب روی آی‌پی دیتاسنتر سرور چالش امنیتی (HTTP 490 / arCAPTCHA) فعال کرده است. برای استعلام بدون محدودیت از سرور خارج از ایران، آدرس Relay/Worker ایرانی را در متغیر TOROB_API_BASE تنظیم کنید یا از دکمه «ریست قفل ترب» استفاده نمایید.",
        meta: { challenged: true, mcpError: errorText, stage: where },
    });
    // اگر prk نداریم، نتایج جستجو را (تا ۳ پرس‌وجو) با موتور ۷ لایه تطبیق هویت پایش می‌کنیم
    if (!prk && opts.productName) {
        const cardsByPrk = new Map();
        let outcome = null;
        for (const query of buildSearchQueries(opts.productName, opts.sku)) {
            const searchOut = await callTorobMcpToolWithDiag(opts.mcpUrl, "search_products", { query, limit: 24, sort: "popularity" });
            if (searchOut.challenged)
                return challengedResult("search", searchOut.errorText);
            const found = (searchOut.data?.products ?? []).filter((p) => p.prk);
            searchLog.push({ query, cards: found.length, ...(searchOut.errorText ? { error: searchOut.errorText } : {}) });
            for (const c of found)
                if (!cardsByPrk.has(c.prk))
                    cardsByPrk.set(c.prk, c);
            if (!cardsByPrk.size)
                continue;
            outcome = (0, matcher_1.selectBestTorobSearchMatch)({ productName: opts.productName, sku: opts.sku, anchorPriceToman: opts.anchorPriceToman }, [...cardsByPrk.values()].map((c) => ({
                prk: c.prk,
                titleFa: c.name_fa ?? "",
                titleEn: c.name_en ?? null,
                priceToman: c.price_toman,
                sellerCount: extractSellerCountFromMcpCard(c),
                available: c.available !== false,
                detailsUrl: c.details_url,
                shopName: c.shop_name,
            })));
            if (outcome.confident)
                break;
        }
        if (outcome) {
            if (outcome.best) {
                prk = outcome.best.candidate.prk;
                detailsUrl = outcome.best.candidate.detailsUrl ?? detailsUrl;
                matchExplanation = outcome.explanation;
                matchScore = outcome.best.score;
            }
            else {
                return {
                    source: "torob",
                    offers: [],
                    totalSellerCount: 0,
                    fetchedAt: now,
                    ok: false,
                    error: outcome.explanation,
                    meta: { rejectedInSearch: true, searchQueries: searchLog },
                };
            }
        }
    }
    if (!prk)
        return null;
    const detailsOut = await callTorobMcpToolWithDiag(opts.mcpUrl, "product_details", {
        prk,
        ...(detailsUrl ? { details_url: detailsUrl } : {}),
        max_offers: 30,
        max_in_person: 30,
    });
    if (detailsOut.challenged)
        return challengedResult("details", detailsOut.errorText);
    const details = detailsOut.data;
    if (!details || (!details.offers?.length && !details.in_person_sellers?.length)) {
        return null;
    }
    const converted = convertMcpDetailsToOffers(details, now);
    const chart = await callTorobMcpTool(opts.mcpUrl, "price_history", { prk, ...(detailsUrl ? { details_url: detailsUrl } : {}), months: 6 }, 4000);
    return {
        source: "torob",
        productTitle: details.name_fa ?? undefined,
        productTitleEn: details.name_en ?? null,
        prk: details.prk ?? prk,
        detailsUrl,
        offers: converted.offers,
        totalSellerCount: converted.totalSellerCount,
        inPersonSellerCount: converted.inPersonSellerCount,
        priceTrend: chart ? analyzeMcpPriceHistory(chart) : null,
        fetchedAt: now,
        ok: converted.offers.length > 0,
        meta: {
            via: "torob_mcp_server",
            mcpUrl: opts.mcpUrl,
            matchScore,
            matchExplanation,
            // اطلاعات کفایت داده: خروجی ترب «۳۰ ارزان‌ترینِ موجود» است؛ موتور باید بداند چیزی دیده نشده یا نه
            offersTruncated: converted.offersTruncated,
            onlineOfferCount: converted.onlineOfferCount,
            offersReturned: (details.offers ?? []).length,
            priceRangeToman: details.price_range_toman ?? null,
            resolvedBy: details.resolved_by ?? null,
            categoryPath: (details.category_path ?? []).map((c) => c.title),
            isAuthentic: details.is_authentic === true,
            availabilityNote: details.availability_note ?? null,
            searchQueries: searchLog,
        },
    };
}
