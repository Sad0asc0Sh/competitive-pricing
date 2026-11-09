import { parsePersianRelativeDate } from "@/lib/pricing/filters";
import { selectBestTorobSearchMatch, type BestMatchOutcome } from "@/lib/pricing/matcher";
import { parseTitle } from "@/lib/pricing/match/parse";
import { parsePriceToToman } from "@/lib/pricing/sourcing";
import type { MarketPriceTrend, RawOffer, SourceResult } from "@/lib/pricing/types";

/**
 * کلاینت اختصاصی اتصال به سرور `torob-mcp` (از طریق پروتکل استاندارد MCP JSON-RPC 2.0 روی HTTP)
 * مجهز به موتور ۷ لایه تطبیق هویت محصول (`selectBestTorobSearchMatch`) برای فیلتر کردن لوازم جانبی،
 * پک‌های چندتایی و مدل‌های مشابه در زمان جستجوی خودکار با نام و کد مدل محصول.
 */

export interface TorobMcpOffer {
  shop_name: string;
  shop_city: string | null;
  shop_id: string | null;
  shop_score: number | null;
  shop_votes: number;
  price_toman: number | null;
  price_text: string | null;
  was_price_text: string | null;
  available: boolean;
  price_unreliable: boolean;
  free_shipping: boolean | null;
  payment_on_delivery: boolean | null;
  same_day_delivery: string | null;
  url: string | null;
  buy_url: string | null;
  shop_note: string | null;
  is_adv: boolean;
  postage_text: string | null;
  postage_fee_toman: number | null;
  delivered_price_toman: number | null;
  guarantee: string | null;
  installment_providers: string[];
  last_price_change_date: string | null;
  has_public_torob_profile: boolean | null;
  shop_score_percentile: number | null;
}

export interface TorobMcpInPersonSeller {
  shop_name: string;
  shop_id: string | null;
  city: string | null;
  address: string | null;
  note: string | null;
  price_toman: number | null;
  price_text: string | null;
  price_unreliable: boolean;
  is_open: boolean | null;
  hours_today: string | null;
  hours_status: string | null;
  last_price_change_date: string | null;
  fast_delivery: boolean;
  score: number | null;
  score_note: string | null;
  url: string;
}

export interface TorobMcpProductDetails {
  prk: string;
  name_fa: string | null;
  name_en: string | null;
  cheapest_price_toman: number | null;
  available: boolean;
  /** تعداد کل پیشنهادهای ترب (پیش از برش `max_offers`) */
  offer_count: number;
  /** سرور MCP وقتی پیشنهادها را به `max_offers` ارزان‌ترین برش زده این پرچم را می‌گذارد */
  offers_truncated?: boolean;
  offers_returned?: number;
  in_person_count?: number;
  offers: TorobMcpOffer[];
  in_person_sellers?: TorobMcpInPersonSeller[];
  url?: string;
  /** کمترین و بیشترین قیمت خودِ ترب برای این محصول (پیش از برش) */
  price_range_toman?: { min: number | null; max: number | null };
  /** چگونگی پیدا شدن شناسه: exact-id | name-search | details-url | remembered | id-only | provided-row */
  resolved_by?: string;
  specs?: { group: string | null; key: string; value: string }[];
  category_path?: { id: string; title: string }[];
  variants?: { title: string; count: number }[];
  is_authentic?: boolean;
  availability_note?: string;
}

export interface TorobMcpSearchCard {
  prk: string;
  name_fa: string | null;
  name_en: string | null;
  price_toman: number | null;
  available: boolean;
  shop_name: string | null;
  shop_count?: number | null;
  url: string;
  details_url: string | null;
}

