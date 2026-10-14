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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">کمپین‌های تخفیف</h1>
        <p className="mt-1 text-sm text-slate-500">
          موتور، قیمت رقابتی نهایی را همیشه به‌صورت «قیمت اصلی + تخفیف» می‌سازد. این‌جا تعیین می‌کنید هر تخفیف زیر کدام برچسب (لحظه‌ای یا منتخب/شگفت‌انگیز) و در چه ساعات/روزهایی نمایش داده شود. در زمان‌های مشترک، کمپین با اولویت بالاتر انتخاب می‌شود.
        </p>
      </div>
      <CampaignEditor campaigns={rows} />
    </div>
  );
}
