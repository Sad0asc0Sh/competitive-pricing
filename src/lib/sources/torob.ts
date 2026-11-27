import { parsePersianRelativeDate } from "@/lib/pricing/filters";
import { parseTitle } from "@/lib/pricing/match/parse";
import { normalizeText } from "@/lib/pricing/match/text";
import type { TorobCandidateCard } from "@/lib/pricing/matcher";
import type { MarketPriceTrend, RawOffer } from "@/lib/pricing/types";
import { getTorobRelayConfig, syncTorobRelayToMcp } from "@/lib/torob-relay/config";
import { fetchViaEncryptedRelay } from "@/lib/torob-relay/crypto";
import { politeDelay } from "./humanize";
import { defaultTorobCache, isNativeFetchActive } from "./torob-cache";
import { resolveTorobSource, type TorobRead } from "./torob-discovery";
import { analyzeMcpPriceHistory, fetchViaTorobMcpServer } from "./torob-mcp-client";
import {
  cleanPrk, countOf, firstText, offerSourceUrl, prkFromTorobUrl, readTorobImages, readTorobSpecs, readTorobTitles, record,
  safeTorobDetailsUrl, torobPrice, torobStock, type TorobDetailsData, type TorobRecord, type TorobSearchRequest, type TorobSearchSort,
} from "./torob-payload";
import type { KnownPrkHint, PriceSourceAdapter, SourceProduct } from "./types";

const DEFAULT_TOROB_API_BASE = "https://api.torob.com";

export function getTorobApiBase(): string {
  return (process.env.TOROB_API_BASE || DEFAULT_TOROB_API_BASE).replace(/\/+$/, "");
}

export function extractPrk(url?: string | null, prk?: string | null): string | null {
  return cleanPrk(prk) ?? prkFromTorobUrl(prk) ?? prkFromTorobUrl(url);
}

export function looksLikeTorobChallenge(status: number, contentType: string, body: string): boolean {
  return status === 490 || (!contentType.toLowerCase().includes("json") && /arcaptcha|ربات هستید|captcha/i.test(body.slice(0, 4000)));
}

