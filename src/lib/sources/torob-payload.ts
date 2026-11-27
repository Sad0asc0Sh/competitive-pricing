import type { IdentitySpec } from "@/lib/pricing/match/parse";
import { normalizeText, toAsciiDigits } from "@/lib/pricing/match/text";
import type { TorobCandidateCard } from "@/lib/pricing/matcher";
import { parsePriceToToman } from "@/lib/pricing/sourcing";
import type { RawOffer } from "@/lib/pricing/types";

export type TorobRecord = Record<string, unknown>;

export function record(value: unknown): TorobRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as TorobRecord : null;
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 320);
  }
  return null;
}

const FA_TITLE_FIELDS = ["name_fa", "name1", "title_fa", "product_title", "title", "name"];
const EN_TITLE_FIELDS = ["name_en", "name2", "title_en"];
const TITLE_FIELD = /^(?:name\d*|title\d*|(?:display|product|base_product|card|listing)[_-]?(?:name|title)|(?:name|title)[_-]?(?:fa|en|persian|english))$/i;

export function readTorobTitles(row: TorobRecord) {
  const titleFor = (keys: string[]) => keys.map((key) => firstText(row[key])).find((value) => normalizeText(value)) ?? null;
  const titleFa = titleFor(FA_TITLE_FIELDS);
  const titleEn = titleFor(EN_TITLE_FIELDS);
  const fields = Object.keys(row).filter((key) => {
    if (!TITLE_FIELD.test(key)) return false;
    const value = row[key];
    return value != null && (typeof value !== "string" || value.trim() !== "");
  });
  const upstreamFields = Array.isArray(row.title_source_fields)
    ? row.title_source_fields.filter((key): key is string => typeof key === "string" && key.length <= 40 && TITLE_FIELD.test(key)) : [];
  const sourceFields = [...new Set([...fields, ...upstreamFields])].slice(0, 12);
  return { titleFa, titleEn, titleEvidence: { fields: sourceFields, parsed: Boolean(normalizeText(titleFa) || normalizeText(titleEn)) } };
}

export function cleanPrk(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-z0-9_-]{1,128}$/i.test(trimmed)) return null;
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function prkFromTorobUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, "https://torob.com");
    if (!["https:", "http:"].includes(url.protocol) || !["torob.com", "www.torob.com"].includes(url.host) ||
        url.username || url.password) return null;
    return cleanPrk(url.pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1]);
  } catch {
    return null;
  }
}

export function torobProductUrl(prk: string): string {
  return `https://torob.com/p/${encodeURIComponent(prk)}/`;
}

export function safeTorobDetailsUrl(value: unknown, prk: string, keepSearchContext = false): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, "https://api.torob.com");
    if (url.origin !== "https://api.torob.com" || url.username || url.password ||
        url.pathname !== "/v4/base-product/details/") return null;
    const ids = url.searchParams.getAll("prk");
    if (ids.length > 1 || (ids.length && cleanPrk(ids[0]) !== prk)) return null;
    const params = new URLSearchParams({ prk, source: "next_desktop" });
    const searchId = url.searchParams.get("search_id");
    if (keepSearchContext && searchId && /^[a-z0-9._~:-]{1,256}$/i.test(searchId)) params.set("search_id", searchId);
    return `https://api.torob.com/v4/base-product/details/?${params}`;
  } catch {
    return null;
  }
}

export function offerSourceUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      // Torob's purchase redirects carry tracking/session parameters and require the full query.
      if (url.hostname === "api.torob.com" && url.search) continue;
      return `${url.origin}${url.pathname}`;
    } catch {
      // Try the next public URL.
    }
  }
  return undefined;
}

export function torobStock(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const status = normalizeText(String(value)).replace(/_/g, " ");
  if (/^(?:0|false|out of stock|unavailable|ناموجود|موجود نیست)$/.test(status)) return false;
  if (/^(?:1|true|in stock|available|موجود)$/.test(status)) return true;
  return undefined;
}

