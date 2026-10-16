"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = SettingsPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _settingsPanels = require("@/components/settings-panels");
var _config = require("../../lib/ai/config");
var _bootstrap = require("../../lib/services/bootstrap");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function SettingsPage() {
  await (0, _bootstrap.ensureDefaults)();
  const [profiles, sch, conns, aiStatus] = await Promise.all([_db.db.select().from(_schema.pricingProfiles).orderBy(_schema.pricingProfiles.id), _db.db.select().from(_schema.schedules).orderBy(_schema.schedules.id), _db.db.select().from(_schema.storeConnectors).orderBy(_schema.storeConnectors.id), (0, _config.getAIStatus)()]);
  const masked = conns.map(c => ({
    ...c,
    config: Object.fromEntries(Object.entries(c.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v]))
  }));
  return <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">تنظیمات موتور قیمت‌گذاری</h1>
        <p className="mt-1 text-sm text-slate-500">
          همه پارامترهای الگوریتم از این‌جا قابل تنظیم است؛ هر محصول می‌تواند پروفایل خاص خودش را داشته باشد. هوش مصنوعی مکمل:{" "}
          {aiStatus.ai.configured ? `فعال (${aiStatus.ai.model})` : "غیرفعال — توکن را در همین صفحه وارد و ذخیره کنید"}{" "}
          · ناظر SubQ SystemOne:{" "}
          {aiStatus.subq.configured ? `متصل (${aiStatus.subq.model})` : "موتور آنی محلی — برای API زنده، توکن SubQ را در همین صفحه ثبت کنید"}.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">هوش مصنوعی و توکن‌های API (ذخیره امن در دیتابیس)</h2>
        <_settingsPanels.AISettingsPanel initial={aiStatus} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">پروفایل‌های قیمت‌گذاری</h2>
        <_settingsPanels.ProfileEditor profiles={profiles.map(p => ({
        ...p,
        config: (0, _bootstrap.mergeConfig)(p.config)
      }))} />
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-bold">زمان‌بندی استعلام خودکار</h2>
        <_settingsPanels.ScheduleEditor items={sch} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">اتصال به فروشگاه (وب‌سرویس)</h2>
        <_settingsPanels.ConnectorEditor items={masked} />
        <p className="mt-2 text-xs text-slate-500">
          مقادیر می‌توانند از متغیرهای محیطی هم خوانده شوند: <code dir="ltr">WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET</code> یا <code dir="ltr">STORE_WEBHOOK_URL, STORE_WEBHOOK_SECRET</code>.
        </p>
      </section>
    </div>;
}