export declare const READ_ONLY: {
    readonly readOnlyHint: true;
    readonly destructiveHint: false;
    readonly idempotentHint: true;
    readonly openWorldHint: false;
};
export interface ToolDef {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<unknown>;
}
export declare const TOOLS: ToolDef[];
export declare function toolByName(name: string): ToolDef | undefined;
