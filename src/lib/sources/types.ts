import type { SourceResult, SupplierQuote, TorobLinkConfirmation } from "@/lib/pricing/types";

export interface SourceMatchConfig {
  rejectBelowPct?: number;
  approveAbovePct?: number;
  minSellerCount?: number;
  aiIdentityEnabled?: boolean;
}

export interface SourceProduct {
  id: number;
  sku?: string | null;
  name: string;
  category?: string | null;
  sourceType: string;
  torobUrl?: string | null;
  torobPrk?: string | null;
  torobDetailsUrl?: string | null;
  torobLinkConfirmation?: TorobLinkConfirmation | null;
  costPrice: number;
  supplierQuotes?: SupplierQuote[];
  currentFinalPrice?: number | null;
  matchConfig?: SourceMatchConfig;
}

/** اینترفیس آداپتور منبع قیمت — هر منبع جدید (ترب MCP، دیجی‌کالا، ایمالز، ...) فقط این را پیاده می‌کند */
export interface PriceSourceAdapter {
  readonly id: string;
  readonly label: string;
  fetchOffers(product: SourceProduct): Promise<SourceResult>;
}
