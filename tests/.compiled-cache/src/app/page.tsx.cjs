"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = DashboardPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../db/schema");
var _actions = require("@/components/actions");
var _format = require("../lib/format");
var _bootstrap = require("../lib/services/bootstrap");
var _config = require("../lib/ai/config");
var _connectors = require("../lib/store/connectors");
var _drizzleOrm = require("drizzle-orm");
var _link = _interopRequireDefault(require("next/link"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function DashboardPage() {
  await (0, _bootstrap.ensureDefaults)();
  const [[{
    total
  }], [{
    needsReview
  }], [{
    pending
  }], recentDecisions, recentRuns, logs, sch, campaignStats] = await Promise.all([_db.db.select({
    total: (0, _drizzleOrm.count)()
  }).from(_schema.products), _db.db.select({
    needsReview: (0, _drizzleOrm.count)()
  }).from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.status, "needs_review")), _db.db.select({
    pending: (0, _drizzleOrm.count)()
  }).from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.status, "pending_review")), _db.db.select({
    d: _schema.priceDecisions,
    name: _schema.products.name,
    sku: _schema.products.sku
  }).from(_schema.priceDecisions).innerJoin(_schema.products, (0, _drizzleOrm.eq)(_schema.products.id, _schema.priceDecisions.productId)).orderBy((0, _drizzleOrm.desc)(_schema.priceDecisions.createdAt)).limit(10), _db.db.select().from(_schema.priceRuns).orderBy((0, _drizzleOrm.desc)(_schema.priceRuns.startedAt)).limit(5), _db.db.select().from(_schema.activityLogs).orderBy((0, _drizzleOrm.desc)(_schema.activityLogs.createdAt)).limit(8), _db.db.select().from(_schema.schedules).where((0, _drizzleOrm.eq)(_schema.schedules.active, true)), _db.db.select({
    campaign: _schema.products.currentCampaign,
    c: (0, _drizzleOrm.count)(),
    avg: (0, _drizzleOrm.sql)`avg(${_schema.products.currentDiscountPct})`
  }).from(_schema.products).groupBy(_schema.products.currentCampaign)]);
  const nextRun = sch.map(s => s.nextRunAt).filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0];
  const aiStatus = await (0, _config.getAIStatus)();
  let storeStatus = null;
  try {
    storeStatus = await (0, _connectors.getStoreStatus)();
  } catch {
    storeStatus = null;
  }
  return <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            مرکز فرماندهی قیمت‌گذاری، کشف کف و سقف بازار و ۳ سیستم تخفیف (sgeooole · ترب و مشهد)
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            استعلام خودکار بعدی: <b>{(0, _format.faDate)(nextRun)}</b> · هوش مصنوعی مکمل:{" "}
            {aiStatus.ai.configured ? <span className="text-emerald-600">
                فعال ({aiStatus.ai.model}
                {aiStatus.ai.source === "db" ? " · توکن از پنل تنظیمات" : " · توکن از .env"})
              </span> : <span className="text-amber-600">غیرفعال — کلید را از صفحه تنظیمات ثبت کنید</span>}{" "}
            · ناظر SubQ SystemOne:{" "}
            {aiStatus.subq.configured ? <span className="text-emerald-600">
                متصل ({aiStatus.subq.model}
                {aiStatus.subq.source === "db" ? " · توکن از پنل تنظیمات" : " · توکن از .env"})
              </span> : <span className="text-slate-500">موتور آنی محلی — توکن SubQ از صفحه تنظیمات ثبت نشده</span>}{" "}
            · فروشگاه:{" "}
            {storeStatus?.activeType ? <span className="text-emerald-600">متصل ({storeStatus.activeType})</span> : storeStatus?.envFallback ? <span className="text-emerald-600">متصل (env sgeooole)</span> : <span className="text-rose-600">قطع — کانکتور یا SGEOOOLE_API_URL را تنظیم کنید</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <_link.default href="/campaigns" className="btn-secondary">
            🎛️ استودیو ۳ سیستم تخفیف
          </_link.default>
          <_link.default href="/simulate" className="btn-secondary">
            🧪 آزمایشگاه کف و سقف
          </_link.default>
          <_actions.RunButton label="استعلام همه کارت‌های فعال" />
        </div>
      </div>

      {/* اجرای سریع روی رنج کارت‌ها مستقیماً از داشبورد */}
      <_actions.CardRangeRunner totalCards={total} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat title="کل کارت‌های محصول" value={(0, _format.faNum)(total)} href="/products" />
        <Stat title="در انتظار بازبینی" value={(0, _format.faNum)(pending)} href="/review" tone={pending > 0 ? "amber" : "default"} />
        <Stat title="نیازمند توجه" value={(0, _format.faNum)(needsReview)} href="/review" tone={needsReview > 0 ? "amber" : "default"} />
        <Stat title="زمان‌بندی‌های فعال" value={(0, _format.faNum)(sch.length)} href="/settings" />
      </div>

      {/* وضعیت هر ۳ سیستم تخفیف فروشگاه sgeooole */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {["flash", "featured", "timed_sale", "none"].map(t => {
        const s = campaignStats.find(c => (c.campaign ?? "none") === t);
        return <_link.default key={t} href="/campaigns" className="card block transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className={`badge border ${_format.campaignColor[t] ?? "bg-slate-100"}`}>{_format.campaignLabel[t]}</span>
              </div>
              <div className="mt-3 text-2xl font-bold num">{(0, _format.faNum)(s?.c ?? 0)} کارت</div>
              <div className="mt-1 text-xs text-slate-500">
                میانگین تخفیف سقف به کف: <b>{(0, _format.pct)(s?.avg ? Number(s.avg) : null, 0)}</b>
              </div>
            </_link.default>;
      })}
      </div>

      {/* نمای موبایل آخرین تصمیم‌ها: کارت به‌جای جدول ۱۰ ستونه */}
      <div className="space-y-3 md:hidden">
        <h2 className="px-1 font-bold">آخرین تصمیم‌های موتور</h2>
        {recentDecisions.map(({
        d,
        name,
        sku
      }) => <div key={d.id} className="m-row">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <_link.default href={`/products/${d.productId}`} className="block truncate font-bold text-indigo-700">
                  {name}
                </_link.default>
                <div className="text-xs text-slate-400">{sku}</div>
              </div>
              <span className={`badge ${_format.statusColor[d.status]}`}>{_format.statusLabel[d.status]}</span>
            </div>
            <div className="m-row-kv">
              <span>کف قطعی ما</span>
              <span className="num font-bold text-emerald-700">{(0, _format.toman)(d.finalPrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>سقف معیار (خط‌خورده)</span>
              <span className="num line-through decoration-slate-400">{(0, _format.toman)(d.basePrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>تخفیف / سیستم</span>
              <span className="num font-bold text-rose-600">
                {(0, _format.pct)(d.discountPct, 0)} · {_format.campaignLabel[d.campaignType ?? "none"]}
              </span>
            </div>
            <div className="m-row-kv">
              <span>کف مشهد / ترب</span>
              <span className="num text-xs">
                {(0, _format.toman)(d.localLowestValid)} / {(0, _format.toman)(d.lowestValid)}
              </span>
            </div>
            <div className="m-row-kv">
              <span>سود خالص</span>
              <span className="num text-xs">
                {(0, _format.toman)(d.netProfitToman)} ({(0, _format.pct)(d.netMarginPct)})
              </span>
            </div>
          </div>)}
        {!recentDecisions.length && <div className="empty-state">هنوز تصمیمی ثبت نشده. از صفحه محصولات یک محصول اضافه کنید یا رنج کارت‌ها را استعلام کنید.</div>}
      </div>

      <div className="card hidden md:block">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">
            آخرین تصمیم‌های موتور (کشف سقف واقعی بازار بدون پرت → اعمال درصد تخفیف روی کف رقابتی)
          </h2>
          <_link.default href="/runs" className="text-sm text-indigo-600">
            همه اجراها
          </_link.default>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>محصول</th>
              <th>خط قرمز همکار</th>
              <th>کف مشهد / ترب</th>
              <th>سقف معیار (خط‌خورده)</th>
              <th>تخفیف</th>
              <th>کف قطعی ما</th>
              <th>سیستم تخفیف</th>
              <th>رتبه مشهد / ترب</th>
              <th>سود خالص</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {recentDecisions.map(({
            d,
            name,
            sku
          }) => <tr key={d.id}>
                <td>
                  <_link.default href={`/products/${d.productId}`} className="text-indigo-700 hover:underline font-medium">
                    {name}
                  </_link.default>
                  <div className="text-xs text-slate-400">{sku}</div>
                </td>
                <td className="num text-amber-700 font-medium">{(0, _format.toman)(d.hardFloorPrice ?? d.effectiveCostPrice)}</td>
                <td className="num text-xs">
                  مشهد: {(0, _format.toman)(d.localLowestValid)}
                  <br />
                  ترب: {(0, _format.toman)(d.lowestValid)}
                </td>
                <td className="num line-through decoration-slate-400">{(0, _format.toman)(d.basePrice)}</td>
                <td className="num font-bold text-rose-600">{(0, _format.pct)(d.discountPct, 0)}</td>
                <td className="num font-bold text-emerald-700">{(0, _format.toman)(d.finalPrice)}</td>
                <td>
                  <span className={`badge border ${_format.campaignColor[d.campaignType ?? "none"] ?? "bg-slate-100"}`}>
                    {d.campaignName || _format.campaignLabel[d.campaignType ?? "none"]}
                  </span>
                  {d.showInFeatured && <div className="mt-0.5 text-[10px] font-medium text-indigo-700">★ منتخب صفحه اصلی</div>}
                </td>
                <td className="num">
                  <span className="badge bg-indigo-50 text-indigo-800">
                    مشهد {d.projectedLocalRank != null ? `#${(0, _format.faNum)(d.projectedLocalRank)}` : "—"} | ترب{" "}
                    {d.projectedNationalRank != null ? `#${(0, _format.faNum)(d.projectedNationalRank)}` : "—"}
                  </span>
                </td>
                <td className="num text-xs font-medium">
                  {(0, _format.toman)(d.netProfitToman)} ({(0, _format.pct)(d.netMarginPct)})
                </td>
                <td>
                  <span className={`badge ${_format.statusColor[d.status]}`}>{_format.statusLabel[d.status]}</span>
                </td>
              </tr>)}
            {!recentDecisions.length && <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  هنوز تصمیمی ثبت نشده. از صفحه محصولات یک محصول اضافه کنید یا از نوار بالا رنج کارت‌ها را استعلام کنید.
                </td>
              </tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-bold">اجراهای اخیر</h2>
          <ul className="space-y-2 text-sm">
            {recentRuns.map(r => <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span>
                  #{r.id} · {r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API"} · {(0, _format.faDate)(r.startedAt)}
                </span>
                <span className="text-xs text-slate-500">
                  {(0, _format.faNum)(r.applied)} اعمال / {(0, _format.faNum)(r.pendingReview)} بازبینی / {(0, _format.faNum)(r.failed)} خطا
                </span>
              </li>)}
            {!recentRuns.length && <li className="text-slate-400">اجرایی ثبت نشده</li>}
          </ul>
        </div>
        <div className="card">
          <h2 className="mb-3 font-bold">لاگ فعالیت</h2>
          <ul className="space-y-2 text-xs">
            {logs.map(l => <li key={l.id} className="flex gap-2">
                <span className={`badge ${l.level === "error" ? "bg-rose-100 text-rose-700" : l.level === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                  {l.scope}
                </span>
                <span className="text-slate-700">{l.message}</span>
                <span className="mr-auto whitespace-nowrap text-slate-400">{(0, _format.faDate)(l.createdAt)}</span>
              </li>)}
            {!logs.length && <li className="text-slate-400">لاگی ثبت نشده</li>}
          </ul>
        </div>
      </div>
    </div>;
}
function Stat({
  title,
  value,
  href,
  tone = "default"
}) {
  return <_link.default href={href} className={`card block transition hover:shadow-md ${tone === "amber" ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-bold num">{value}</div>
    </_link.default>;
}