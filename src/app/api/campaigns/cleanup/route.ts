import { cleanupWrongTimedSaleCards } from "@/lib/services/runner";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { productId?: number };
    const out = await cleanupWrongTimedSaleCards({
      productId: body.productId ? Number(body.productId) : undefined,
    });
    return NextResponse.json({
      ok: true,
      ...out,
      message:
        out.cleanedCount > 0
          ? `✅ ${out.cleanedCount} کارت از دسته «فرصت زمان‌دار (مالی و تخفیف)» پاک‌سازی و در فروشگاه بازگردانی شد`
          : "✅ هیچ کارت اشتباهی در دسته «فرصت زمان‌دار» وجود نداشت (کمپین پیش‌فرض و قفل ترب نیز ریست شدند)",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطا در پاک‌سازی کمپین" },
      { status: 500 },
    );
  }
}