export function torobPrice(value: unknown, unit?: unknown): number {
  const declared = typeof unit === "string" ? unit.trim() : "";
  const rial = /^(?:irr|rial|ریال|ريال|﷼)$/i;
  const toman = /^(?:irt|toman|tmn|تومان|تومن)$/i;
  const currency = rial.test(declared) ? "rial" : !declared || toman.test(declared) ? "toman" : null;
  if (typeof value === "string") {
    const match = /^([\d\s,٬.٫]+)\s*(.*)$/.exec(toAsciiDigits(value).trim());
    if (!match) return 0;
    const suffix = match[2].trim();
    const explicitCurrency = rial.test(suffix) ? "rial" : toman.test(suffix) ? "toman" : suffix ? null : currency;
    return explicitCurrency ? parsePriceToToman(match[1], explicitCurrency) : 0;
  }
  return currency && typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(currency === "rial" ? value / 10 : value) : 0;
}

export function countOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(toAsciiDigits(value.trim()))
    ? Number(toAsciiDigits(value.trim())) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function countSellerText(shopName: string | null): number | null {
  const count = /\d+(?=\s*(?:فروشگاه|فروشنده))/.exec(toAsciiDigits(shopName ?? ""));
  return count ? Number(count[0]) : null;
}

export function decodeTorobSearch(payload: unknown, limit: number): {
  rows: number | null;
  candidates: TorobCandidateCard[];
  issue?: string;
} {
  const envelope = record(payload);
  const data = record(envelope?.data) ?? envelope;
  const rows = data?.products ?? data?.results;
  if (!Array.isArray(rows)) return { rows: null, candidates: [], issue: "search_schema" };
  const candidates: TorobCandidateCard[] = [];
  let unmapped = 0;
  for (const row of rows.slice(0, limit)) {
    const r = record(row);
    const id = cleanPrk(r?.prk) ?? cleanPrk(r?.random_key) ?? cleanPrk(r?.product_prk);
    const urlId = prkFromTorobUrl(r?.url ?? r?.web_client_absolute_url ?? r?.product_page_url);
    const prk = id ?? urlId;
    if (!r || !prk || (id && urlId && id !== urlId)) {
      unmapped++;
      continue;
    }
    const titles = readTorobTitles(r);
    const shopName = firstText(r.shop_name, r.shop_text);
    candidates.push({
      prk,
      ...titles,
      titleFa: titles.titleFa ?? "",
      priceToman: torobPrice(r.price_toman) || torobPrice(r.price ?? r.price_text, r.currency ?? r.price_unit) || null,
      sellerCount: countOf(r.shop_count ?? r.sellers_count) ?? countSellerText(shopName),
      available: torobStock(r.available ?? r.availability ?? r.stock_status),
      detailsUrl: safeTorobDetailsUrl(r.details_url ?? r.more_info_url, prk, true),
      shopName,
    });
  }
  const upstreamRowCount = countOf(data?.page_count) ?? rows.length;
  if (Math.min(upstreamRowCount, limit) > rows.length) unmapped += Math.min(upstreamRowCount, limit) - rows.length;
  return { rows: Math.max(rows.length, upstreamRowCount), candidates, ...(unmapped ? { issue: "search_card_id_missing_or_conflicting" } : {}) };
}

export function readTorobSpecs(row: TorobRecord): IdentitySpec[] {
  const specs: IdentitySpec[] = [];
  const add = (key: unknown, value: unknown) => {
    const label = firstText(key);
    const text = typeof value === "number" ? String(value) : firstText(value);
    if (label && text && text.length <= 100 && specs.length < 80) specs.push({ key: label, value: text });
  };
  for (const collection of [row.specs, row.key_specs]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection.slice(0, 80)) {
      const spec = record(item);
      if (spec) add(spec.key ?? spec.title ?? spec.name, spec.value ?? spec.text);
    }
  }
  const headers = record(row.structural_specs)?.headers;
  if (Array.isArray(headers)) {
    for (const block of headers.slice(0, 20)) {
      const values = record(record(block)?.specs);
      if (values) for (const [key, value] of Object.entries(values).slice(0, 80)) add(key, value);
    }
  }
  return specs;
}

export interface TorobDetailsData {
  prk?: string | null;
  titleFa: string | null;
  titleEn: string | null;
  titleEvidence: TorobCandidateCard["titleEvidence"];
  specs: IdentitySpec[];
  offers: RawOffer[];
  sellerRows: number | null;
  totalSellerCount: number | null;
  inPersonSellerCount: number;
  onlineOfferCount: number;
  offersTruncated: boolean;
  detailsUrl?: string | null;
}
