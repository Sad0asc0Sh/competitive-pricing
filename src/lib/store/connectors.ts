import { db } from "@/db";
import { storeConnectors, type StoreConnector } from "@/db/schema";
import type { SgeoooleBadgeTheme, SgeoooleCampaignType } from "@/lib/pricing/types";
import { eq } from "drizzle-orm";

/** payload استاندارد که به فروشگاه ارسال می‌شود */
export interface PricePushPayload {
  productId: number;
  sku: string;
  storeExternalId?: string | null;
  /** قیمت خرید/تامین نهایی از لیست همکاران */
  effectiveCostPrice?: number;
  /** خط قرمز کف قیمت فروش (تومان) */
  hardFloorPrice?: number;
  /** سقف واقعی بازار که معیار تخفیف قرار گرفته است */
  monitoredMarketCeiling?: number | null;
  basePrice: number; // قیمت سقف معیار (regular / compareAtPrice)
  finalPrice: number; // قیمت کف قطعی فروش (sale / current_price در فید ترب)
  discountPct: number; // درصد تخفیف صحیح (1..99)
  campaignType: SgeoooleCampaignType | string; // flash | featured | timed_sale | none
  campaignName?: string | null;
  badgeTheme?: SgeoooleBadgeTheme | string | null;
  showInFeatured?: boolean | null;
  campaignEndsAt?: string | null;
  decisionId: number;
  confidence: number;
  projectedNationalRank?: number | null;
  projectedLocalRank?: number | null;
  competitionTier?: string | null;
}

export interface StoreConnectorAdapter {
  type: string;
  push(cfg: Record<string, string>, payload: PricePushPayload): Promise<{ ok: boolean; message: string }>;
}

/**
 * کانکتور اختصاصی فروشگاه sgeooole (`ekgkala-backend`):
 * پشتیبانی کامل و بدون تداخل از هر ۳ سیستم تخفیف `sgeooole`:
 *  1. `flash` («پیشنهاد لحظه‌ای» در صفحه اصلی):
 *     - `Product.isFlashDeal = true`, `Product.isSpecialOffer = false`
 *     - حذف خودکار محصول از کمپین‌های `Sale` فعال برای جلوگیری از خطای `409 CAMPAIGN_CONFLICT`
 *  2. `featured` («پیشنهاد شگفت‌انگیز» در صفحه اصلی):
 *     - `Product.isSpecialOffer = true`, `Product.isFlashDeal = false`
 *     - حذف خودکار محصول از کمپین‌های `Sale` فعال برای جلوگیری از خطای `409 CAMPAIGN_CONFLICT`
 *  3. `timed_sale` («مدیریت فرصت‌های زمان‌دار» در بخش مالی و تخفیف پنل مدیریت — مدل `Sale`):
 *     - ساخت یا بروزرسانی خودکار سند `Sale` در بخش مالی و تخفیف با `name`, `discountPercentage`, `badgeTheme` (`green-orange` | `gold-red` | `red-purple`) و `showInFeatured` (نمایش در بخش منتخب‌های صفحه اصلی)
 *     - تنظیم `Product.price = basePrice (سقف معیار)` و خاموش کردن `isFlashDeal` / `isSpecialOffer` و `discount = 0` روی خود `Product` تا تخفیف دقیقاً از طریق کمپین `Sale` روی کف اعمال شود!
 */
