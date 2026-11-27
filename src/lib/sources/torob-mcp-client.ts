import { parsePersianRelativeDate } from "@/lib/pricing/filters";
import { normalizeText } from "@/lib/pricing/match/text";
import type { TorobCandidateCard } from "@/lib/pricing/matcher";
import type { MarketPriceTrend, RawOffer, SourceResult, TorobLinkConfirmation } from "@/lib/pricing/types";
import type { TorobDiscoveryCache } from "./torob-cache";
import { buildSearchQueries, resolveTorobSource, type DiscoveryBudgets, type TorobRead } from "./torob-discovery";
import { cleanPrk, countOf, countSellerText, firstText, offerSourceUrl, readTorobImages, readTorobSpecs, readTorobTitles, record, safeTorobDetailsUrl, torobPrice, torobStock, type TorobDetailsData, type TorobSearchRequest } from "./torob-payload";
import type { KnownPrkHint, SourceMatchConfig } from "./types";

export { buildSearchQueries } from "./torob-discovery";
/**
 * کلاینت اختصاصی اتصال به سرور `torob-mcp` (از طریق پروتکل استاندارد MCP JSON-RPC 2.0 روی HTTP)
 * مجهز به موتور ۷ لایه تطبیق هویت محصول (`selectBestTorobSearchMatch`) برای فیلتر کردن لوازم جانبی،
 * پک‌های چندتایی و مدل‌های مشابه در زمان جستجوی خودکار با نام و کد مدل محصول.
 */

