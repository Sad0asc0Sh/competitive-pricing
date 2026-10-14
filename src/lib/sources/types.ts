import type { SourceResult } from "@/lib/pricing/types";

export interface SourceProduct {
  id: number;
  name: string;
  sourceType: string;
  torobUrl?: string | null;
  torobPrk?: string | null;
  costPrice: number;
  currentFinalPrice?: number | null;
}

/** اینترفیس آداپتور منبع قیمت — هر منبع جدید (دیجی‌کالا، ایمالز، ...) فقط این را پیاده می‌کند */
export interface PriceSourceAdapter {
  readonly id: string;
  readonly label: string;
  fetchOffers(product: SourceProduct): Promise<SourceResult>;
}
