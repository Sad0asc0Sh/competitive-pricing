"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.analyzeMcpPriceHistory = analyzeMcpPriceHistory;
exports.callTorobMcpTool = callTorobMcpTool;
exports.callTorobMcpToolWithDiag = callTorobMcpToolWithDiag;
exports.convertMcpDetailsToOffers = convertMcpDetailsToOffers;
exports.extractSellerCountFromMcpCard = extractSellerCountFromMcpCard;
exports.fetchViaTorobMcpServer = fetchViaTorobMcpServer;
var _filters = require("../pricing/filters");
var _matcher = require("../pricing/matcher");
var _sourcing = require("../pricing/sourcing");
/** تبدیل امن هر مقدار ورودی به عدد صحیح نامنفی (NaN/Infinity → 0) */
function toSafeInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** استخراج تعداد فروشنده از فیلد `shop_count` یا متن فارسی `shop_name` کارت ترب (مثلاً «در ۱۲ فروشگاه») */
function extractSellerCountFromMcpCard(card) {
  const explicit = toSafeInt(card.shop_count);
  if (explicit > 0) return explicit;
  if (!card.shop_name) return null;
  const normalized = String(card.shop_name).replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728)).replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1584));
  const m = normalized.match(/(\d+)\s*فروشگاه/);
  if (m) {
    const count = Number(m[1]);
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 1;
}

/** تبدیل خروجی ابزار `product_details` در `torob-mcp` به لیست `RawOffer[]` موتور قیمت‌گذاری */
function convertMcpDetailsToOffers(details, now = new Date()) {
  const offers = [];
  for (const o of details.offers ?? []) {
    const price = o.price_toman ?? (0, _sourcing.parsePriceToToman)(o.price_text, "toman");
    if (!price || price <= 0) continue;
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
      lastChangedAt: (0, _filters.parsePersianRelativeDate)(o.last_price_change_date, now),
      isAd: Boolean(o.is_adv),
      inStock: o.available !== false,
      url: o.url ?? o.buy_url ?? undefined
    });
  }
  for (const s of details.in_person_sellers ?? []) {
    const price = s.price_toman ?? (0, _sourcing.parsePriceToToman)(s.price_text, "toman");
    if (!price || price <= 0) continue;
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
      lastChangedAt: (0, _filters.parsePersianRelativeDate)(s.last_price_change_date, now),
      isAd: false,
      inStock: true,
      url: s.url
    });
  }
  const onlineCount = Math.max(toSafeInt(details.offer_count), (details.offers ?? []).length);
  const inPersonCount = Math.max(toSafeInt(details.in_person_count), (details.in_person_sellers ?? []).length);
  return {
    offers,
    totalSellerCount: onlineCount + inPersonCount,
    inPersonSellerCount: inPersonCount
  };
}

