"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxDuration = exports.dynamic = void 0;
exports.GET = GET;
const scheduler_1 = require("../../../../lib/services/scheduler");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
exports.maxDuration = 300;
/**
 * GET /api/scheduler/tick — برای cron خارجی.
 * اگر CRON_SECRET تنظیم شده باشد، هدر Authorization: Bearer <secret> لازم است.
 */
async function GET(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
        return server_1.NextResponse.json({ error: "CRON_SECRET روی سرور تنظیم نشده است؛ اندپوینت کرون در محیط تولید بسته است" }, { status: 500 });
    }
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
        return server_1.NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const r = await (0, scheduler_1.tickScheduler)();
    return server_1.NextResponse.json({ ok: true, ...r });
}
