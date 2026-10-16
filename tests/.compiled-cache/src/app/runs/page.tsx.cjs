"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = RunsPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _format = require("../../lib/format");
var _drizzleOrm = require("drizzle-orm");
var _link = _interopRequireDefault(require("next/link"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function RunsPage({
  searchParams
}) {
  const {
    run
  } = await searchParams;
  const runs = await _db.db.select().from(_schema.priceRuns).orderBy((0, _drizzleOrm.desc)(_schema.priceRuns.startedAt)).limit(50);
  const selected = run ? Number(run) : runs[0]?.id;
  const decisions = selected ? await _db.db.select({
    d: _schema.priceDecisions,
    name: _schema.products.name,
    sku: _schema.products.sku
  }).from(_schema.priceDecisions).innerJoin(_schema.products, (0, _drizzleOrm.eq)(_schema.products.id, _schema.priceDecisions.productId)).where((0, _drizzleOrm.eq)(_schema.priceDecisions.runId, selected)).orderBy((0, _drizzleOrm.desc)(_schema.priceDecisions.createdAt)) : [];
  return <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="card">
        <h1 className="mb-3 text-lg font-bold">اجراها</h1>
        <ul className="space-y-1">
          {runs.map(r => <li key={r.id}>
              <_link.default href={`/runs?run=${r.id}`} className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${selected === r.id ? "bg-indigo-50 text-indigo-800" : ""}`}>
                <div className="flex items-center justify-between">
                  <span>
                    #{r.id} · {r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API"}
                  </span>
                  <span className={`badge ${_format.statusColor[r.status]}`}>{_format.statusLabel[r.status]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {(0, _format.faDate)(r.startedAt)} · {(0, _format.faNum)(r.totalProducts)} محصول · {(0, _format.faNum)(r.applied)}✓ {(0, _format.faNum)(r.pendingReview)}⏳ {(0, _format.faNum)(r.failed)}✗
                </div>
              </_link.default>
            </li>)}
          {!runs.length && <li className="text-sm text-slate-400">اجرایی ثبت نشده</li>}
        </ul>
      </div>
      <div className="space-y-3 lg:hidden">
        <h2 className="px-1 font-bold">تصمیم‌های اجرای #{selected ?? "—"}</h2>
        {decisions.map(({
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
              <span>قیمت نهایی</span>
              <span className="num font-bold text-emerald-700">{(0, _format.toman)(d.finalPrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>مرجع / اصلی</span>
              <span className="num text-xs">
                {(0, _format.toman)(d.referencePrice)} / {(0, _format.toman)(d.basePrice)}
              </span>
            </div>
            <div className="m-row-kv">
              <span>تخفیف / کمپین / اعتماد</span>
              <span className="num text-xs">
                {(0, _format.pct)(d.discountPct)} · {_format.campaignLabel[d.campaignType ?? "none"]} · {(0, _format.pct)(d.confidence * 100, 0)}
              </span>
            </div>
          </div>)}
        {!decisions.length && <div className="empty-state">تصمیمی وجود ندارد</div>}
      </div>
      <div className="card hidden lg:block">
        <h2 className="mb-3 font-bold">تصمیم‌های اجرای #{selected ?? "—"}</h2>
        <table className="data">
          <thead>
            <tr>
              <th>محصول</th>
              <th>منبع</th>
              <th>معتبر/کل</th>
              <th>مرجع</th>
              <th>اصلی</th>
              <th>نهایی</th>
              <th>تخفیف</th>
              <th>کمپین</th>
              <th>اعتماد</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map(({
            d,
            name,
            sku
          }) => <tr key={d.id}>
                <td>
                  <_link.default href={`/products/${d.productId}`} className="text-indigo-700 hover:underline">
                    {name}
                  </_link.default>
                  <div className="text-xs text-slate-400">{sku}</div>
                </td>
                <td>{d.source}</td>
                <td className="num">
                  {(0, _format.faNum)(d.offersUsed)}/{(0, _format.faNum)(d.offersTotal)}
                </td>
                <td className="num">{(0, _format.toman)(d.referencePrice)}</td>
                <td className="num line-through decoration-slate-400">{(0, _format.toman)(d.basePrice)}</td>
                <td className="num font-bold text-emerald-700">{(0, _format.toman)(d.finalPrice)}</td>
                <td className="num">{(0, _format.pct)(d.discountPct)}</td>
                <td>{_format.campaignLabel[d.campaignType ?? "none"]}</td>
                <td className="num">{(0, _format.pct)(d.confidence * 100, 0)}</td>
                <td>
                  <span className={`badge ${_format.statusColor[d.status]}`}>{_format.statusLabel[d.status]}</span>
                </td>
              </tr>)}
            {!decisions.length && <tr>
                <td colSpan={10} className="py-6 text-center text-slate-400">
                  تصمیمی وجود ندارد
                </td>
              </tr>}
          </tbody>
        </table>
      </div>
    </div>;
}