/** تحلیل سری‌های نمودار قیمت ترب (`price_history` در `torob-mcp`) برای استخراج جهت بازار */
function analyzeMcpPriceHistory(chart) {
  if (!chart?.series?.length) return null;
  const minSeries = chart.series.find(s => s.label?.includes("کمترین")) ?? chart.series[0];
  const avgSeries = chart.series.find(s => s.label?.includes("میانگین")) ?? chart.series[1] ?? minSeries;
  const pts = minSeries?.points ?? [];
  if (pts.length < 2) {
    return {
      direction: "unknown",
      changePct30d: 0,
      latestLowest: pts[pts.length - 1]?.value ?? null,
      latestAverage: avgSeries?.points?.[avgSeries.points.length - 1]?.value ?? null
    };
  }
  const latest = pts[pts.length - 1].value;
  const prev = pts[Math.max(0, pts.length - 2)].value;
  const changePct = prev > 0 ? Math.round((latest - prev) / prev * 1000) / 10 : 0;
  let direction = "stable";
  if (changePct <= -2) direction = "falling";else if (changePct >= 2) direction = "rising";
  return {
    direction,
    changePct30d: changePct,
    latestLowest: latest,
    latestAverage: avgSeries?.points?.[avgSeries.points.length - 1]?.value ?? null,
    summaryText: `روند اخیر قیمت در ترب: ${direction === "falling" ? "نزولی" : direction === "rising" ? "صعودی" : "باثبات"} (${changePct >= 0 ? "+" : ""}${changePct}%)`
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
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      }),
      signal: ctrl.signal,
      cache: "no-store"
    });
    if (!res.ok) {
      return {
        data: null,
        errorText: `MCP HTTP ${res.status}`
      };
    }
    const rawText = await res.text();
    let payloadText = rawText;
    if (rawText.includes("data:")) {
      const dataLines = rawText.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).filter(Boolean);
      if (dataLines.length > 0) payloadText = dataLines[dataLines.length - 1];
    }
    const rpc = JSON.parse(payloadText);
    if (rpc.error) {
      return {
        data: null,
        errorText: rpc.error.message ?? "MCP RPC error"
      };
    }
    if (!rpc.result) {
      return {
        data: null,
        errorText: "Empty MCP response"
      };
    }
    const textBlock = rpc.result.content?.find(c => c.type === "text")?.text ?? "";
    if (rpc.result.isError) {
      const challenged = /challenged|490|captcha|bot challenge/i.test(textBlock);
      return {
        data: null,
        errorText: textBlock || "خطای ابزار torob-mcp",
        challenged
      };
    }
    if (!textBlock) return {
      data: null
    };
    return {
      data: JSON.parse(textBlock)
    };
  } catch (e) {
    return {
      data: null,
      errorText: e instanceof Error ? e.message : String(e)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** فراخوانی یک ابزار روی سرور HTTP مربوط به `torob-mcp` (پروتکل JSON-RPC 2.0) */
async function callTorobMcpTool(mcpEndpointUrl, toolName, args, timeoutMs = 8000) {
  const out = await callTorobMcpToolWithDiag(mcpEndpointUrl, toolName, args, timeoutMs);
  return out.data;
}

/**
 * واکشی کامل پیشنهادهای یک محصول از طریق سرور `torob-mcp` با فیلتر ۷ لایه تطبیق هویت محصول:
 */
async function fetchViaTorobMcpServer(opts) {
  const now = opts.now ?? new Date();
  let prk = opts.prk?.trim() || null;
  let detailsUrl = opts.detailsUrl?.trim() || null;
  let matchExplanation = null;
  let matchScore = null;

  // اگر prk نداریم، تا ۲۴ نتیجه اول را از torob-mcp گرفته و با موتور ۷ لایه تطبیق هویت پایش می‌کنیم
  if (!prk && opts.productName) {
    const searchOut = await callTorobMcpToolWithDiag(opts.mcpUrl, "search_products", {
      query: opts.productName,
      limit: 24,
      sort: "popularity"
    });
    if (searchOut.challenged) {
      return {
        source: "torob",
        offers: [],
        totalSellerCount: 0,
        fetchedAt: now,
        ok: false,
        error: "فایروال ترب روی آی‌پی دیتاسنتر سرور چالش امنیتی (HTTP 490 / arCAPTCHA) فعال کرده است. برای استعلام بدون محدودیت از سرور خارج از ایران، آدرس Relay/Worker ایرانی را در متغیر TOROB_API_BASE تنظیم کنید یا از دکمه «ریست قفل ترب» استفاده نمایید.",
        meta: {
          challenged: true,
          mcpError: searchOut.errorText
        }
      };
    }
    const cards = (searchOut.data?.products ?? []).filter(p => p.prk);
    if (cards.length > 0) {
      const matchOutcome = (0, _matcher.selectBestTorobSearchMatch)({
        productName: opts.productName,
        sku: opts.sku,
        anchorPriceToman: opts.anchorPriceToman
      }, cards.map(c => ({
        prk: c.prk,
        titleFa: c.name_fa ?? "",
        titleEn: c.name_en ?? null,
        priceToman: c.price_toman,
        sellerCount: extractSellerCountFromMcpCard(c),
        available: c.available !== false,
        detailsUrl: c.details_url,
        shopName: c.shop_name
      })));
      if (matchOutcome.best) {
        prk = matchOutcome.best.candidate.prk;
        detailsUrl = matchOutcome.best.candidate.detailsUrl ?? detailsUrl;
        matchExplanation = matchOutcome.explanation;
        matchScore = matchOutcome.best.score;
      } else {
        return {
          source: "torob",
          offers: [],
          totalSellerCount: 0,
          fetchedAt: now,
          ok: false,
          error: matchOutcome.explanation,
          meta: {
            rejectedInSearch: true
          }
        };
      }
    }
  }
  if (!prk) return null;
  const detailsOut = await callTorobMcpToolWithDiag(opts.mcpUrl, "product_details", {
    prk,
    ...(detailsUrl ? {
      details_url: detailsUrl
    } : {}),
    max_offers: 30,
    max_in_person: 30
  });
  if (detailsOut.challenged) {
    return {
      source: "torob",
      prk,
      offers: [],
      totalSellerCount: 0,
      fetchedAt: now,
      ok: false,
      error: "فایروال ترب روی آی‌پی دیتاسنتر سرور چالش امنیتی (HTTP 490 / arCAPTCHA) فعال کرده است. برای رفع آن متغیر TOROB_API_BASE را تنظیم کنید.",
      meta: {
        challenged: true,
        mcpError: detailsOut.errorText
      }
    };
  }
  const details = detailsOut.data;
  if (!details || !details.offers?.length && !details.in_person_sellers?.length) {
    return null;
  }
  const converted = convertMcpDetailsToOffers(details, now);
  const chart = await callTorobMcpTool(opts.mcpUrl, "price_history", {
    prk,
    ...(detailsUrl ? {
      details_url: detailsUrl
    } : {}),
    months: 6
  }, 4000);
  return {
    source: "torob",
    productTitle: details.name_fa ?? opts.productName,
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
      matchExplanation
    }
  };
}