/** تبدیل امن هر مقدار ورودی به عدد صحیح نامنفی (NaN/Infinity → 0) */
function toSafeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** استخراج تعداد فروشنده از فیلد `shop_count` یا متن فارسی `shop_name` کارت ترب (مثلاً «در ۱۲ فروشگاه») */
export function extractSellerCountFromMcpCard(card: TorobMcpSearchCard): number | null {
  const explicit = toSafeInt(card.shop_count);
  if (explicit > 0) return explicit;
  if (!card.shop_name) return null;
  const normalized = String(card.shop_name)
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
  const m = normalized.match(/(\d+)\s*فروشگاه/);
  if (m) {
    const count = Number(m[1]);
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 1;
}

/** تبدیل خروجی ابزار `product_details` در `torob-mcp` به لیست `RawOffer[]` موتور قیمت‌گذاری */
export function convertMcpDetailsToOffers(
  details: TorobMcpProductDetails,
  now: Date = new Date(),
): { offers: RawOffer[]; totalSellerCount: number; inPersonSellerCount: number; offersTruncated: boolean; onlineOfferCount: number } {
  const offers: RawOffer[] = [];

  for (const o of details.offers ?? []) {
    const price = o.price_toman ?? parsePriceToToman(o.price_text, "toman");
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
      lastChangedAt: parsePersianRelativeDate(o.last_price_change_date, now),
      isAd: Boolean(o.is_adv),
      inStock: o.available !== false,
      url: o.url ?? o.buy_url ?? undefined,
    });
  }

  for (const s of details.in_person_sellers ?? []) {
    const price = s.price_toman ?? parsePriceToToman(s.price_text, "toman");
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
      lastChangedAt: parsePersianRelativeDate(s.last_price_change_date, now),
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
export function buildSearchQueries(productName: string, sku?: string | null): string[] {
  const out: string[] = [];
  const push = (q: string | null | undefined) => {
    const t = String(q ?? "").replace(/\s+/g, " ").trim();
    if (t.length >= 3 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(productName);
  try {
    const parsed = parseTitle(productName, { sku });
    const codes = parsed.codes
      .filter((c) => !c.inCompat && c.canon.length >= 5)
      .sort((a, b) => b.canon.length - a.canon.length);
    const best = codes[0];
    if (best) {
      // کد با همان املای عنوانِ ورودی (حروف بزرگ/کوچک و خط‌تیره) پرس‌وجو می‌شود؛ parseTitle متن را کوچک می‌کند
      const needle = best.canon.toLowerCase();
      const original =
        String(productName)
          .split(/[\s،,;()\[\]]+/)
          .find((w) => w.replace(/[^0-9a-z]/gi, "").toLowerCase() === needle) ?? best.raw;
      push(original);
      const brand = parsed.brands[0] ?? best.brandHint ?? null;
      if (brand && !original.toLowerCase().startsWith(String(brand).toLowerCase())) push(`${brand} ${original}`);
    }
  } catch {
    // تجزیهٔ عنوان نباید جستجو را بشکند
  }
  return out.slice(0, 3);
}

/** تحلیل سری‌های نمودار قیمت ترب (`price_history` در `torob-mcp`) برای استخراج جهت بازار */
export function analyzeMcpPriceHistory(chart: {
  series?: { label?: string; points?: { date: string; value: number }[] }[];
}): MarketPriceTrend | null {
  if (!chart?.series?.length) return null;
  const minSeries =
    chart.series.find((s) => s.label?.includes("کمترین")) ?? chart.series[0];
  const avgSeries =
    chart.series.find((s) => s.label?.includes("میانگین")) ?? chart.series[1] ?? minSeries;

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

  let direction: MarketPriceTrend["direction"] = "stable";
  if (changePct <= -2) direction = "falling";
  else if (changePct >= 2) direction = "rising";

  return {
    direction,
    changePct30d: changePct,
    latestLowest: latest,
    latestAverage: avgSeries?.points?.[avgSeries.points.length - 1]?.value ?? null,
    summaryText: `روند اخیر قیمت در ترب: ${direction === "falling" ? "نزولی" : direction === "rising" ? "صعودی" : "باثبات"} (${changePct >= 0 ? "+" : ""}${changePct}%)`,
  };
}

export interface McpToolCallOutcome<T = unknown> {
  data: T | null;
  errorText?: string;
  challenged?: boolean;
}

/** فراخوانی یک ابزار روی سرور HTTP مربوط به `torob-mcp` به همراه تشخیص دقیق خطای کپچا/490 */
export async function callTorobMcpToolWithDiag<T = unknown>(
  mcpEndpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<McpToolCallOutcome<T>> {
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
      if (dataLines.length > 0) payloadText = dataLines[dataLines.length - 1];
    }

    const rpc = JSON.parse(payloadText) as {
      result?: { isError?: boolean; content?: { type?: string; text?: string }[] };
      error?: { message?: string };
    };
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
    if (!textBlock) return { data: null };
    return { data: JSON.parse(textBlock) as T };
  } catch (e) {
    return { data: null, errorText: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** فراخوانی یک ابزار روی سرور HTTP مربوط به `torob-mcp` (پروتکل JSON-RPC 2.0) */
export async function callTorobMcpTool<T = unknown>(
  mcpEndpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<T | null> {
  const out = await callTorobMcpToolWithDiag<T>(mcpEndpointUrl, toolName, args, timeoutMs);
  return out.data;
}

/**
 * واکشی کامل پیشنهادهای یک محصول از طریق سرور `torob-mcp` با فیلتر ۷ لایه تطبیق هویت محصول.
 *
 * مسیر جستجو (وقتی prk شناخته‌شده نیست) چندمرحله‌ای است: نام کامل ← فقط کد مدل ← برند+کد. نتایج مراحل روی هم
 * انباشته و دوباره با تطبیق‌دهنده رتبه‌بندی می‌شوند؛ به محض اینکه یک کارت «تایید خودکار» شد جستجو متوقف می‌شود.
 * اطلاعات بریدگی خروجی (offers_truncated / offer_count / price_range_toman) و عنوان انگلیسی کارت به موتور داده می‌شود.
 */
export async function fetchViaTorobMcpServer(opts: {
  mcpUrl: string;
  prk?: string | null;
  detailsUrl?: string | null;
  productName: string;
  sku?: string | null;
  anchorPriceToman?: number | null;
  now?: Date;
}): Promise<SourceResult | null> {
  const now = opts.now ?? new Date();
  let prk = opts.prk?.trim() || null;
  let detailsUrl = opts.detailsUrl?.trim() || null;
  let matchExplanation: string | null = null;
  let matchScore: number | null = null;
  const searchLog: { query: string; cards: number; error?: string }[] = [];
  const challengedResult = (where: string, errorText?: string): SourceResult => ({
    source: "torob",
    prk,
    offers: [],
    totalSellerCount: 0,
    fetchedAt: now,
    ok: false,
    error:
      "فایروال ترب روی آی‌پی دیتاسنتر سرور چالش امنیتی (HTTP 490 / arCAPTCHA) فعال کرده است. برای استعلام بدون محدودیت از سرور خارج از ایران، آدرس Relay/Worker ایرانی را در متغیر TOROB_API_BASE تنظیم کنید یا از دکمه «ریست قفل ترب» استفاده نمایید.",
    meta: { challenged: true, mcpError: errorText, stage: where },
  });

  // اگر prk نداریم، نتایج جستجو را (تا ۳ پرس‌وجو) با موتور ۷ لایه تطبیق هویت پایش می‌کنیم
  if (!prk && opts.productName) {
    const cardsByPrk = new Map<string, TorobMcpSearchCard>();
    let outcome: BestMatchOutcome | null = null;
    for (const query of buildSearchQueries(opts.productName, opts.sku)) {
      const searchOut = await callTorobMcpToolWithDiag<{ products?: TorobMcpSearchCard[] }>(
        opts.mcpUrl,
        "search_products",
        { query, limit: 24, sort: "popularity" },
      );
      if (searchOut.challenged) return challengedResult("search", searchOut.errorText);
      const found = (searchOut.data?.products ?? []).filter((p) => p.prk);
      searchLog.push({ query, cards: found.length, ...(searchOut.errorText ? { error: searchOut.errorText } : {}) });
      for (const c of found) if (!cardsByPrk.has(c.prk)) cardsByPrk.set(c.prk, c);
      if (!cardsByPrk.size) continue;
      outcome = selectBestTorobSearchMatch(
        { productName: opts.productName, sku: opts.sku, anchorPriceToman: opts.anchorPriceToman },
        [...cardsByPrk.values()].map((c) => ({
          prk: c.prk,
          titleFa: c.name_fa ?? "",
          titleEn: c.name_en ?? null,
          priceToman: c.price_toman,
          sellerCount: extractSellerCountFromMcpCard(c),
          available: c.available !== false,
          detailsUrl: c.details_url,
          shopName: c.shop_name,
        })),
      );
      if (outcome.confident) break;
    }

    if (outcome) {
      if (outcome.best) {
        prk = outcome.best.candidate.prk;
        detailsUrl = outcome.best.candidate.detailsUrl ?? detailsUrl;
        matchExplanation = outcome.explanation;
        matchScore = outcome.best.score;
      } else {
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

  if (!prk) return null;

  const detailsOut = await callTorobMcpToolWithDiag<TorobMcpProductDetails>(
    opts.mcpUrl,
    "product_details",
    {
      prk,
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
      max_offers: 30,
      max_in_person: 30,
    },
  );

  if (detailsOut.challenged) return challengedResult("details", detailsOut.errorText);

  const details = detailsOut.data;
  if (!details || (!details.offers?.length && !details.in_person_sellers?.length)) {
    return null;
  }

  const converted = convertMcpDetailsToOffers(details, now);
  const chart = await callTorobMcpTool<{ series?: { label?: string; points?: { date: string; value: number }[] }[] }>(
    opts.mcpUrl,
    "price_history",
    { prk, ...(detailsUrl ? { details_url: detailsUrl } : {}), months: 6 },
    4000,
  );

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
