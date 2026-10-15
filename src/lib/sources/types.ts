import type { SourceResult, SupplierQuote } from "@/lib/pricing/types";

export interface SourceProduct {
  id: number;
  sku?: string | null;
  name: string;
  sourceType: string;
  torobUrl?: string | null;
  torobPrk?: string | null;
  torobDetailsUrl?: string | null;
  costPrice: number;
  supplierQuotes?: SupplierQuote[];
  currentFinalPrice?: number | null;
}

/** اینترفیس آداپتور منبع قیمت — هر منبع جدید (ترب MCP، دیجی‌کالا، ایمالز، ...) فقط این را پیاده می‌کند */
export interface PriceSourceAdapter {
  readonly id: string;
  readonly label: string;
  fetchOffers(product: SourceProduct): Promise<SourceResult>;
}