async function torobTransportGet(target: "api" | "site", path: string, timeoutMs: number): Promise<TorobRead<string>> {
  const host = target === "api" ? "api.torob.com" : "torob.com";
  const headers = { Accept: target === "api" ? "application/json" : "text/html", "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8" };
  const deadline = Date.now() + timeoutMs;
  try {
    const relay = await getTorobRelayConfig();
    await politeDelay(host, 150, 400);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { unavailable: true, issue: "transport_timeout" };
    let status: number;
    let contentType: string;
    let body: string;
    if (relay.enabled && relay.configured && relay.mode === "encrypted_relay") {
      const response = await fetchViaEncryptedRelay({
        relayUrl: relay.url, relayKey: relay.relayKey, target, path, headers, timeoutMs: remaining,
      });
      status = response.status ?? 502;
      contentType = response.contentType ?? "";
      body = response.body ?? "";
      if (!response.ok && status >= 200 && status < 300) return { unavailable: true, issue: "relay_unavailable" };
    } else {
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
    if (looksLikeTorobChallenge(status, contentType, body)) return { unavailable: true, blocked: true, challenged: true, issue: "access_challenge" };
    if (status === 429 || status === 403 || status === 401) return { unavailable: true, blocked: true, issue: "access_restricted" };
    if (status < 200 || status >= 300) return { unavailable: true, issue: `torob_http_${status}` };
    return { data: body };
  } catch (error) {
    const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return { unavailable: true, issue: timeout ? "transport_timeout" : "transport_connection" };
  }
}

function jsonValue(body: string | undefined): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function normalizeSeller(s: TorobRecord, now: Date, sellerType: "online" | "in_person"): RawOffer | null {
  const shopName = firstText(s.shop_name, s.seller_name, record(s.shop)?.name);
  const priceNode = record(s.price);
  const unit = priceNode?.currency ?? s.currency ?? s.price_unit;
  const price = torobPrice(s.price_toman) ||
    torobPrice(priceNode?.amount ?? s.price ?? s.price_value ?? s.min_price, unit) ||
    torobPrice(s.price_text ?? s.price_string, unit);
  if (!shopName || price <= 0) return null;
  const shopId = typeof s.shop_id === "number" && Number.isSafeInteger(s.shop_id) ? String(s.shop_id) : firstText(s.shop_id, s.shop_slug);
  const shopUrl = shopId ? `https://torob.com/shop/${encodeURIComponent(shopId)}/` : undefined;
  const shopScore = Number(s.shop_score ?? record(s.score_info)?.score ?? s.score);
  const lastChangedText = firstText(s.last_price_change_date, s.last_price_change, s.updated_at, s.price_updated_at);
  const more = record(s.more_info);
  const postageFee = sellerType === "online" ? torobPrice(s.postage_fee_toman ?? s.postage_fee ?? s.postage_text) : 0;
  return {
    shopName,
    shopId: shopId ?? undefined,
    shopCity: firstText(s.shop_city, s.city, s.shop_name2),
    listingTitle: firstText(s.product_title, s.listing_title, s.product_name, sellerType === "online" ? s.name1 : undefined),
    listingSpecs: readTorobSpecs(s),
    imageUrls: readTorobImages(s),
    currency: "toman",
    observedAt: now,
    sellerType,
    shopScore: Number.isFinite(shopScore) && shopScore > 0 ? Math.round(shopScore * 10) / 10 : null,
    shopVotes: countOf(s.shop_votes_count ?? s.shop_votes) ?? 0,
    shopScorePercentile: countOf(s.shop_score_percentile),
    price,
    postageFee: postageFee || null,
    deliveredPrice: price + postageFee,
    freeShipping: typeof more?.free_shipping === "boolean" ? more.free_shipping : null,
    sameDayDelivery: firstText(more?.same_day_delivery),
    paymentOnDelivery: typeof more?.payment_on_delivery === "boolean" ? more.payment_on_delivery : null,
    guarantee: firstText(record(s.guarantee_info)?.status, s.guarantee),
    priceUnreliable: (s.is_price_unreliable ?? s.price_unreliable) === true,
    lastChangedAt: parsePersianRelativeDate(lastChangedText, now),
    lastChangedText,
    isAd: (s.is_adv ?? s.is_ad ?? s.sponsored) === true,
    inStock: torobStock(s.availability ?? s.available ?? s.stock_status),
    url: offerSourceUrl(s.product_url, s.page_url, s.url, s.shop_url, shopUrl),
  };
}

export function normalizeTorobSeller(s: TorobRecord, now = new Date()): RawOffer | null {
  return normalizeSeller(s, now, "online");
}

export function normalizeTorobInPersonSeller(s: TorobRecord, now = new Date()): RawOffer | null {
  return normalizeSeller(s, now, "in_person");
}

function decodeTorobDetails(value: unknown, now: Date): TorobRead<TorobDetailsData> {
  const outer = record(value);
  const row = record(outer?.data) ?? outer;
  if (!row) return { issue: "details_schema" };
  const online = record(row.products_info);
  const stores = record(row.products_in_store_info);
  const rawOnline = online?.result ?? row.sellers ?? row.products ?? row.result;
  const rawStores = stores?.result;
  const onlineRows = Array.isArray(rawOnline) ? rawOnline : [];
  const storeRows = Array.isArray(rawStores) ? rawStores : [];
  const sellerRows = Array.isArray(rawOnline) || Array.isArray(rawStores) ? onlineRows.length + storeRows.length : null;
  const onlineOfferCount = Math.max(countOf(row.shop_count ?? row.sellers_count ?? online?.count ?? row.count) ?? 0, onlineRows.length);
  const inPersonSellerCount = Math.max(countOf(stores?.count) ?? 0, storeRows.length);
  const offers = [...onlineRows.map((item) => ({ item, type: "online" as const })), ...storeRows.map((item) => ({ item, type: "in_person" as const }))]
    .flatMap(({ item, type }) => {
      const seller = record(item);
      const offer = seller ? normalizeSeller(seller, now, type) : null;
      return offer ? [offer] : [];
    });
  const faultyRows = [...onlineRows, ...storeRows].some((item) => {
    const seller = record(item);
    return !firstText(seller?.shop_name, seller?.seller_name, record(seller?.shop)?.name);
  });
  const badShape = sellerRows == null || (rawOnline != null && !Array.isArray(rawOnline)) ||
    (rawStores != null && !Array.isArray(rawStores)) || faultyRows ||
    (onlineOfferCount > 0 && onlineRows.length === 0) || (inPersonSellerCount > 0 && storeRows.length === 0);
  return {
    ...(badShape ? { issue: "details_schema" } : {}),
    data: {
      ...readTorobTitles(row),
      prk: cleanPrk(row.random_key ?? row.prk) ?? prkFromTorobUrl(row.web_client_absolute_url ?? row.url),
      specs: readTorobSpecs(row),
      imageUrls: readTorobImages(row),
      offers,
      sellerRows,
      totalSellerCount: sellerRows != null || onlineOfferCount + inPersonSellerCount > 0 ? onlineOfferCount + inPersonSellerCount : null,
      inPersonSellerCount,
      onlineOfferCount,
      offersTruncated: onlineOfferCount > onlineRows.length || inPersonSellerCount > storeRows.length,
    },
  };
}

export function parseTorobJson(value: unknown, now = new Date()) {
  const details = decodeTorobDetails(value, now).data;
  return {
    offers: details?.offers ?? [],
    title: details?.titleFa ?? undefined,
    prk: details?.prk ?? undefined,
    total: details?.totalSellerCount ?? 0,
    inPersonCount: details?.inPersonSellerCount ?? 0,
  };
}

const TOROB_SORT_PARAM: Record<TorobSearchSort, string> = {
  popularity: "",
  price: "price",
  expensive: "-price",
  newest: "-date",
  sellers: "-supply",
};

async function searchTorobProductV4(
  reqOrQuery: TorobSearchRequest | string,
  limitOrTimeout?: number,
  maybeTimeoutMs?: number,
): Promise<TorobRead<unknown>> {
  const req: TorobSearchRequest = typeof reqOrQuery === "string"
    ? { query: reqOrQuery, limit: limitOrTimeout ?? 24 }
    : reqOrQuery;
  const timeoutMs = typeof reqOrQuery === "string" ? (maybeTimeoutMs ?? 4500) : (limitOrTimeout ?? 4500);
  const page = Math.max(0, (req.page ?? 1) - 1);
  const params = new URLSearchParams({
    q: req.query,
    page: String(page),
    size: String(req.limit),
    source: "next_desktop",
  });
  const sortParam = req.sort ? TOROB_SORT_PARAM[req.sort] : "";
  if (sortParam) params.set("sort", sortParam);
  if (req.category) params.set("category", req.category);
  if (req.minPriceToman && req.minPriceToman > 0) params.set("price__gt", String(Math.round(req.minPriceToman)));
  if (req.maxPriceToman && req.maxPriceToman > 0) params.set("price__lt", String(Math.round(req.maxPriceToman)));
  const response = await torobTransportGet("api", `/v4/base-product/search/?${params}`, timeoutMs);
  if (response.data === undefined) return response;
  const data = jsonValue(response.data);
  return { origin: "torob_api", ...(data === undefined ? { issue: "search_schema" } : { data }) };
}

async function similarTorobProductsV4(card: TorobCandidateCard, limit: number, timeoutMs: number): Promise<TorobRead<unknown>> {
  const details = safeTorobDetailsUrl(card.detailsUrl, card.prk, true);
  const searchId = details ? new URL(details).searchParams.get("search_id") : null;
  const params = new URLSearchParams({
    prk: card.prk,
    size: String(limit),
    source: "next_desktop",
    ...(searchId ? { search_id: searchId } : {}),
  });
  const response = await torobTransportGet("api", `/v4/base-product/similar-base-product/?${params}`, timeoutMs);
  if (response.data === undefined) return response;
  const data = jsonValue(response.data);
  return { origin: "torob_api", ...(data === undefined ? { issue: "search_schema" } : { data }) };
}

function findDetailsInNextData(html: string, prk: string): TorobRecord | null {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const stack = [jsonValue(script?.[1])];
  let onlyUnlabelled: TorobRecord | null = null;
  let unlabelledCount = 0;
  for (let examined = 0; stack.length && examined < 5000; examined++) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const node = record(value);
    if (!node) continue;
    if (record(node.products_info) || record(node.products_in_store_info)) {
      const id = cleanPrk(node.random_key ?? node.prk) ?? prkFromTorobUrl(node.web_client_absolute_url ?? node.url);
      if (id === prk) return node;
      if (id == null) {
        onlyUnlabelled = node;
        unlabelledCount++;
      }
    }
    for (const item of Object.values(node)) if (item !== null && typeof item === "object") stack.push(item);
  }
  return unlabelledCount === 1 ? onlyUnlabelled : null;
}

