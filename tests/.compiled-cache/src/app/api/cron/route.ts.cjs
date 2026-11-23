"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxDuration = exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const auth_1 = require("../../../lib/auth");
const scheduler_1 = require("../../../lib/services/scheduler");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
exports.maxDuration = 300;
async function handleCron(req) {
    const denied = await (0, auth_1.requireCronOrAdminAuth)(req);
    if (denied)
        return denied;
    const r = await (0, scheduler_1.tickScheduler)();
    return server_1.NextResponse.json({ ok: true, ...r });
}
async function GET(req) {
    return handleCron(req);
}
async function POST(req) {
    return handleCron(req);
}
