"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultTorobCache = exports.TorobDiscoveryCache = void 0;
exports.isNativeFetchActive = isNativeFetchActive;
exports.searchCacheKey = searchCacheKey;
exports.detailsCacheKey = detailsCacheKey;
exports.clearTorobDiscoveryCache = clearTorobDiscoveryCache;
const DEFAULT_CACHE_CONFIG = {
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
function isNativeFetchActive() {
    return NATIVE_FETCH != null && globalThis.fetch === NATIVE_FETCH;
}
function searchCacheKey(req) {
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
function detailsCacheKey(card) {
    return card.prk;
}
class TorobDiscoveryCache {
    cfg;
    searches = new Map();
    details = new Map();
    similar = new Map();
    priceTrends = new Map();
    inFlight = new Map();
    constructor(cfg = {}) {
        this.cfg = { ...DEFAULT_CACHE_CONFIG, ...cfg };
    }
    getEntry(map, key, nowMs) {
        const entry = map.get(key);
        if (!entry)
            return undefined;
        if (entry.expiresAt <= nowMs) {
            map.delete(key);
            return undefined;
        }
        // Refresh recency order for bounded LRU eviction.
        map.delete(key);
        map.set(key, entry);
        return entry.value;
    }
    setEntry(map, maxSize, key, entry) {
        if (map.has(key))
            map.delete(key);
        while (map.size >= maxSize) {
            const oldest = map.keys().next();
            if (oldest.done)
                break;
            map.delete(oldest.value);
        }
        map.set(key, entry);
    }
    getSearch(key, nowMs = Date.now()) {
        return this.getEntry(this.searches, key, nowMs);
    }
    setSearch(key, value, isNegative, nowMs = Date.now()) {
        if (value.blocked || value.unavailable || value.issue || value.data === undefined)
            return;
        const ttl = isNegative ? this.cfg.negativeSearchTtlMs : this.cfg.searchTtlMs;
        if (ttl <= 0)
            return;
        this.setEntry(this.searches, this.cfg.maxSearchEntries, key, {
            value,
            expiresAt: nowMs + ttl,
            negative: isNegative,
        });
    }
    getDetails(key, nowMs = Date.now()) {
        return this.getEntry(this.details, key, nowMs);
    }
    setDetails(key, value, nowMs = Date.now()) {
        if (value.blocked || value.unavailable || value.issue || !value.data)
            return;
        if (this.cfg.detailsTtlMs <= 0)
            return;
        this.setEntry(this.details, this.cfg.maxDetailsEntries, key, {
            value,
            expiresAt: nowMs + this.cfg.detailsTtlMs,
        });
    }
    getSimilar(key, nowMs = Date.now()) {
        return this.getEntry(this.similar, key, nowMs);
    }
    setSimilar(key, value, nowMs = Date.now()) {
        if (value.blocked || value.unavailable || value.issue || value.data === undefined)
            return;
        if (this.cfg.similarTtlMs <= 0)
            return;
        this.setEntry(this.similar, this.cfg.maxDetailsEntries, key, {
            value,
            expiresAt: nowMs + this.cfg.similarTtlMs,
        });
    }
    getPriceTrend(key, nowMs = Date.now()) {
        const entry = this.priceTrends.get(key);
        if (!entry)
            return { hit: false, value: null };
        if (entry.expiresAt <= nowMs) {
            this.priceTrends.delete(key);
            return { hit: false, value: null };
        }
        return { hit: true, value: entry.value };
    }
    setPriceTrend(key, value, nowMs = Date.now()) {
        if (this.cfg.priceTrendTtlMs <= 0)
            return;
        this.setEntry(this.priceTrends, this.cfg.maxDetailsEntries, key, {
            value,
            expiresAt: nowMs + this.cfg.priceTrendTtlMs,
        });
    }
    clear() {
        this.searches.clear();
        this.details.clear();
        this.similar.clear();
        this.priceTrends.clear();
        this.inFlight.clear();
    }
    runSingleFlight(kind, key, fetcher) {
        const fullKey = `${kind}:${key}`;
        const existing = this.inFlight.get(fullKey);
        if (existing) {
            return { promise: existing, deduplicated: true };
        }
        const promise = fetcher().finally(() => {
            if (this.inFlight.get(fullKey) === promise)
                this.inFlight.delete(fullKey);
        });
        this.inFlight.set(fullKey, promise);
        return { promise, deduplicated: false };
    }
    stats() {
        return { searchEntries: this.searches.size, detailsEntries: this.details.size, inFlightCount: this.inFlight.size };
    }
}
exports.TorobDiscoveryCache = TorobDiscoveryCache;
exports.defaultTorobCache = new TorobDiscoveryCache();
function clearTorobDiscoveryCache() {
    exports.defaultTorobCache.clear();
}
