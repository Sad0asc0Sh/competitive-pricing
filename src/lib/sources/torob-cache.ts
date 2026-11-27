import type { TorobCandidateCard } from "@/lib/pricing/matcher";
import type { MarketPriceTrend } from "@/lib/pricing/types";
import type { TorobDetailsData, TorobSearchRequest } from "./torob-payload";
import type { TorobRead } from "./torob-discovery";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  negative?: boolean;
}

export interface TorobCacheConfig {
  searchTtlMs: number;
  negativeSearchTtlMs: number;
  detailsTtlMs: number;
  similarTtlMs: number;
  priceTrendTtlMs: number;
  maxSearchEntries: number;
  maxDetailsEntries: number;
}

const DEFAULT_CACHE_CONFIG: TorobCacheConfig = {
  searchTtlMs: 10 * 60_000,
  negativeSearchTtlMs: 2 * 60_000,
  detailsTtlMs: 5 * 60_000,
  similarTtlMs: 10 * 60_000,
  priceTrendTtlMs: 30 * 60_000,
  maxSearchEntries: 300,
  maxDetailsEntries: 500,
};

const NATIVE_FETCH = typeof globalThis.fetch === "function" ? globalThis.fetch : undefined;

/** Only auto-cache on real network runs unless an explicit cache instance is supplied by a caller/test. */
export function isNativeFetchActive(): boolean {
  return NATIVE_FETCH != null && globalThis.fetch === NATIVE_FETCH;
}

export function searchCacheKey(req: TorobSearchRequest): string {
  return [
    req.query.trim().toLowerCase(),
    req.page ?? 1,
    req.sort ?? "popularity",
    req.category ?? "",
    req.minPriceToman ?? "",
    req.maxPriceToman ?? "",
    req.limit,
  ].join("|");
}

export function detailsCacheKey(card: Pick<TorobCandidateCard, "prk">): string {
  return card.prk;
}

export class TorobDiscoveryCache {
  private readonly cfg: TorobCacheConfig;
  private readonly searches = new Map<string, CacheEntry<TorobRead<unknown>>>();
  private readonly details = new Map<string, CacheEntry<TorobRead<TorobDetailsData>>>();
  private readonly similar = new Map<string, CacheEntry<TorobRead<unknown>>>();
  private readonly priceTrends = new Map<string, CacheEntry<MarketPriceTrend | null>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(cfg: Partial<TorobCacheConfig> = {}) {
    this.cfg = { ...DEFAULT_CACHE_CONFIG, ...cfg };
  }

  private getEntry<T>(map: Map<string, CacheEntry<T>>, key: string, nowMs: number): T | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      map.delete(key);
      return undefined;
    }
    // Refresh recency order for bounded LRU eviction.
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  private setEntry<T>(map: Map<string, CacheEntry<T>>, maxSize: number, key: string, entry: CacheEntry<T>): void {
    if (map.has(key)) map.delete(key);
    while (map.size >= maxSize) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
    map.set(key, entry);
  }

  getSearch(key: string, nowMs = Date.now()): TorobRead<unknown> | undefined {
    return this.getEntry(this.searches, key, nowMs);
  }

  setSearch(key: string, value: TorobRead<unknown>, isNegative: boolean, nowMs = Date.now()): void {
    if (value.blocked || value.unavailable || value.issue || value.data === undefined) return;
    const ttl = isNegative ? this.cfg.negativeSearchTtlMs : this.cfg.searchTtlMs;
    if (ttl <= 0) return;
    this.setEntry(this.searches, this.cfg.maxSearchEntries, key, {
      value,
      expiresAt: nowMs + ttl,
      negative: isNegative,
    });
  }

  getDetails(key: string, nowMs = Date.now()): TorobRead<TorobDetailsData> | undefined {
    return this.getEntry(this.details, key, nowMs);
  }

  setDetails(key: string, value: TorobRead<TorobDetailsData>, nowMs = Date.now()): void {
    if (value.blocked || value.unavailable || value.issue || !value.data) return;
    if (this.cfg.detailsTtlMs <= 0) return;
    this.setEntry(this.details, this.cfg.maxDetailsEntries, key, {
      value,
      expiresAt: nowMs + this.cfg.detailsTtlMs,
    });
  }

  getSimilar(key: string, nowMs = Date.now()): TorobRead<unknown> | undefined {
    return this.getEntry(this.similar, key, nowMs);
  }

  setSimilar(key: string, value: TorobRead<unknown>, nowMs = Date.now()): void {
    if (value.blocked || value.unavailable || value.issue || value.data === undefined) return;
    if (this.cfg.similarTtlMs <= 0) return;
    this.setEntry(this.similar, this.cfg.maxDetailsEntries, key, {
      value,
      expiresAt: nowMs + this.cfg.similarTtlMs,
    });
  }

  getPriceTrend(key: string, nowMs = Date.now()): { hit: boolean; value: MarketPriceTrend | null } {
    const entry = this.priceTrends.get(key);
    if (!entry) return { hit: false, value: null };
    if (entry.expiresAt <= nowMs) {
      this.priceTrends.delete(key);
      return { hit: false, value: null };
    }
    return { hit: true, value: entry.value };
  }

  setPriceTrend(key: string, value: MarketPriceTrend | null, nowMs = Date.now()): void {
    if (this.cfg.priceTrendTtlMs <= 0) return;
    this.setEntry(this.priceTrends, this.cfg.maxDetailsEntries, key, {
      value,
      expiresAt: nowMs + this.cfg.priceTrendTtlMs,
    });
  }

  clear(): void {
    this.searches.clear();
    this.details.clear();
    this.similar.clear();
    this.priceTrends.clear();
    this.inFlight.clear();
  }

  runSingleFlight<T>(
    kind: "search" | "details" | "similar" | "trend",
    key: string,
    fetcher: () => Promise<T>,
  ): { promise: Promise<T>; deduplicated: boolean } {
    const fullKey = `${kind}:${key}`;
    const existing = this.inFlight.get(fullKey);
    if (existing) {
      return { promise: existing as Promise<T>, deduplicated: true };
    }
    const promise = fetcher().finally(() => {
      if (this.inFlight.get(fullKey) === promise) this.inFlight.delete(fullKey);
    });
    this.inFlight.set(fullKey, promise);
    return { promise, deduplicated: false };
  }

  stats(): { searchEntries: number; detailsEntries: number; inFlightCount: number } {
    return { searchEntries: this.searches.size, detailsEntries: this.details.size, inFlightCount: this.inFlight.size };
  }
}

export const defaultTorobCache = new TorobDiscoveryCache();

export function clearTorobDiscoveryCache(): void {
  defaultTorobCache.clear();
}