export function buildSgeoooleRequestPayload(p: PricePushPayload) {
  const intDiscountPct =
    p.discountPct > 0 && p.basePrice > p.finalPrice
      ? Math.max(1, Math.min(99, Math.round(p.discountPct)))
      : 0;

  const isFlash = p.campaignType === "flash" && intDiscountPct > 0;
  const isSpecial = p.campaignType === "featured" && intDiscountPct > 0;
  const isTimedSale = p.campaignType === "timed_sale" && intDiscountPct > 0;
  const hasDirectProductPromo = isFlash || isSpecial;
  const hasAnyPromo = hasDirectProductPromo || isTimedSale;

  const defaultHours = isFlash ? 12 : isSpecial ? 48 : 72;
  const endIso = p.campaignEndsAt ?? new Date(Date.now() + defaultHours * 3600 * 1000).toISOString();
  const badgeTheme: SgeoooleBadgeTheme =
    (p.badgeTheme as SgeoooleBadgeTheme) ||
    (isFlash ? "gold-red" : isSpecial ? "red-purple" : "green-orange");

  return {
    sku: p.sku,
    productCode: p.storeExternalId?.toUpperCase().startsWith("KY-") ? p.storeExternalId.toUpperCase() : undefined,
    productId: p.storeExternalId && !p.storeExternalId.toUpperCase().startsWith("KY-") ? p.storeExternalId : undefined,
    // فیلدهای استاندارد مدل Product در sgeooole:
    // نکته کلیدی: در timed_sale قیمت پایه روی Product برابر سقف معیار (basePrice) قرار می‌گیرد و تخفیف از طریق مدل Sale اعمال می‌شود
    price: hasAnyPromo ? p.basePrice : p.finalPrice,
    compareAtPrice: hasDirectProductPromo ? p.basePrice : null,
    discount: hasDirectProductPromo ? intDiscountPct : 0,
    isFlashDeal: isFlash,
    flashDealEndTime: isFlash ? endIso : null,
    isSpecialOffer: isSpecial,
    specialOfferEndTime: isSpecial ? endIso : null,
    // اطلاعات کامل سیستم تخفیف برای هماهنگی هر ۳ موتور در بک‌اند sgeooole
    campaignType: hasAnyPromo ? p.campaignType : "none",
    timedSale: isTimedSale
      ? {
          enabled: true,
          name: p.campaignName || "فروش ویژه هوشمند",
          discountPercentage: intDiscountPct,
          endDate: endIso,
          badgeTheme,
          showInFeatured: p.showInFeatured ?? true,
        }
      : {
          enabled: false,
        },
    // فیلدهای تکمیلی قیمت‌گذاری رقابتی، سقف و کف بازار و تامین همکاران
    finalPrice: p.finalPrice,
    basePrice: p.basePrice,
    monitoredMarketCeiling: p.monitoredMarketCeiling ?? p.basePrice,
    costPrice: p.effectiveCostPrice ?? 0,
    hardFloorPrice: p.hardFloorPrice ?? 0,
    pricingMeta: {
      decisionId: p.decisionId,
      confidence: p.confidence,
      projectedNationalRank: p.projectedNationalRank ?? null,
      projectedLocalRank: p.projectedLocalRank ?? null,
      competitionTier: p.competitionTier ?? null,
      campaignType: hasAnyPromo ? p.campaignType : "none",
      campaignName: p.campaignName ?? null,
      badgeTheme,
      showInFeatured: p.showInFeatured ?? (isSpecial || isTimedSale),
      updatedAt: new Date().toISOString(),
    },
    rebuildTorobFeed: true,
  };
}

const sgeooole: StoreConnectorAdapter = {
  type: "sgeooole",
  async push(cfg, p) {
    // حفاظت نهایی قبل از ارسال به سایت: هرگز قیمت فروش <= قیمت خرید نباشد
    if (p.effectiveCostPrice && p.effectiveCostPrice > 0 && p.finalPrice <= p.effectiveCostPrice) {
      return {
        ok: false,
        message: `مسدود شد: قیمت نهایی (${p.finalPrice}) کمتر یا مساوی قیمت خرید/تامین (${p.effectiveCostPrice}) است!`,
      };
    }

    const baseUrl = (cfg.baseUrl ?? process.env.SGEOOOLE_API_URL ?? "").replace(/\/$/, "");
    const apiKey = cfg.apiKey ?? process.env.SGEOOOLE_PRICING_SECRET ?? process.env.STORE_WEBHOOK_SECRET ?? "";
    const bearerToken = cfg.adminToken ?? process.env.SGEOOOLE_ADMIN_TOKEN ?? "";

    if (!baseUrl) {
      return { ok: false, message: "آدرس سرور sgeooole (baseUrl / SGEOOOLE_API_URL) تنظیم نشده است" };
    }

    const bodyPayload = buildSgeoooleRequestPayload(p);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Pricing-Secret": apiKey } : {}),
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    };

    // ۱) تلاش برای ارسال به اندپوینت اختصاصی همگام‌سازی قیمت و هر ۳ سیستم تخفیف در sgeooole
    const syncUrl = `${baseUrl}/api/products/pricing-sync`;
    const res = await fetch(syncUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      cache: "no-store",
    });

    if (res.ok) {
      return {
        ok: true,
        message: `sgeooole: محصول ${p.sku} بروزرسانی شد (سقف معیار: ${p.basePrice.toLocaleString("fa-IR")} با ${p.discountPct}% تخفیف → کف قطعی: ${p.finalPrice.toLocaleString("fa-IR")} تومان | کمپین: ${p.campaignType})`,
      };
    }

    // ۲) اگر اندپوینت اختصاصی نبود و storeExternalId (MongoDB _id) داشتیم، با PUT /api/products/:id بروزرسانی کن
    if (res.status === 404 && p.storeExternalId && /^[a-fA-F0-9]{24}$/.test(p.storeExternalId)) {
      const putRes = await fetch(`${baseUrl}/api/products/${p.storeExternalId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(bodyPayload),
        cache: "no-store",
      });
      if (putRes.ok) {
        return {
          ok: true,
          message: `sgeooole (PUT): محصول ${p.storeExternalId} بروزرسانی شد`,
        };
      }
      return { ok: false, message: `sgeooole PUT HTTP ${putRes.status}` };
    }

    const errText = await res.text().catch(() => "");
    return { ok: false, message: `sgeooole HTTP ${res.status}${errText ? ` — ${errText.slice(0, 300)}` : ""}` };
  },
};

/** ووکامرس: PUT /wp-json/wc/v3/products/{id} */
const woocommerce: StoreConnectorAdapter = {
  type: "woocommerce",
  async push(cfg, p) {
    const base = (cfg.baseUrl ?? process.env.WC_BASE_URL ?? "").replace(/\/$/, "");
    const key = cfg.consumerKey ?? process.env.WC_CONSUMER_KEY ?? "";
    const secret = cfg.consumerSecret ?? process.env.WC_CONSUMER_SECRET ?? "";
    if (!base || !key || !secret) return { ok: false, message: "تنظیمات ووکامرس ناقص است (baseUrl/consumerKey/consumerSecret)" };
    if (!p.storeExternalId) return { ok: false, message: "شناسه محصول در فروشگاه (storeExternalId) خالی است" };
    const auth = Buffer.from(`${key}:${secret}`).toString("base64");
    const body = {
      regular_price: String(p.basePrice),
      sale_price: String(p.finalPrice),
      date_on_sale_to: p.campaignEndsAt ?? null,
      meta_data: [
        { key: "_pricing_campaign", value: p.campaignType },
        { key: "_pricing_decision_id", value: String(p.decisionId) },
        { key: "_pricing_confidence", value: String(p.confidence) },
      ],
    };
    const res = await fetch(`${base}/wp-json/wc/v3/products/${p.storeExternalId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return res.ok ? { ok: true, message: `ووکامرس: محصول ${p.storeExternalId} بروزرسانی شد` } : { ok: false, message: `ووکامرس HTTP ${res.status}` };
  },
};

/** وب‌هوک عمومی: POST JSON با هدر امضا */
const webhook: StoreConnectorAdapter = {
  type: "webhook",
  async push(cfg, p) {
    const url = cfg.url ?? process.env.STORE_WEBHOOK_URL ?? "";
    const secret = cfg.secret ?? process.env.STORE_WEBHOOK_SECRET ?? "";
    if (!url) return { ok: false, message: "آدرس وب‌هوک تنظیم نشده" };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pricing-Secret": secret },
      body: JSON.stringify({ event: "price.updated", data: p, sentAt: new Date().toISOString() }),
      cache: "no-store",
    });
    return res.ok ? { ok: true, message: `وب‌هوک: ${res.status}` } : { ok: false, message: `وب‌هوک HTTP ${res.status}` };
  },
};