async function fetchTorobDetails(card: TorobCandidateCard, now: Date, timeoutMs: number): Promise<TorobRead<TorobDetailsData>> {
  const deadline = Date.now() + timeoutMs;
  const detailsUrl = safeTorobDetailsUrl(card.detailsUrl ?? "/v4/base-product/details/", card.prk)
    ?? safeTorobDetailsUrl("/v4/base-product/details/", card.prk)!;
  const requestUrl = safeTorobDetailsUrl(card.detailsUrl, card.prk, true) ?? detailsUrl;
  const api = await torobTransportGet("api", requestUrl.slice(DEFAULT_TOROB_API_BASE.length), Math.min(5000, timeoutMs));
  if (api.blocked) return { ...api, data: undefined };
  const parsed = api.data === undefined ? { ...api, data: undefined } : decodeTorobDetails(jsonValue(api.data), now);
  if (parsed.data) parsed.data.detailsUrl = detailsUrl;
  if (parsed.data?.prk && parsed.data.prk !== card.prk) return { issue: "details_prk_mismatch" };
  const title = normalizeText(parsed.data?.titleFa) || normalizeText(parsed.data?.titleEn) ||
    normalizeText(card.titleFa) || normalizeText(card.titleEn);
  const remaining = deadline - Date.now();
  if ((parsed.data && !parsed.issue && title) || remaining < 250) {
    return { ...parsed, origin: "torob_api", issue: parsed.issue === "transport_timeout" ? "details_timeout" : parsed.issue };
  }
  const page = await torobTransportGet("site", `/p/${encodeURIComponent(card.prk)}/`, remaining);
  if (page.blocked) return { ...page, data: parsed.data };
  const embedded = page.data && findDetailsInNextData(page.data, card.prk);
  if (embedded) {
    const fromPage = decodeTorobDetails(embedded, now);
    if (fromPage.data) fromPage.data.detailsUrl = detailsUrl;
    if (!fromPage.issue || !parsed.data) return { ...fromPage, origin: "torob_page" };
  }
  return parsed.data ? { ...parsed, origin: "torob_api" } : {
    unavailable: parsed.unavailable && page.unavailable,
    issue: [parsed.issue, page.issue].includes("transport_timeout") ? "details_timeout" : parsed.issue ?? page.issue ?? "details_schema",
  };
}

