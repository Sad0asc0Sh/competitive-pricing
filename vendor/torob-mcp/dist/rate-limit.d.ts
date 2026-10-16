export declare const RATE_LIMIT_MAX = 20;
export declare const RATE_LIMIT_WINDOW_MS = 60000;
export interface RateLimitVerdict {
    allowed: boolean;
    limit: number;
    /** Calls left in this window, 0 when the caller is over it. */
    remaining: number;
    /** Seconds until the window rolls over; 0 while the caller is under it. */
    retry_after_seconds: number;
}
export declare function clientKeyOf(req: Request): string;
/** The parts of the Durable Object API this file uses, typed structurally. */
export interface DurableObjectStub {
    fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface DurableObjectNamespaceLike {
    idFromName(name: string): unknown;
    get(id: unknown): DurableObjectStub;
}
/**
 * Count one call for `key`: the Durable Object when the Worker is given one,
 * otherwise the weaker local counters. Never throws - a limiter that fails the
 * request it was meant to protect against is worse than a limiter that misses.
 */
export declare function rateLimitFor(key: string, namespace?: DurableObjectNamespaceLike, now?: number): Promise<RateLimitVerdict>;
/** Tests keep one process; without this the counter would leak between them. */
export declare function resetRateLimitForTests(): void;
/** The verdict for a fixed one-minute bucket, shared by the object and the fallbacks. */
export declare function verdictFor(used: number, now: number): RateLimitVerdict;
/**
 * Count one call from `key` in whichever store this runtime has. The window is a
 * fixed minute bucket, not a sliding one: cheaper, and a caller who arrives at
 * the end of a bucket can spend two minutes' worth across the boundary, which
 * only matters to someone deliberately riding the edge.
 */
export declare function checkRateLimit(key: string, now?: number): Promise<RateLimitVerdict>;
