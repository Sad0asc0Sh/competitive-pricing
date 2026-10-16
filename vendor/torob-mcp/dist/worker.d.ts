import { type DurableObjectNamespaceLike } from "./rate-limit.js";
interface WorkerContext {
    waitUntil(promise: Promise<unknown>): void;
}
interface WorkerEnv {
    RATE_LIMITER?: DurableObjectNamespaceLike;
    /** Optional relay for upstream calls - see setUpstreamBase in http.ts. */
    TOROB_API_BASE?: string;
}
interface RateLimiterStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
}
export declare class RateLimiter {
    private readonly state;
    constructor(state: {
        storage: RateLimiterStorage;
    });
    fetch(): Promise<Response>;
}
declare const _default: {
    fetch(req: Request, env?: WorkerEnv, ctx?: WorkerContext): Promise<Response>;
};
export default _default;
