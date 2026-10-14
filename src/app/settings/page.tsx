import { db } from "@/db";
import { pricingProfiles, schedules, storeConnectors } from "@/db/schema";
import { ConnectorEditor, ProfileEditor, ScheduleEditor } from "@/components/settings-panels";
import { ensureDefaults, mergeConfig } from "@/lib/services/bootstrap";
import { aiEnabled } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureDefaults();
  const [profiles, sch, conns] = await Promise.all([
    db.select().from(pricingProfiles).orderBy(pricingProfiles.id),
    db.select().from(schedules).orderBy(schedules.id),
    db.select().from(storeConnectors).orderBy(storeConnectors.id),
  ]);
  const masked = conns.map((c) => ({ ...c, config: Object.fromEntries(Object.entries(c.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v])) }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">تنظیمات موتور قیمت‌گذاری</h1>
        <p className="mt-1 text-sm text-slate-500">
          همه پارامترهای الگوریتم از این‌جا قابل تنظیم است؛ هر محصول می‌تواند پروفایل خاص خودش را داشته باشد. هوش مصنوعی: {aiEnabled() ? "فعال" : "غیرفعال — متغیرهای AI_API_KEY / AI_BASE_URL / AI_MODEL را تنظیم کنید"}.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">پروفایل‌های قیمت‌گذاری</h2>
        <ProfileEditor profiles={profiles.map((p) => ({ ...p, config: mergeConfig(p.config) }))} />
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-bold">زمان‌بندی استعلام خودکار</h2>
        <ScheduleEditor items={sch} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">اتصال به فروشگاه (وب‌سرویس)</h2>
        <ConnectorEditor items={masked} />
        <p className="mt-2 text-xs text-slate-500">
          مقادیر می‌توانند از متغیرهای محیطی هم خوانده شوند: <code dir="ltr">WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET</code> یا <code dir="ltr">STORE_WEBHOOK_URL, STORE_WEBHOOK_SECRET</code>.
        </p>
      </section>
    </div>
  );
}
