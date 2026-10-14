import type { RawOffer, SourceResult } from "@/lib/pricing/types";
import { extractOffersWithAI } from "@/lib/ai/client";
import { browserHeaders, fetchWithRetry, politeDelay } from "./humanize";
import type { PriceSourceAdapter, SourceProduct } from "./types";

const TOROB_API = "https://api.torob.com/v4/base-product/details/";

/** استخراج prk از URL ترب: https://torob.com/p/<prk>/<slug>/ */
export function extractPrk(url?: string | null, prk?: string | null): string | null {
  if (prk && prk.trim()) return prk.trim();
  if (!url) return null;
  const m = url.match(/\/p\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

type AnyRec = Record<string, unknown>;

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

/** تبدیل یک آیتم فروشنده ترب به RawOffer — دفاعی نسبت به تغییر نام فیلدها */
export function normalizeTorobSeller(s: AnyRec): RawOffer | null {
  const price = num(s.price ?? s.price_value ?? s.min_price);
  const shopName = str(s.shop_name ?? s.shop_name2 ?? s.name2 ?? s.seller_name ?? "نامشخص");
  if (!price) return null;
  const changed = s.last_price_change_date ?? s.last_price_change ?? s.updated_at ?? s.price_updated_at;
  let lastChangedAt: Date | null = null;
  if (typeof changed === "string" || typeof changed === "number") {
    const d = new Date(changed);
    if (!Number.isNaN(d.getTime())) lastChangedAt = d;
  }
  const availability = str(s.availability ?? s.stock_status ?? "").toLowerCase();
  return {
    shopName,
    shopId: str(s.shop_id ?? s.shop_slug ?? ""),
    price,
    lastChangedAt,
    isAd: Boolean(s.is_adv ?? s.is_ad ?? s.sponsored ?? false),
    inStock: availability ? !["out_of_stock", "unavailable", "ناموجود"].includes(availability) : true,
    url: str(s.page_url ?? s.url ?? s.shop_url ?? ""),
  };
}

/** استخراج پیشنهادها از پاسخ JSON ترب (ساختار: products_info.result[] یا sellers[]) */
export function parseTorobJson(json: AnyRec): { offers: RawOffer[]; title?: string; total: number } {
  const pi = (json.products_info as AnyRec | undefined) ?? {};
  const candidates =
    (pi.result as AnyRec[] | undefined) ??
    (json.sellers as AnyRec[] | undefined) ??
    (json.products as AnyRec[] | undefined) ??
    (json.result as AnyRec[] | undefined) ??
    [];
  const offers = candidates.map(normalizeTorobSeller).filter((o): o is RawOffer => !!o);
  const total = num(json.shop_count ?? json.sellers_count ?? pi.count ?? json.count) || offers.length;
  const title = str(json.name1 ?? json.name ?? json.title ?? "") || undefined;
  return { offers, title, total: Math.max(total, offers.length) };
}

/** استخراج JSON از HTML صفحه (__NEXT_DATA__) */
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
  // جستجوی بازگشتی برای شیئی که products_info دارد
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
  label: "ترب",
  async fetchOffers(product: SourceProduct): Promise<SourceResult> {
    const prk = extractPrk(product.torobUrl, product.torobPrk);
    const fetchedAt = new Date();
    if (!prk) {
      return { source: "torob", offers: [], totalSellerCount: 0, fetchedAt, ok: false, error: "لینک/شناسه ترب (prk) تعریف نشده" };
    }
    const pageUrl = product.torobUrl ?? `https://torob.com/p/${prk}/`;

    // --- مرحله ۱: API عمومی JSON
    try {
      await politeDelay("api.torob.com");
      const url = `${TOROB_API}?prk=${encodeURIComponent(prk)}&source=next_desktop`;
      const res = await fetchWithRetry(url, { headers: browserHeaders(pageUrl) });
      if (res.ok) {
        const json = (await res.json()) as AnyRec;
        const parsed = parseTorobJson(json);
        if (parsed.offers.length) {
          return {
            source: "torob",
            productTitle: parsed.title,
            offers: parsed.offers,
            totalSellerCount: parsed.total,
            fetchedAt,
            ok: true,
            meta: { via: "api" },
          };
        }
      }
    } catch (e) {
      // ادامه به fallback
      void e;
    }

    // --- مرحله ۲: HTML صفحه + __NEXT_DATA__
    let html = "";
    try {
      await politeDelay("torob.com");
      const res = await fetchWithRetry(pageUrl, {
        headers: { ...browserHeaders(), Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate" },
      });
      html = await res.text();
      const nd = extractNextData(html);
      const details = nd ? findDetailsInNextData(nd) : null;
      if (details) {
        const parsed = parseTorobJson(details);
        if (parsed.offers.length) {
          return { source: "torob", productTitle: parsed.title, offers: parsed.offers, totalSellerCount: parsed.total, fetchedAt, ok: true, meta: { via: "html" } };
        }
      }
    } catch (e) {
      void e;
    }

    // --- مرحله ۳: استخراج با هوش مصنوعی از HTML (اگر کلید تنظیم شده باشد)
    if (html) {
      const ai = await extractOffersWithAI(html, product.name);
      if (ai && ai.offers.length) {
        return { source: "torob", productTitle: ai.title, offers: ai.offers, totalSellerCount: ai.totalSellerCount || ai.offers.length, fetchedAt, ok: true, meta: { via: "ai" } };
      }
    }

    return {
      source: "torob",
      offers: [],
      totalSellerCount: 0,
      fetchedAt,
      ok: false,
      error: "دسترسی به ترب ممکن نشد (مسدودسازی/تغییر ساختار). از ورود دستی یا مرورگر headless استفاده کنید.",
    };
  },
};
