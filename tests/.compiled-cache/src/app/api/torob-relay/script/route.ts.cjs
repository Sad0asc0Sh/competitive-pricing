"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const auth_1 = require("../../../../lib/auth");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const filePath = node_path_1.default.join(process.cwd(), "scripts", "torob-relay.mjs");
    const script = await (0, promises_1.readFile)(filePath, "utf8");
    return new server_1.NextResponse(script, {
        status: 200,
        headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Content-Disposition": 'attachment; filename="torob-relay.mjs"',
            "Cache-Control": "no-store",
        },
    });
}
