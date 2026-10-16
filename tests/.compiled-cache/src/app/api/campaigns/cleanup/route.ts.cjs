"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.POST = POST;
exports.dynamic = void 0;
var _runner = require("../../../../lib/services/runner");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const out = await (0, _runner.cleanupWrongTimedSaleCards)({
      productId: body.productId ? Number(body.productId) : undefined
    });
    return _server.NextResponse.json({
      ok: true,
      ...out,
      message: out.cleanedCount > 0 ? `✅ ${out.cleanedCount} کارت از دسته «فرصت زمان‌دار (مالی و تخفیف)» پاک‌سازی و در فروشگاه بازگردانی شد` : "✅ هیچ کارت اشتباهی در دسته «فرصت زمان‌دار» وجود نداشت (کمپین پیش‌فرض و قفل ترب نیز ریست شدند)"
    });
  } catch (e) {
    return _server.NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "خطا در پاک‌سازی کمپین"
    }, {
      status: 500
    });
  }
}