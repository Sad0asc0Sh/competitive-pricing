import { aiEnabled, extractOffersWithAI, verifyTorobMatchesWithAI } from "@/lib/ai/client";
import { parsePersianRelativeDate } from "@/lib/pricing/filters";
import { selectBestTorobSearchMatch } from "@/lib/pricing/matcher";
import { parsePriceToToman } from "@/lib/pricing/sourcing";
import type { AIIdentityCheckMeta, MarketPriceTrend, RawOffer, SourceResult } from "@/lib/pricing/types";
import { getTorobRelayConfig, syncTorobRelayToMcp } from "@/lib/torob-relay/config";
import { fetchViaEncryptedRelay } from "@/lib/torob-relay/crypto";
import { browserHeaders, fetchWithRetry, politeDelay } from "./humanize";
import { analyzeMcpPriceHistory, fetchViaTorobMcpServer, mergeTorobPanelOffers } from "./torob-mcp-client";
import type { PriceSourceAdapter, SourceMatchConfig, SourceProduct } from "./types";

const DEFAULT_TOROB_API_BASE = "https://api.torob.com";

export function getTorobApiBase(): string {
  return (process.env.TOROB_API_BASE || DEFAULT_TOROB_API_BASE).replace(/\/+$/, "");
}

interface TorobTransportResponse {
  ok: boolean;
  status: number;
  contentType: string;
  bodyText: string;
  error?: string;
}

async function torobTransportGet(
  target: "api" | "site",
  path: string,
  headers: Record<string, string>,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<TorobTransportResponse> {
  const relay = await getTorobRelayConfig();
  if (relay.enabled && relay.configured && relay.mode === "encrypted_relay") {
    const relayed = await fetchViaEncryptedRelay({
      relayUrl: relay.url,
      relayKey: relay.relayKey,
      target,
      path,
      headers,
      timeoutMs: opts.timeoutMs ?? 12_000,
    });
    const status = relayed.status ?? 502;
    const ok = relayed.ok && status >= 200 && status < 300;
    return {
      ok,
      status,
      contentType: relayed.contentType ?? "",
      bodyText: relayed.body ?? "",
      error: ok ? undefined : relayed.error || `Relay HTTP ${status}`,
    };
  }

  const base =
    target === "site"
      ? "https://torob.com"
      : relay.enabled && relay.configured && relay.mode === "plain_https_base"
        ? relay.url
        : getTorobApiBase();
  const res = await fetchWithRetry(`${base}${path}`, { headers }, opts);
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    bodyText: await res.text(),
    error: res.ok ? undefined : `HTTP ${res.status}`,
  };
}