const adapters: Record<string, StoreConnectorAdapter> = { sgeooole, woocommerce, webhook };

export async function getActiveConnector(): Promise<StoreConnector | null> {
  const rows = await db.select().from(storeConnectors).where(eq(storeConnectors.active, true)).limit(1);
  return rows[0] ?? null;
}

/** وضعیت اتصال فروشگاه برای داشبورد و /api/health (بدون افشای سکرت) */
export async function getStoreStatus(): Promise<{
  activeType: string | null;
  activeName: string | null;
  envFallback: boolean;
  baseUrl: string;
  lastError: string | null;
}> {
  try {
    const active = await getActiveConnector();
    if (active && active.type !== "none") {
      return {
        activeType: active.type,
        activeName: active.name,
        envFallback: false,
        baseUrl: active.type === "sgeooole" ? String(active.config?.baseUrl ?? "") : "",
        lastError: active.lastError ?? null,
      };
    }
  } catch {
    // ادامه به بررسی env
  }
  const envBase = (process.env.SGEOOOLE_API_URL ?? "").replace(/\/$/, "");
  const envKey = (process.env.SGEOOOLE_PRICING_SECRET ?? "").trim();
  return {
    activeType: null,
    activeName: null,
    envFallback: Boolean(envBase && envKey),
    baseUrl: envBase,
    lastError: null,
  };
}

export async function pushToStore(payload: PricePushPayload): Promise<{ ok: boolean; message: string; skipped?: boolean }> {
  const connector = await getActiveConnector();
  if (connector && connector.type !== "none") {
    const adapter = adapters[connector.type];
    if (!adapter) return { ok: false, message: `کانکتور ناشناخته: ${connector.type}` };
    try {
      const r = await adapter.push(connector.config, payload);
      await db
        .update(storeConnectors)
        .set({ lastPushAt: new Date(), lastError: r.ok ? null : r.message })
        .where(eq(storeConnectors.id, connector.id));
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(storeConnectors).set({ lastError: msg }).where(eq(storeConnectors.id, connector.id));
      return { ok: false, message: msg };
    }
  }
  // سیستم واقعی بدون داده ساختگی: اگر کانکتوری در دیتابیس فعال نیست ولی
  // متغیرهای محیطی فروشگاه (SGEOOOLE_API_URL + SGEOOOLE_PRICING_SECRET) تنظیم‌اند،
  // مستقیم از env به sgeooole پوش کن تا قیمت‌ها واقعاً به سایت برسند.
  const envBase = (process.env.SGEOOOLE_API_URL ?? "").trim();
  const envKey = (process.env.SGEOOOLE_PRICING_SECRET ?? process.env.STORE_WEBHOOK_SECRET ?? "").trim();
  if (envBase && envKey) {
    try {
      const r = await sgeooole.push({ baseUrl: envBase, apiKey: envKey }, payload);
      return r.ok
        ? { ...r, message: `${r.message} (via env fallback)` }
        : r;
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true, skipped: true, message: "کانکتور فروشگاه فعال نیست و SGEOOOLE_API_URL تنظیم نشده (فقط ثبت داخلی)" };
}