export async function fetchTorobPriceTrendV4(prk: string): Promise<MarketPriceTrend | null> {
  const res = await torobTransportGet("api", `/v4/base-product/price-chart/?prk=${encodeURIComponent(prk)}`, 4000);
  const raw = record(jsonValue(res.data));
  if (!Array.isArray(raw?.dataSets)) return null;
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const series = raw.dataSets.flatMap((set) => {
    const row = record(set);
    if (!Array.isArray(row?.entries)) return [];
    const points = row.entries.flatMap((item) => {
      const entry = record(item);
      if (typeof entry?.i !== "number" || typeof entry?.val !== "number") return [];
      return [{ date: firstText(labels[entry.i]) ?? "", value: Math.round(entry.val) }];
    });
    return [{ label: firstText(row.label) ?? "", points }];
  });
  return analyzeMcpPriceHistory({ series });
}

export const torobAdapter: PriceSourceAdapter = {
  id: "torob",
  label: "ترب (مجهز به Torob MCP)",
  async fetchOffers(product: SourceProduct) {
    const now = new Date();
    const prk = extractPrk(product.torobUrl, product.torobPrk);
    const preferBroadDiscovery = Boolean(product.matchConfig?.preferBroadDiscovery);
    const directConfirmedLock = Boolean(product.torobLinkConfirmation);
    const cachedPrk = prk && (preferBroadDiscovery || (!product.torobUrl && !directConfirmedLock)) ? prk : null;
    const cache = isNativeFetchActive() && process.env.TOROB_DISABLE_CACHE !== "1" ? defaultTorobCache : undefined;
    const options = {
      productName: product.name,
      sku: product.sku,
      category: product.category,
      prk: cachedPrk ? null : prk,
      cachedPrk,
      knownPrks: product.knownPrks,
      knownPrkHints: product.knownPrkHints,
      detailsUrl: prk ? safeTorobDetailsUrl(product.torobDetailsUrl, prk, true) : null,
      confirmation: product.torobLinkConfirmation,
      anchorPriceToman: product.currentFinalPrice && product.currentFinalPrice > 0 ? product.currentFinalPrice
        : product.costPrice > 0 ? product.costPrice : null,
      matchConfig: product.matchConfig,
      mode: product.matchConfig?.discoveryMode ?? "interactive",
      cache,
      now,
    };
    const details = (card: TorobCandidateCard, timeoutMs: number) => fetchTorobDetails(card, now, timeoutMs);
    const mcpUrl = process.env.TOROB_MCP_URL?.trim();
    if (mcpUrl) {
      await syncTorobRelayToMcp().catch(() => undefined);
      return fetchViaTorobMcpServer({
        ...options,
        mcpUrl,
        fallbackSearch: searchTorobProductV4,
        fallbackDetails: details,
        fallbackSimilar: similarTorobProductsV4,
      });
    }
    return resolveTorobSource({
      ...options,
      via: "torob_v4",
      search: searchTorobProductV4,
      details,
      similar: similarTorobProductsV4,
      priceTrend: (card) => fetchTorobPriceTrendV4(card.prk),
    });
  },
};
