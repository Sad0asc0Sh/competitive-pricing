"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const runner_1 = require("../../../../lib/services/runner");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function POST(req) {
    try {
        const body = (await req.json().catch(() => ({})));
        const out = await (0, runner_1.cleanupWrongTimedSaleCards)({
            productId: body.productId ? Number(body.productId) : undefined,
        });
        return server_1.NextResponse.json({
            ok: true,
            ...out,
            message: out.cleanedCount > 0
                ? `✅ ${out.cleanedCount} کارت از دسته «فرصت زمان‌دار (مالی و تخفیف)» پاک‌سازی و در فروشگاه بازگردانی شد`
                : "✅ هیچ کارت اشتباهی در دسته «فرصت زمان‌دار» وجود نداشت (کمپین پیش‌فرض و قفل ترب نیز ریست شدند)",
        });
    }
    catch (e) {
        return server_1.NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "خطا در پاک‌سازی کمپین" }, { status: 500 });
    }
}
