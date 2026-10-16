"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = ReviewPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _actions = require("@/components/actions");
var _format = require("../../lib/format");
var _drizzleOrm = require("drizzle-orm");
var _link = _interopRequireDefault(require("next/link"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function ReviewPage() {
  const [rows, rejectedRows] = await Promise.all([_db.db.select({
    d: _schema.priceDecisions,
    name: _schema.products.name,
    sku: _schema.products.sku,
    cost: _schema.products.costPrice,
    current: _schema.products.currentFinalPrice
  }).from(_schema.priceDecisions).innerJoin(_schema.products, (0, _drizzleOrm.eq)(_schema.products.id, _schema.priceDecisions.productId)).where((0, _drizzleOrm.eq)(_schema.priceDecisions.status, "pending_review")).orderBy((0, _drizzleOrm.desc)(_schema.priceDecisions.createdAt)), _db.db.select({
    d: _schema.priceDecisions,
    name: _schema.products.name,
    sku: _schema.products.sku
  }).from(_schema.priceDecisions).innerJoin(_schema.products, (0, _drizzleOrm.eq)(_schema.products.id, _schema.priceDecisions.productId)).where((0, _drizzleOrm.eq)(_schema.priceDecisions.status, "rejected")).orderBy((0, _drizzleOrm.desc)(_schema.priceDecisions.createdAt)).limit(20)]);
  return <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">صف بازبینی انسانی</h1>
        <p className="mt-1 text-sm text-slate-500">
          تصمیم‌هایی که موتور به دلیل اعتماد پایین، کمبود داده، جهش قیمت یا برخورد با کف سود، برای تأیید نگه داشته است.
        </p>
      </div>
      {rows.map(({
      d,
      name,
      sku,
      cost,
      current
    }) => {
      const steps = Array.isArray(d.steps) ? d.steps : [];
      const reasons = steps.find(s => s.step === "decision")?.message ?? "";
      const supMsg = steps.find(s => s.step === "supervisor")?.message;
      const aiMsg = steps.find(s => s.step === "ai_review")?.message;
      return <div key={d.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <_link.default href={`/products/${d.productId}`} className="text-lg font-bold text-indigo-700 hover:underline">
                  {name}
                </_link.default>
                <div className="text-xs text-slate-400">
                  {sku} · تصمیم #{d.id} · {(0, _format.faDate)(d.createdAt)}
                </div>
              </div>
              <_actions.DecisionActions decisionId={d.id} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
              <Item k="تمام‌شده" v={(0, _format.toman)(cost)} />
              <Item k="قیمت فعلی" v={(0, _format.toman)(current)} />
              <Item k="مرجع بازار" v={(0, _format.toman)(d.referencePrice)} />
              <Item k="پیشنهاد: اصلی" v={(0, _format.toman)(d.basePrice)} />
              <Item k="پیشنهاد: نهایی" v={(0, _format.toman)(d.finalPrice)} strong />
              <Item k="تخفیف / کمپین" v={`${(0, _format.pct)(d.discountPct)} · ${_format.campaignLabel[d.campaignType ?? "none"]}`} />
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{reasons}</p>
            {supMsg && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">🛡️ ناظر: {supMsg}</p>}
            {aiMsg && <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">🤖 هوش مصنوعی: {aiMsg}</p>}
          </div>;
    })}
      {!rows.length && <div className="card text-center text-slate-400">صف بازبینی خالی است ✅</div>}

      <div>
        <h2 className="text-lg font-bold">ردشده‌های اخیر ناظر (وارد فروشگاه نمی‌شوند)</h2>
        <p className="mt-1 text-xs text-slate-500">
          تصمیم‌های زیر امتیاز آستانه رد گرفته‌اند و به‌صورت خودکار متوقف شده‌اند؛ دکمه «تأیید و اعمال» برای آن‌ها قفل است.
        </p>
      </div>
      {rejectedRows.map(({
      d,
      name,
      sku
    }) => {
      const steps = Array.isArray(d.steps) ? d.steps : [];
      const supMsg = steps.find(s => s.step === "supervisor")?.message ?? "رد توسط ناظر SystemOne";
      return <div key={d.id} className="card border-rose-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <_link.default href={`/products/${d.productId}`} className="font-bold text-rose-700 hover:underline">
                  {name}
                </_link.default>
                <div className="text-xs text-slate-400">
                  {sku} · تصمیم #{d.id} · {(0, _format.faDate)(d.createdAt)}
                </div>
              </div>
              <span className="badge bg-rose-100 text-rose-700">⛔ ردشده — غیرقابل اعمال</span>
            </div>
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{supMsg}</p>
          </div>;
    })}
      {!rejectedRows.length && <div className="card text-center text-xs text-slate-400">مورد ردشده‌ای ثبت نشده</div>}
    </div>;
}
function Item({
  k,
  v,
  strong
}) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className={`num ${strong ? "font-bold text-emerald-700" : "font-medium"}`}>{v}</div>
    </div>;
}