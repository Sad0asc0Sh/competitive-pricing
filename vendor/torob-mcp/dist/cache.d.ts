export declare function setCacheLimitsForTests(opts: {
    maxEntries?: number;
    maxBytes?: number;
} | null): void;
export declare function cacheStatsForTests(): {
    entries: number;
    bytes: number;
};
export declare function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts?: {
    accept?: (value: T) => boolean;
}): Promise<T>;
export declare const MIN = 60000;
export declare const HOUR = 3600000;
export declare function cachedGet<T>(key: string): T | undefined;
export declare function cacheSet(key: string, value: unknown, ttlMs: number): void;
