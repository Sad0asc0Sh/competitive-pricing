import { db } from "@/db";
import { discountCampaigns } from "@/db/schema";
import { CampaignEditor } from "@/components/campaign-editor";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await ensureDefaults();
  const rows = await db.select().from(discountCampaigns).orderBy(desc(discountCampaigns.priority));
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold leading-snug text-slate-900 sm:text-2xl">
          استودیو مدیریت ۳ سیستم تخفیف sgeooole (لحظه‌ای · شگفت‌انگیز · فرصت‌های زمان‌دار مالی و منتخب‌ها)
        </h1>
        <p className="mt-1.5 text-xs leading-6 text-slate-600 sm:text-sm">
          موتور ابتدا قیمت‌های پرت و آپدیت‌نشده ترب را حذف کرده و <b>«سقف واقعی بازار تحت رصد»</b> را به عنوان قیمت معیار (خط‌خورده) و <b>«کف رقابتی هدف»</b> را به عنوان قیمت فروش قطعی کشف می‌کند. سپس درصد تخفیف را دقیقاً روی سقف اعمال می‌کند تا خروجی روی کف بنشیند و بر اساس قوانین زیر، هر رنج از کارت‌ها را در یکی از ۳ سیستم تخفیف فروشگاه قرار می‌دهد.
        </p>
      </div>
      <CampaignEditor campaigns={rows} />
    </div>
  );
}
