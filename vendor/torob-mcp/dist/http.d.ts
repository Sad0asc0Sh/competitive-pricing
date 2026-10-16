export declare function setRetryDelayForTests(ms: number | null): void;
export declare function setPaceForTests(ms: number | null): void;
export declare const UPSTREAM_BASE_ENV = "TOROB_API_BASE";
/**
 * Point upstream calls at `value`, or back at Torob's own API with null/empty.
 * Throws on a value that cannot be used, so a misconfigured deployment fails at
 * the first request with the reason instead of quietly calling Torob anyway.
 */
export declare function setUpstreamBase(value?: string | null): void;
/** The base every upstream call is built on: the relay when one is set, else Torob. */
export declare function upstreamBaseUrl(): string;
export declare class UpstreamError extends Error {
    kind: "challenged" | "http" | "network" | "usage";
    status?: number;
    constructor(message: string, kind: UpstreamError["kind"], opts?: {
        status?: number;
    });
}
/** The gate's remaining time from this process's own view. Synchronous by design. */
export declare function breakerRemainingMs(): number;
/**
 * Forget only this process's view of the gate and leave the shared copy alone -
 * which is precisely what a fresh isolate, or the next run of the local server,
 * starts with.
 */
export declare function forgetLocalWallForTests(): void;
/**
 * Forget the gate completely - the local state and the shared copy. The shared
 * copy matters: leaving it behind would have the next test, or the next
 * isolate, refuse to spend a request that something else needs to make.
 */
export declare function resetBreakerForTests(): Promise<void>;
/**
 * Let the gate lapse without forgetting what it learned - the state after a
 * stage has run out on its own. Without it the second stage could only be
 * reached by waiting half an hour.
 */
export declare function expireWallForTests(): Promise<void>;
export declare function setHostedDemo(value: boolean): void;
/**
 * Call the Torob API and return parsed JSON.
 *
 * @param path Absolute URL, or a path relative to the API base.
 */
export declare function torobGet<T = unknown>(path: string, opts?: {
    retries?: number;
}): Promise<T>;
