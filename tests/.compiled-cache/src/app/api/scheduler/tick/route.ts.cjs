"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.maxDuration = exports.dynamic = void 0;
var _scheduler = require("../../../../lib/services/scheduler");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
const maxDuration = 300;

/**
 * GET /api/scheduler/tick — برای cron خارجی.
 * اگر CRON_SECRET تنظیم شده باشد، هدر Authorization: Bearer <secret> لازم است.
 */
exports.maxDuration = maxDuration;
async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return _server.NextResponse.json({
      error: "CRON_SECRET روی سرور تنظیم نشده است؛ اندپوینت کرون در محیط تولید بسته است"
    }, {
      status: 500
    });
  }
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return _server.NextResponse.json({
      error: "unauthorized"
    }, {
      status: 401
    });
  }
  const r = await (0, _scheduler.tickScheduler)();
  return _server.NextResponse.json({
    ok: true,
    ...r
  });
}