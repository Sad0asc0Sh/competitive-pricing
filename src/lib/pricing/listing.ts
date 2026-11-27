import { compactShopKey } from "./own-shop";
import type { RawOffer } from "./types";

export interface ListingPanel {
  prk: string;
  sellerCount: number | null;
}

/** Prefer shop IDs. Avoid counting online and in-person rows for the same shop twice. */
export function distinctSellerCount(offers: RawOffer[]): number {
  const ids = new Set<string>();
  const namedIds = new Set<string>();
  const names = new Set<string>();
  for (const offer of offers) {
    const name = compactShopKey(offer.shopName);
    const id = compactShopKey(offer.shopId);
    if (id) {
      ids.add(id);
      if (name) namedIds.add(name);
    } else if (name) {
      names.add(name);
    }
  }
  return ids.size + [...names].filter((name) => !namedIds.has(name)).length;
}

export function listingPanel(prk: string, offers: RawOffer[], reported: number): ListingPanel {
  const observed = distinctSellerCount(offers);
  return { prk, sellerCount: reported > offers.length ? reported : observed || null };
}

/** Historical decisions may only contain the primary PRK and an aggregate seller count. */
export function decisionPanels(steps: { step: string; data?: Record<string, unknown> }[]): ListingPanel[] {
  const data = steps.find((s) => s.step === "source")?.data;
  if (!data || data.sourceStatus === "error" || data.sourceStatus === "challenged") return [];
  const found = new Map<string, ListingPanel>();
  function add(prk: unknown, count: unknown) {
    if (typeof prk !== "string" || !/^[a-zA-Z0-9_-]+$/.test(prk) || found.has(prk)) return;
    found.set(prk, { prk, sellerCount: typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : null });
  }
  if (Array.isArray(data.panels)) {
    for (const p of data.panels) if (p && typeof p === "object") add(p.prk, p.sellerCount);
  } else {
    const merged = steps.find((s) => s.step === "ai_identity")?.data?.mergedPanelPrks;
    add(data.prk, Array.isArray(merged) && merged.length > 1 ? null : data.totalSellerCount);
    if (Array.isArray(merged)) for (const prk of merged) add(prk, null);
  }
  return [...found.values()];
}
