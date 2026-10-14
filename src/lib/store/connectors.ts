import { db } from "@/db";
import { storeConnectors, type StoreConnector } from "@/db/schema";
import { eq } from "drizzle-orm";

/** payload استاندارد که به فروشگاه ارسال می‌شود */
export interface PricePushPayload {
  productId: number;
  sku: string;
  storeExternalId?: string | null;
  basePrice: number; // قیمت اصلی (regular)
  finalPrice: number; // قیمت با تخفیف (sale)
  discountPct: number;
  campaignType: string; // flash | featured | none
  campaignEndsAt?: string | null;
  decisionId: number;
  confidence: number;
}

export interface StoreConnectorAdapter {
  type: string;
  push(cfg: Record<string, string>, payload: PricePushPayload): Promise<{ ok: boolean; message: string }>;
}

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

const adapters: Record<string, StoreConnectorAdapter> = { woocommerce, webhook };

export async function getActiveConnector(): Promise<StoreConnector | null> {
  const rows = await db.select().from(storeConnectors).where(eq(storeConnectors.active, true)).limit(1);
  return rows[0] ?? null;
}

export async function pushToStore(payload: PricePushPayload): Promise<{ ok: boolean; message: string; skipped?: boolean }> {
  const connector = await getActiveConnector();
  if (!connector || connector.type === "none") return { ok: true, skipped: true, message: "کانکتور فروشگاه فعال نیست (فقط ثبت داخلی)" };
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
