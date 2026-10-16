/** ~/.torob-mcp, or TOROB_MCP_HOME when set. */
export declare function defaultStoreDir(): string;
/**
 * Install the file store as the shared backend.
 *
 * Returns the path it will write to, or null when the store could not be set
 * up - in which case the server simply runs the way it did before this existed,
 * relearning a product name once more instead of failing.
 */
export declare function installFileStore(opts?: {
    dir?: string;
}): string | null;
/** Drop the backend and forget where it was - used by tests. */
export declare function uninstallFileStore(): void;
export declare function fileStorePath(): string | null;