export interface TorobMcpOffer {
  shop_name: string;
  product_title?: string | null;
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
  product_title?: string | null;
  available?: boolean | null;
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

export function extractSellerCountFromMcpCard(card: { shop_count?: number | null; shop_name?: string | null }): number | null {
  const name = firstText(card.shop_name);
  return countOf(card.shop_count) ?? countSellerText(name) ?? (name ? 1 : null);
}

export function convertMcpDetailsToOffers(details: TorobMcpProductDetails, now = new Date()) {
  const offers: RawOffer[] = [];
  const onlineRows = Array.isArray(details.offers) ? details.offers : [];
  const inPersonRows = Array.isArray(details.in_person_sellers) ? details.in_person_sellers : [];

  for (const o of onlineRows) {
    if (!o || typeof o !== "object") continue;
    const shopName = firstText(o.shop_name);
    const price = torobPrice(o.price_toman) || torobPrice(o.price_text);
    if (!shopName || price <= 0) continue;
    offers.push({
      shopName,
      listingTitle: firstText(o.product_title, record(o)?.listing_title, record(o)?.name1),
      listingSpecs: readTorobSpecs(record(o) ?? {}),
      imageUrls: readTorobImages(record(o) ?? {}),
      currency: "toman",
      observedAt: now,
      shopId: firstText(o.shop_id) ?? undefined,
      shopCity: firstText(o.shop_city),
      sellerType: "online",
      shopScore: Number.isFinite(o.shop_score) ? o.shop_score : null,
      shopVotes: countOf(o.shop_votes) ?? 0,
      shopScorePercentile: countOf(o.shop_score_percentile),
      price,
      postageFee: torobPrice(o.postage_fee_toman) || null,
      deliveredPrice: torobPrice(o.delivered_price_toman) || price,
      freeShipping: o.free_shipping ?? null,
      sameDayDelivery: firstText(o.same_day_delivery),
      paymentOnDelivery: o.payment_on_delivery ?? null,
      guarantee: firstText(o.guarantee),
      priceUnreliable: o.price_unreliable === true,
      lastChangedText: firstText(o.last_price_change_date),
      lastChangedAt: parsePersianRelativeDate(firstText(o.last_price_change_date), now),
      isAd: o.is_adv === true,
      inStock: torobStock(o.available),
      url: offerSourceUrl(o.buy_url, o.url),
    });
  }
  for (const s of inPersonRows) {
    if (!s || typeof s !== "object") continue;
    const shopName = firstText(s.shop_name);
    const price = torobPrice(s.price_toman) || torobPrice(s.price_text);
    if (!shopName || price <= 0) continue;
    offers.push({
      shopName,
      listingTitle: firstText(s.product_title, record(s)?.listing_title),
      listingSpecs: readTorobSpecs(record(s) ?? {}),
      imageUrls: readTorobImages(record(s) ?? {}),
      currency: "toman",
      observedAt: now,
      shopId: firstText(s.shop_id) ?? undefined,
      shopCity: firstText(s.city),
      sellerType: "in_person",
      shopScore: Number.isFinite(s.score) ? s.score : null,
      price,
      deliveredPrice: price,
      priceUnreliable: s.price_unreliable === true,
      lastChangedText: firstText(s.last_price_change_date),
      lastChangedAt: parsePersianRelativeDate(firstText(s.last_price_change_date), now),
      isAd: false,
      inStock: torobStock(s.available),
      url: offerSourceUrl(s.url),
    });
  }
  const onlineOfferCount = Math.max(countOf(details.offer_count) ?? 0, onlineRows.length);
  const inPersonSellerCount = Math.max(countOf(details.in_person_count) ?? 0, inPersonRows.length);
  return {
    offers,
    totalSellerCount: onlineOfferCount + inPersonSellerCount,
    inPersonSellerCount,
    onlineOfferCount,
    offersTruncated: details.offers_truncated === true || onlineOfferCount > onlineRows.length || inPersonSellerCount > inPersonRows.length,
  };
}

export interface McpToolCallOutcome<T = unknown> {
  data: T | null;
  issue?: string;
  unavailable?: boolean;
  endpointUnavailable?: boolean;
  blocked?: boolean;
  challenged?: boolean;
}

function mcpFailure(code: string, message: string, status?: number): McpToolCallOutcome<never> {
  const challenged = status === 490 || /\b490\b|arcaptcha|captcha|bot challenge|challenged/i.test(message);
  const blocked = challenged || status === 429 || status === 403 || status === 401 ||
    /\b(?:HTTP\s*)?(?:429|403|401)\b|rate limit|access denied/i.test(message);
  const schema = code === "mcp_response_schema" || /response schema|API shape may have changed/i.test(message);
  const wrongId = /different product id in the details response/i.test(message);
  return { data: null, issue: challenged ? "access_challenge" : blocked ? "access_restricted" : wrongId ? "details_prk_mismatch" : schema ? "mcp_response_schema" : code,
    unavailable: blocked || (!schema && !wrongId), blocked, challenged };
}

export async function callTorobMcpToolWithDiag<T = unknown>(
  mcpEndpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<McpToolCallOutcome<T>> {
  try {
    const res = await fetch(mcpEndpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: toolName, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ...mcpFailure(`mcp_http_${res.status}`, "", res.status), endpointUnavailable: res.status >= 500 && res.status !== 490 };
    }
    const rawText = await res.text();
    try {
      const payload = res.headers.get("content-type")?.includes("text/event-stream") || /^\s*(?:data:|event:)/.test(rawText)
        ? rawText.split(/\r?\n/).filter((line) => line.startsWith("data:")).at(-1)?.slice(5).trim() ?? "" : rawText;
      const rpc = record(JSON.parse(payload));
      const rpcError = record(rpc?.error);
      const result = record(rpc?.result);
      if (rpcError) return mcpFailure("mcp_rpc_error", firstText(rpcError.message) ?? "");
      if (!result) return mcpFailure("mcp_response_schema", "");
      const text = Array.isArray(result.content)
        ? result.content.find((block) => record(block)?.type === "text")?.text : undefined;
      if (result.isError === true) return mcpFailure("mcp_tool_error", typeof text === "string" ? text : "");
      if (record(result.structuredContent)) return { data: result.structuredContent as T };
      return typeof text === "string" ? { data: JSON.parse(text) as T } : mcpFailure("mcp_response_schema", "");
    } catch {
      return mcpFailure("mcp_response_schema", "");
    }
  } catch (error) {
    const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return { data: null, issue: timeout ? "mcp_timeout" : "mcp_connection", unavailable: true, endpointUnavailable: !timeout };
  }
}

export async function callTorobMcpTool<T = unknown>(
  mcpEndpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<T | null> {
  return (await callTorobMcpToolWithDiag<T>(mcpEndpointUrl, toolName, args, timeoutMs)).data;
}

function decodeMcpDetails(value: unknown, now: Date): TorobRead<TorobDetailsData> {
  const payload = record(value);
  const details = record(payload?.data) ?? payload;
  if (!details) return { issue: "details_schema" };
  const online = Array.isArray(details.offers) ? details.offers : null;
  const inPerson = Array.isArray(details.in_person_sellers) ? details.in_person_sellers : null;
  const returnedRows = (online?.length ?? 0) + (inPerson?.length ?? 0);
  const sellerRows = online || inPerson ? Math.max(countOf(details.seller_rows_seen) ?? 0, returnedRows) : null;
  const { offers, ...counts } = convertMcpDetailsToOffers(details as unknown as TorobMcpProductDetails, now);
  const faultyRows = [...(online ?? []), ...(inPerson ?? [])].some((row) => !firstText(record(row)?.shop_name));
  const issue = sellerRows == null || faultyRows || details.seller_schema_incomplete === true ||
    (details.offers != null && online == null) || (details.in_person_sellers != null && inPerson == null) ||
    (counts.onlineOfferCount > 0 && !online?.length) || (counts.inPersonSellerCount > 0 && !inPerson?.length) ? "details_schema" : undefined;
  return {
    issue,
    origin: "torob_mcp",
    data: {
      ...counts,
      ...readTorobTitles(details),
      prk: cleanPrk(details.prk ?? details.random_key),
      specs: readTorobSpecs(details),
      imageUrls: readTorobImages(details),
      offers,
      sellerRows,
      totalSellerCount: sellerRows != null || counts.totalSellerCount > 0 ? counts.totalSellerCount : null,
    },
  };
}

export function fetchViaTorobMcpServer(opts: {
  mcpUrl: string;
  prk?: string | null;
  cachedPrk?: string | null;
  knownPrks?: string[];
  knownPrkHints?: KnownPrkHint[];
  detailsUrl?: string | null;
  confirmation?: TorobLinkConfirmation | null;
  productName: string;
  sku?: string | null;
  category?: string | null;
  anchorPriceToman?: number | null;
  matchConfig?: SourceMatchConfig;
  mode?: "interactive" | "extended";
  cache?: TorobDiscoveryCache;
  budgets?: Partial<DiscoveryBudgets>;
  now?: Date;
  fallbackSearch?:
    | ((req: TorobSearchRequest, timeoutMs: number) => Promise<TorobRead<unknown>>)
    | ((query: string, limit: number, timeoutMs: number) => Promise<TorobRead<unknown>>);
  fallbackDetails?: (card: TorobCandidateCard, timeoutMs: number) => Promise<TorobRead<TorobDetailsData>>;
  fallbackSimilar?: (card: TorobCandidateCard, limit: number, timeoutMs: number) => Promise<TorobRead<unknown>>;
}): Promise<SourceResult> {
  const now = opts.now ?? new Date();
  let endpointUnavailable = false;
  const invokeFallbackSearch = (req: TorobSearchRequest, timeoutMs: number) => {
    if (!opts.fallbackSearch) return Promise.resolve<TorobRead<unknown>>({ unavailable: true });
    if (opts.fallbackSearch.length >= 3) {
      return (opts.fallbackSearch as (q: string, l: number, t: number) => Promise<TorobRead<unknown>>)(req.query, req.limit, timeoutMs);
    }
    return (opts.fallbackSearch as (r: TorobSearchRequest, t: number) => Promise<TorobRead<unknown>>)(req, timeoutMs);
  };
  return resolveTorobSource({
    ...opts,
    mode: opts.mode ?? opts.matchConfig?.discoveryMode ?? "interactive",
    now,
    via: "torob_mcp_server",
    search: async (req, timeoutMs) => {
      if (endpointUnavailable && opts.fallbackSearch) return invokeFallbackSearch(req, timeoutMs);
      const started = Date.now();
      const mcpArgs: Record<string, unknown> = {
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
      if (endpointUnavailable && opts.fallbackSearch && remaining > 200) return invokeFallbackSearch(req, remaining);
      return { ...out, origin: "torob_mcp", data: out.data ?? undefined };
    },
    details: async (card, timeoutMs) => {
      if (endpointUnavailable && opts.fallbackDetails) return opts.fallbackDetails(card, timeoutMs);
      const started = Date.now();
      const address = safeTorobDetailsUrl(card.detailsUrl, card.prk, true);
      const discoveredAddress = address && new URL(address).searchParams.has("search_id") ? address : null;
      const out = await callTorobMcpToolWithDiag(opts.mcpUrl, "product_details", {
        prk: card.prk, ...(discoveredAddress ? { details_url: discoveredAddress } : { query: buildSearchQueries(opts.productName, opts.sku)[0] }),
        max_offers: 30, max_in_person: 30,
      }, timeoutMs);
      const remaining = timeoutMs - (Date.now() - started);
      const decoded: TorobRead<TorobDetailsData> = out.data != null ? decodeMcpDetails(out.data, now) : {
        ...out, issue: out.issue === "mcp_timeout" ? "details_timeout" : out.issue, data: undefined,
      };
      const hasTitle = normalizeText(decoded.data?.titleFa) || normalizeText(decoded.data?.titleEn) ||
        normalizeText(card.titleFa) || normalizeText(card.titleEn);
      const canUseFallback = !out.blocked && remaining > 1000 && opts.fallbackDetails &&
        (!decoded.data || decoded.issue || !hasTitle) && decoded.issue !== "details_prk_mismatch";
      if (canUseFallback) {
        endpointUnavailable ||= out.endpointUnavailable === true;
        const fallback = await opts.fallbackDetails!(card, remaining);
        if (fallback.blocked) return { ...fallback, data: decoded.data };
        if (fallback.data && !fallback.issue) return fallback;
      }
      return decoded;
    },
    similar: async (card, limit, timeoutMs) => {
      if (endpointUnavailable && opts.fallbackSimilar) return opts.fallbackSimilar(card, limit, timeoutMs);
      const started = Date.now();
      const address = safeTorobDetailsUrl(card.detailsUrl, card.prk, true);
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
      if (endpointUnavailable) return null;
      const history = await callTorobMcpTool<Parameters<typeof analyzeMcpPriceHistory>[0]>(
        opts.mcpUrl, "price_history", { prk: card.prk, ...(card.detailsUrl ? { details_url: card.detailsUrl } : {}), months: 6 }, 4000,
      );
      return history && Array.isArray(history.series) ? analyzeMcpPriceHistory(history) : null;
    },
  });
}