/** استخراج prk از URL ترب: https://torob.com/p/<prk>/<slug>/ */
export function extractPrk(url?: string | null, prk?: string | null): string | null {
  if (prk && prk.trim()) {
    const clean = prk.trim();
    const m = clean.match(/\/p\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : clean;
  }
  if (!url) return null;
  const m = url.match(/\/p\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

type AnyRec = Record<string, unknown>;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    return parsePriceToToman(v, "toman");
  }
  return 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

/** تشخیص کپچا / چالش ربات ترب (HTTP 490 یا صفحه arCAPTCHA طبق منطق torob-mcp) */
export function looksLikeTorobChallenge(status: number, contentType: string, body: string): boolean {
  if (status === 490) return true;
  if (contentType.toLowerCase().includes("json")) return false;
  return /arcaptcha|ربات هستید|captcha/i.test(body.slice(0, 4000));
}

export function normalizeTorobSeller(s: AnyRec, now: Date = new Date()): RawOffer | null {
  const price = num(s.price ?? s.price_value ?? s.min_price ?? s.price_text ?? s.price_string);
  const shopName = str(s.shop_name ?? s.seller_name ?? s.name1 ?? "نامشخص").trim();
  if (!price || price <= 0) return null;

  const shopCity = str(s.shop_city ?? s.city ?? s.shop_name2 ?? "").trim() || null;

  const rawChanged = str(
    s.last_price_change_date ?? s.last_price_change ?? s.updated_at ?? s.price_updated_at ?? "",
  ).trim();
  const lastChangedAt = rawChanged ? parsePersianRelativeDate(rawChanged, now) : null;

  const availabilityVal = s.availability ?? s.stock_status;
  let inStock = true;
  if (typeof availabilityVal === "boolean") {
    inStock = availabilityVal;
  } else if (typeof availabilityVal === "string" && availabilityVal.trim()) {
    inStock = !["out_of_stock", "unavailable", "false", "0", "ناموجود"].includes(
      availabilityVal.trim().toLowerCase(),
    );
  }

  const moreInfo = (s.more_info as AnyRec | undefined) ?? {};
  const postageText = str(s.postage_fee ?? s.postage_text ?? "").trim();
  const postageFee = postageText ? parsePriceToToman(postageText, "toman") : null;
  const guaranteeInfo = (s.guarantee_info as AnyRec | undefined) ?? {};
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

export function normalizeTorobInPersonSeller(s: AnyRec, now: Date = new Date()): RawOffer | null {
  const price = num(s.price ?? s.price_string ?? s.price_text);
  const shopName = str(s.shop_name ?? "فروشگاه حضوری").trim();
  if (!price || price <= 0) return null;

  const shopCity = str(s.city ?? s.shop_name2 ?? "").trim() || null;
  const rawChanged = str(s.last_price_change_date ?? "").trim();
  const lastChangedAt = rawChanged ? parsePersianRelativeDate(rawChanged, now) : null;
  const scoreInfo = (s.score_info as AnyRec | undefined) ?? {};
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

export function parseTorobJson(
  json: AnyRec,
  now: Date = new Date(),
): {
  offers: RawOffer[];
  title?: string;
  prk?: string;
  total: number;
  inPersonCount: number;
} {
  const pi = (json.products_info as AnyRec | undefined) ?? {};
  const onlineCandidates =
    (pi.result as AnyRec[] | undefined) ??
    (json.sellers as AnyRec[] | undefined) ??
    (json.products as AnyRec[] | undefined) ??
    (json.result as AnyRec[] | undefined) ??
    [];

  const inStoreBlock = (json.products_in_store_info as AnyRec | undefined) ?? {};
  const inPersonCandidates = Array.isArray(inStoreBlock.result)
    ? (inStoreBlock.result as AnyRec[])
    : [];

  const onlineOffers = onlineCandidates
    .map((s) => normalizeTorobSeller(s, now))
    .filter((o): o is RawOffer => !!o);

  const inPersonOffers = inPersonCandidates
    .map((s) => normalizeTorobInPersonSeller(s, now))
    .filter((o): o is RawOffer => !!o);

  const offers = [...onlineOffers, ...inPersonOffers];
  const totalOnline =
    num(json.shop_count ?? json.sellers_count ?? pi.count ?? json.count) || onlineOffers.length;
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
export async function searchTorobProductV4(
  query: string,
  targetPrk?: string | null,
  opts?: {
    sku?: string | null;
    category?: string | null;
    anchorPriceToman?: number | null;
    matchConfig?: SourceMatchConfig;
  },
): Promise<{
  prk: string | null;
  detailsUrl: string | null;
  title: string | null;
  extraMatchedPrks?: string[];
  aiIdentityCheck?: AIIdentityCheckMeta | null;
  matchScore?: number;
  matchExplanation?: string;
  challenged?: boolean;
  rejectedAll?: boolean;
  transportError?: string;
} | null> {
  const cleanQuery = query.replace(/[\u200c\u200d]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleanQuery) return null;

  try {
    await politeDelay("api.torob.com", 150, 400);
    const params = new URLSearchParams({
      q: cleanQuery,
      page: "0",
      size: "24",
      source: "next_desktop",
    });
    const res = await torobTransportGet(
      "api",
      `/v4/base-product/search/?${params.toString()}`,
      browserHeaders("https://torob.com/"),
    );
    if (looksLikeTorobChallenge(res.status, res.contentType, res.bodyText)) {
      return { prk: null, detailsUrl: null, title: null, challenged: true };
    }
    if (!res.ok) {
      return {
        prk: null,
        detailsUrl: null,
        title: null,
        transportError: res.error || `HTTP ${res.status}`,
      };
    }
    const raw = JSON.parse(res.bodyText) as { results?: AnyRec[] };
    const rows = Array.isArray(raw.results) ? raw.results : [];
    if (!rows.length) return null;

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
        if (!prk) return null;
        const shopText = str(r.shop_text ?? "")
          .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
          .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
        const sellerCountMatch = shopText.match(/(\d+)/);
        const sellerCount =
          num(r.shop_count ?? r.sellers_count) ||
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
      .filter((x): x is NonNullable<typeof x> => !!x);

    const outcome = selectBestTorobSearchMatch(
      {
        productName: cleanQuery,
        sku: opts?.sku,
        anchorPriceToman: opts?.anchorPriceToman,
        rejectBelowPct: opts?.matchConfig?.rejectBelowPct,
        approveAbovePct: opts?.matchConfig?.approveAbovePct,
      },
      candidates,
      opts?.matchConfig?.minSellerCount ?? 1,
    );

    let aiIdentityCheck: AIIdentityCheckMeta | null = null;
    const nonRejectedCount = outcome.allRanked.filter((x) => !x.rejected).length;
    if (
      opts?.matchConfig?.aiIdentityEnabled !== false &&
      candidates.length > 0 &&
      (!outcome.confident || nonRejectedCount > 1) &&
      (await aiEnabled())
    ) {
      const aiRes = await verifyTorobMatchesWithAI({
        productName: cleanQuery,
        sku: opts?.sku,
        category: opts?.category,
        anchorPriceToman: opts?.anchorPriceToman,
        candidates: outcome.allRanked.slice(0, 10).map((r) => ({
          prk: r.candidate.prk,
          titleFa: r.candidate.titleFa,
          titleEn: r.candidate.titleEn,
          sellerCount: r.candidate.sellerCount,
          priceToman: r.candidate.priceToman,
          available: r.candidate.available,
        })),
      });
      if (aiRes) {
        aiIdentityCheck = aiRes;
        if (aiRes.verdict === "no_match") {
          return {
            prk: null,
            detailsUrl: null,
            title: null,
            aiIdentityCheck,
            rejectedAll: true,
            matchExplanation: `هوش مصنوعی هیچ پنل ادغام مرتبطی در ترب پیدا نکرد: ${aiRes.reasoning}`,
          };
        }
        if (aiRes.verdict === "match" && aiRes.primaryPrk) {
          const picked = candidates.find((c) => c.prk === aiRes.primaryPrk);
          if (picked) {
            const extraMatchedPrks = aiRes.matchedPrks
              .filter((id) => id !== picked.prk && candidates.some((c) => c.prk === id))
              .slice(0, 2);
            return {
              prk: picked.prk,
              detailsUrl: picked.detailsUrl ?? null,
              title: picked.titleFa || null,
              extraMatchedPrks,
              aiIdentityCheck,
              matchScore: outcome.allRanked.find((x) => x.candidate.prk === picked.prk)?.score ?? outcome.best?.score ?? 85,
              matchExplanation: `تطبیق پنل ادغام با هوش مصنوعی (${1 + extraMatchedPrks.length} پنل): ${aiRes.reasoning}`,
            };
          }
        }
      }
    }

    if (!outcome.best) {
      return {
        prk: null,
        detailsUrl: null,
        title: null,
        aiIdentityCheck,
        rejectedAll: true,
        matchExplanation: outcome.explanation,
      };
    }

    return {
      prk: outcome.best.candidate.prk,
      detailsUrl: outcome.best.candidate.detailsUrl ?? null,
      title: outcome.best.candidate.titleFa || null,
      aiIdentityCheck,
      matchScore: outcome.best.score,
      matchExplanation: outcome.explanation,
    };
  } catch (e) {
    return {
      prk: null,
      detailsUrl: null,
      title: null,
      transportError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchTorobPriceTrendV4(prk: string): Promise<MarketPriceTrend | null> {
  try {
    const res = await torobTransportGet(
      "api",
      `/v4/base-product/price-chart/?prk=${encodeURIComponent(prk)}`,
      browserHeaders(`https://torob.com/p/${prk}/`),
      { retries: 0, timeoutMs: 4000 },
    );
    if (!res.ok) return null;
    const raw = JSON.parse(res.bodyText) as {
      labels?: unknown[];
      dataSets?: { label?: string; entries?: { i?: number; val?: number }[] }[];
    };
    const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => str(l)) : [];
    const series = (raw.dataSets ?? []).map((ds) => ({
      label: str(ds.label),
      points: (ds.entries ?? [])
        .filter((e) => typeof e.i === "number" && typeof e.val === "number")
        .map((e) => ({ date: labels[e.i!] ?? "", value: Math.round(e.val!) })),
    }));
    return analyzeMcpPriceHistory({ series });
  } catch {
    return null;
  }
}

function extractNextData(html: string): AnyRec | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as AnyRec;
  } catch {
    return null;
  }
}

function findDetailsInNextData(nd: AnyRec): AnyRec | null {
  const stack: unknown[] = [nd];
  let guard = 0;
  while (stack.length && guard++ < 5000) {
    const cur = stack.pop();
    if (cur && typeof cur === "object") {
      const rec = cur as AnyRec;
      if (rec.products_info && typeof rec.products_info === "object") return rec;
      for (const v of Object.values(rec)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

export const torobAdapter: PriceSourceAdapter = {
  id: "torob",
  label: "ترب (مجهز به Torob MCP)",
  async fetchOffers(product: SourceProduct): Promise<SourceResult> {
    const fetchedAt = new Date();
    let prk = extractPrk(product.torobUrl, product.torobPrk);
    let detailsUrl = product.torobDetailsUrl ?? null;
    const anchorPriceToman =
      product.currentFinalPrice && product.currentFinalPrice > 0
        ? product.currentFinalPrice
        : product.costPrice > 0
          ? product.costPrice
          : null;

    const diagnostics: string[] = [];

    // --- لایه ۰: اتصال به سرور Torob MCP در صورت تنظیم متغیر محیطی TOROB_MCP_URL
    const mcpUrl = process.env.TOROB_MCP_URL?.trim();
    if (mcpUrl) {
      await syncTorobRelayToMcp().catch(() => undefined);
      const mcpResult = await fetchViaTorobMcpServer({
        mcpUrl,
        prk,
        detailsUrl,
        productName: product.name,
        sku: product.sku,
        category: product.category,
        anchorPriceToman,
        matchConfig: product.matchConfig,
        now: fetchedAt,
      });
      if (mcpResult) {
        if (mcpResult.ok || mcpResult.meta?.challenged || mcpResult.meta?.rejectedInSearch) {
          return mcpResult;
        }
        if (mcpResult.error) diagnostics.push(`MCP: ${mcpResult.error}`);
      }
    }

    // --- لایه ۱: موتور مستقیم Torob API v4 با تطبیق هویت ۷ لایه
    // نکته مهم: وقتی prk از روی torobUrl یا torobPrk از قبل مشخص است، حتی بدون detailsUrl نباید دوباره جستجوی عنوانی زد
    let matchMeta: Record<string, unknown> = {};
    let extraMatchedPrks: string[] = [];
    if (!prk && product.name) {
      const discovered = await searchTorobProductV4(product.name, prk, {
        sku: product.sku,
        category: product.category,
        anchorPriceToman,
        matchConfig: product.matchConfig,
      });
      if (discovered?.challenged) {
        return {
          source: "torob",
          prk,
          offers: [],
          totalSellerCount: 0,
          fetchedAt,
          ok: false,
          error:
            "ترب درخواست را با چالش امنیتی (HTTP 490 / arCAPTCHA) متوقف کرد. برای استعلام از سرور خارج از کشور، آدرس Relay/Worker ایرانی را در TOROB_API_BASE تنظیم کنید.",
          meta: { challenged: true, ...(diagnostics.length ? { diagnostics } : {}) },
        };
      }
      if (discovered?.transportError) {
        diagnostics.push(`جستجوی مستقیم ترب: ${discovered.transportError}`);
      }
      if (discovered?.rejectedAll) {
        const diagSuffix = diagnostics.length ? ` (${diagnostics.join(" | ")})` : "";
        return {
          source: "torob",
          prk,
          offers: [],
          totalSellerCount: 0,
          fetchedAt,
          ok: false,
          error:
            (discovered.matchExplanation ?? "هیچ کارتی در ترب با مشخصات و کد مدل محصول مطابقت نداشت") + diagSuffix,
          meta: {
            ...(discovered.aiIdentityCheck ? { aiIdentityCheck: discovered.aiIdentityCheck } : {}),
            ...(diagnostics.length ? { diagnostics } : {}),
          },
        };
      }
      if (discovered && discovered.prk) {
        prk = prk ?? discovered.prk;
        detailsUrl = detailsUrl ?? discovered.detailsUrl;
        extraMatchedPrks = discovered.extraMatchedPrks ?? [];
        matchMeta = {
          matchScore: discovered.matchScore,
          matchExplanation: discovered.matchExplanation,
          ...(discovered.aiIdentityCheck ? { aiIdentityCheck: discovered.aiIdentityCheck } : {}),
        };
      }
    }

    if (!prk) {
      const diagSuffix = diagnostics.length ? ` | جزئیات فنی: ${diagnostics.join(" | ")}` : "";
      return {
        source: "torob",
        offers: [],
        totalSellerCount: 0,
        fetchedAt,
        ok: false,
        error: `شناسه/لینک ترب (prk) تعریف نشده و جستجوی خودکار نتیجه‌ای نداد${diagSuffix}`,
        meta: diagnostics.length ? { diagnostics } : undefined,
      };
    }

    const pageUrl = product.torobUrl ?? `https://torob.com/p/${prk}/`;
    const apiPath = (() => {
      if (detailsUrl && detailsUrl.startsWith("http")) {
        const m = detailsUrl.match(/^https?:\/\/api\.torob\.com(\/.*)$/);
        if (m) return m[1];
      }
      return `/v4/base-product/details/?prk=${encodeURIComponent(prk)}&source=next_desktop`;
    })();

    try {
      await politeDelay("api.torob.com", 150, 400);
      const res = await torobTransportGet("api", apiPath, browserHeaders(pageUrl));

      if (looksLikeTorobChallenge(res.status, res.contentType, res.bodyText)) {
        return {
          source: "torob",
          prk,
          offers: [],
          totalSellerCount: 0,
          fetchedAt,
          ok: false,
          error:
            "ترب درخواست را با چالش امنیتی (HTTP 490 / arCAPTCHA) متوقف کرد. برای رفع آن رله ایران را در تنظیمات پنل پیکربندی کنید.",
          meta: { challenged: true, ...(diagnostics.length ? { diagnostics } : {}) },
        };
      }

      if (res.ok) {
        const json = JSON.parse(res.bodyText) as AnyRec;
        const parsed = parseTorobJson(json, fetchedAt);
        if (parsed.offers.length) {
          const panelList = [
            {
              prk: parsed.prk ?? prk,
              offers: parsed.offers,
              totalSellerCount: parsed.total,
              inPersonSellerCount: parsed.inPersonCount,
              offersTruncated: false,
              onlineOfferCount: parsed.offers.filter((o) => o.sellerType !== "in_person").length,
            },
          ];
          const mergedPanelPrks = [parsed.prk ?? prk];
          for (const extraPrk of extraMatchedPrks) {
            try {
              await politeDelay("api.torob.com", 120, 300);
              const extraRes = await torobTransportGet(
                "api",
                `/v4/base-product/details/?prk=${encodeURIComponent(extraPrk)}&source=next_desktop`,
                browserHeaders(`https://torob.com/p/${extraPrk}/`),
              );
              if (extraRes.ok) {
                const extraJson = JSON.parse(extraRes.bodyText) as AnyRec;
                const extraParsed = parseTorobJson(extraJson, fetchedAt);
                if (extraParsed.offers.length) {
                  panelList.push({
                    prk: extraParsed.prk ?? extraPrk,
                    offers: extraParsed.offers,
                    totalSellerCount: extraParsed.total,
                    inPersonSellerCount: extraParsed.inPersonCount,
                    offersTruncated: false,
                    onlineOfferCount: extraParsed.offers.filter((o) => o.sellerType !== "in_person").length,
                  });
                  mergedPanelPrks.push(extraParsed.prk ?? extraPrk);
                }
              }
            } catch {
              // ادامه با پنل اصلی
            }
          }
          const merged = mergeTorobPanelOffers(panelList);
          const priceTrend = await fetchTorobPriceTrendV4(prk);
          return {
            source: "torob",
            productTitle: parsed.title ?? undefined,
            prk: parsed.prk ?? prk,
            detailsUrl: detailsUrl ?? `https://api.torob.com${apiPath}`,
            offers: merged.offers,
            totalSellerCount: merged.totalSellerCount,
            inPersonSellerCount: merged.inPersonSellerCount,
            priceTrend,
            fetchedAt,
            ok: true,
            meta: {
              via: detailsUrl ? "torob_v4_details_url" : "torob_v4_api",
              ...matchMeta,
              ...(mergedPanelPrks.length > 1 ? { mergedPanelPrks } : {}),
            },
          };
        }
        diagnostics.push("API v4 ترب: لیست فروشندگان در پاسخ ترب خالی است");
      } else {
        diagnostics.push(`API v4 ترب: ${res.error || `HTTP ${res.status}`}`);
      }
    } catch (e) {
      diagnostics.push(`API v4 ترب: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- لایه ۲: HTML صفحه + __NEXT_DATA__
    let html = "";
    try {
      await politeDelay("torob.com", 150, 400);
      const sitePath = `/p/${encodeURIComponent(prk)}/`;
      const res = await torobTransportGet(
        "site",
        sitePath,
        {
          ...browserHeaders(),
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
        },
        { retries: 0, timeoutMs: 5000 },
      );
      html = res.bodyText;
      if (looksLikeTorobChallenge(res.status, res.contentType, html)) {
        return {
          source: "torob",
          prk,
          offers: [],
          totalSellerCount: 0,
          fetchedAt,
          ok: false,
          error:
            "ترب درخواست صفحه محصول را با چالش امنیتی (HTTP 490 / arCAPTCHA) متوقف کرد. برای رفع آن رله ایران را در تنظیمات پنل پیکربندی کنید.",
          meta: { challenged: true, ...(diagnostics.length ? { diagnostics } : {}) },
        };
      }
      if (res.ok) {
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
          diagnostics.push("HTML ترب: هیچ فروشنده‌ای در __NEXT_DATA__ یافت نشد");
        } else {
          diagnostics.push("HTML ترب: ساختار __NEXT_DATA__ یافت نشد");
        }
      } else {
        diagnostics.push(`HTML ترب: ${res.error || `HTTP ${res.status}`}`);
      }
    } catch (e) {
      diagnostics.push(`HTML ترب: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- لایه ۳: استخراج با هوش مصنوعی از HTML
    if (html && !looksLikeTorobChallenge(200, "text/html", html)) {
      const ai = await extractOffersWithAI(html, product.name);
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

    const diagSuffix = diagnostics.length ? ` (${diagnostics.join(" | ")})` : "";
    return {
      source: "torob",
      prk,
      offers: [],
      totalSellerCount: 0,
      fetchedAt,
      ok: false,
      error: `دسترسی به ترب ممکن نشد${diagSuffix}. می‌توانید رله ایران یا TOROB_API_BASE را در تنظیمات بررسی کنید.`,
      meta: diagnostics.length ? { diagnostics } : undefined,
    };
  },
};
