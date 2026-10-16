export type StoreBackend = {
    get(key: string): Promise<unknown | undefined>;
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
};
/** Install a backend (the local server's file store), or pass null to clear it. */
export declare function setStoreBackend(next: StoreBackend | null): void;
export declare function hasStoreBackend(): boolean;
export declare function storeGet<T>(key: string): Promise<T | undefined>;
export declare function storeSet(key: string, value: unknown, ttlSeconds: number): Promise<void>;
