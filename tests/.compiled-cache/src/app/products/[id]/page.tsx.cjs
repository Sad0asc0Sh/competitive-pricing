"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = ProductDetailPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../db/schema");
var _actions = require("@/components/actions");
var _productForm = require("@/components/product-form");
var _format = require("../../../lib/format");
var _drizzleOrm = require("drizzle-orm");
var _navigation = require("next/navigation");
const dynamic = "force-dynamic";

/** فاصله روز از آخرین تغییر قیمت — خارج از رندر کامپوننت تا خروجی پایدار بماند */
exports.dynamic = dynamic;
function daysAgo(date) {
  return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}
async function ProductDetailPage({
  params
}) {
  const {
    id
  } = await params;
  const [p] = await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, Number(id))).limit(1);
  if (!p) (0, _navigation.notFound)();
  const decisions = await _db.db.select().from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.productId, p.id)).orderBy((0, _drizzleOrm.desc)(_schema.priceDecisions.createdAt)).limit(20);
  const latest = decisions[0];
  const offers = latest ? await _db.db.select().from(_schema.competitorOffers).where((0, _drizzleOrm.eq)(_schema.competitorOffers.decisionId, latest.id)).orderBy(_schema.competitorOffers.price) : [];
  return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <div className="mt-1 text-sm text-slate-500">
            {p.sku} · <span className={`badge ${_format.statusColor[p.status]}`}>{_format.statusLabel[p.status]}</span>
            {p.selectedSupplierName && <>
                {" "}
                · <span className="text-indigo-700 font-medium">منبع کف قیمت: {p.selectedSupplierName}</span>
              </>}
            {p.currentShowInFeatured && <>
                {" "}
                · <span className="badge bg-indigo-100 text-indigo-800">★ نمایش در منتخب‌های صفحه اصلی</span>
              </>}
            {p.torobUrl && <>
                {" "}
                ·{" "}
                <a href={p.torobUrl} target="_blank" className="text-indigo-600" rel="noreferrer">
                  صفحه ترب ↗
                </a>
              </>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <_actions.RunButton productIds={[p.id]} label="استعلام سقف و کف و قیمت‌گذاری اکنون" />
          <_actions.ProductStatusToggle id={p.id} status={p.status} />
          <_actions.DeleteProductButton id={p.id} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <Box title="قیمت تمام‌شده همکار" value={(0, _format.toman)(p.costPrice)} sub={p.selectedSupplierName ?? "تامین پایه"} />
        <Box title="خط قرمز فروش (کف سود)" value={(0, _format.toman)(p.currentHardFloorPrice ?? latest?.hardFloorPrice)} sub="هرگز زیر این قیمت" />
        <Box title="سقف معیار تخفیف (خط‌خورده)" value={(0, _format.toman)(p.currentBasePrice)} sub="سقف واقعی بازار بدون پرت" />
        <Box title="کف قطعی فروش" value={(0, _format.toman)(p.currentFinalPrice)} strong sub="پس از اعمال درصد تخفیف روی سقف" />
        <Box title="تخفیف / سیستم فعال" value={(0, _format.pct)(p.currentDiscountPct, 0)} sub={`${p.currentCampaignName || _format.campaignLabel[p.currentCampaign ?? "none"]} (${_format.badgeThemeLabel[p.currentBadgeTheme ?? "green-orange"] ?? ""})`} />
        <Box title="سود خالص فعلی" value={p.currentFinalPrice && p.costPrice ? `${(0, _format.toman)(p.currentFinalPrice - p.costPrice)} (${(0, _format.pct)((p.currentFinalPrice - p.costPrice) / p.costPrice * 100)})` : "—"} />
      </div>

      {latest && <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">
              آخرین تصمیم #{latest.id} · {(0, _format.faDate)(latest.createdAt)} ·{" "}
              <span className={`badge ${_format.statusColor[latest.status]}`}>{_format.statusLabel[latest.status]}</span>
            </h2>
            {latest.status === "pending_review" && <_actions.DecisionActions decisionId={latest.id} />}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5 lg:grid-cols-11">
            <Mini k="پیشنهاد معتبر/کل" v={`${(0, _format.faNum)(latest.offersUsed)}/${(0, _format.faNum)(latest.offersTotal)}`} />
            <Mini k="تمام‌شده همکار" v={(0, _format.toman)(latest.effectiveCostPrice)} />
            <Mini k="خط قرمز فروش" v={(0, _format.toman)(latest.hardFloorPrice)} />
            <Mini k="کف معتبر مشهد" v={(0, _format.toman)(latest.localLowestValid)} />
            <Mini k="کف معتبر کل ترب" v={(0, _format.toman)(latest.lowestValid)} />
            <Mini k="میانه بازار" v={(0, _format.toman)(latest.marketMedian)} />
            <Mini k="سقف رصدشده بازار" v={(0, _format.toman)(latest.monitoredMarketCeiling ?? latest.basePrice)} />
            <Mini k="رتبه در مشهد" v={latest.projectedLocalRank ? `#${(0, _format.faNum)(latest.projectedLocalRank)}` : "—"} />
            <Mini k="رتبه در کل ترب" v={latest.projectedNationalRank ? `#${(0, _format.faNum)(latest.projectedNationalRank)}` : "—"} />
            <Mini k="استراتژی" v={_format.strategyLabel[latest.strategy ?? ""] ?? latest.strategy ?? "—"} />
            <Mini k="اعتماد" v={(0, _format.pct)(latest.confidence * 100, 0)} />
          </div>

          <h3 className="mt-5 mb-2 text-sm font-bold">مراحل تصمیم‌گیری (کشف کف، سقف واقعی و سیستم تخفیف)</h3>
          <ol className="space-y-2">
            {latest.steps.map((s, i) => <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${s.level === "error" ? "border-rose-200 bg-rose-50" : s.level === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                <span className="ml-2 text-xs text-slate-400">{i + 1}</span>
                <b>{s.title}:</b> <span className="text-slate-700">{s.message}</span>
              </li>)}
          </ol>
          {latest.pushStatus && <p className="mt-3 text-xs text-slate-500">
              ارسال به فروشگاه:{" "}
              {latest.pushStatus === "pushed" ? "موفق" : latest.pushStatus === "skipped" ? "کانکتور غیرفعال" : `ناموفق — ${latest.pushError}`}
            </p>}
        </div>}

      {offers.length > 0 && <div className="card table-wrap">
          <h2 className="mb-3 font-bold">پیشنهادهای رقبا در ترب ({(0, _format.faNum)(offers.length)})</h2>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>فروشگاه</th>
                <th>شهر</th>
                <th>امتیاز</th>
                <th>قیمت</th>
                <th>آخرین تغییر</th>
                <th>وزن</th>
                <th>وضعیت در رادار بازار</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o, i) => <tr key={o.id} className={o.included ? "" : "text-slate-400"}>
                  <td className="num">{(0, _format.faNum)(i + 1)}</td>
                  <td>
                    {o.shopName}
                    {o.sellerType === "in_person" && <span className="badge mr-2 bg-sky-100 text-sky-700">حضوری</span>}
                    {o.isAd && <span className="badge mr-2 bg-purple-100 text-purple-700">آگهی</span>}
                    {!o.inStock && <span className="badge mr-2 bg-slate-200 text-slate-600">ناموجود</span>}
                    {o.priceUnreliable && <span className="badge mr-2 bg-rose-100 text-rose-700">غیرقابل اعتماد ترب</span>}
                  </td>
                  <td>
                    {o.shopCity ? <span className={o.isLocalCity ? "badge bg-indigo-100 text-indigo-800 font-bold" : "text-xs"}>
                        {o.shopCity}
                      </span> : "—"}
                  </td>
                  <td className="num text-xs">{o.shopScore ? (0, _format.faNum)(o.shopScore, 1) : "—"}</td>
                  <td className={`num ${o.included ? "font-medium" : "line-through"}`}>{(0, _format.toman)(o.price)}</td>
                  <td className="text-xs">
                    {o.lastChangedAt ? `${(0, _format.faNum)(daysAgo(o.lastChangedAt))} روز پیش` : "—"}
                  </td>
                  <td className="num text-xs">{o.included ? (0, _format.faNum)(o.weight, 2) : "—"}</td>
                  <td>
                    {o.included ? <span className="badge bg-emerald-100 text-emerald-700">بازار معتبر تحت رصد</span> : <span className="badge bg-rose-100 text-rose-700">حذف‌شده ({o.excludeReason})</span>}
                  </td>
                </tr>)}
            </tbody>
          </table>
        </div>}

      <div className="card table-wrap">
        <h2 className="mb-3 font-bold">تاریخچه تصمیم‌ها</h2>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>زمان</th>
              <th>کف همکار</th>
              <th>سقف معیار</th>
              <th>کف نهایی</th>
              <th>تخفیف / کمپین</th>
              <th>رتبه مشهد</th>
              <th>رتبه ترب</th>
              <th>سود خالص</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {decisions.map(d => <tr key={d.id}>
                <td className="num">{d.id}</td>
                <td className="text-xs">{(0, _format.faDate)(d.createdAt)}</td>
                <td className="num">{(0, _format.toman)(d.hardFloorPrice ?? d.effectiveCostPrice)}</td>
                <td className="num line-through text-slate-400">{(0, _format.toman)(d.basePrice)}</td>
                <td className="num font-medium text-emerald-700">{(0, _format.toman)(d.finalPrice)}</td>
                <td className="text-xs">
                  <span className="font-bold text-rose-600">{(0, _format.pct)(d.discountPct, 0)}</span> ·{" "}
                  {d.campaignName || _format.campaignLabel[d.campaignType ?? "none"]}
                </td>
                <td className="num font-bold text-indigo-700">
                  {d.projectedLocalRank ? `#${(0, _format.faNum)(d.projectedLocalRank)}` : "—"}
                </td>
                <td className="num">{d.projectedNationalRank ? `#${(0, _format.faNum)(d.projectedNationalRank)}` : "—"}</td>
                <td className="num">{(0, _format.toman)(d.netProfitToman)}</td>
                <td>
                  <span className={`badge ${_format.statusColor[d.status]}`}>{_format.statusLabel[d.status]}</span>
                </td>
                <td>{d.status === "pending_review" && <_actions.DecisionActions decisionId={d.id} />}</td>
              </tr>)}
            {!decisions.length && <tr>
                <td colSpan={11} className="py-6 text-center text-slate-400">
                  هنوز استعلامی انجام نشده
                </td>
              </tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-3 font-bold">ویرایش محصول، لیست قیمت همکاران و سیستم تخفیف ترجیحی</h2>
        <_productForm.ProductForm initial={{
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category ?? "",
        storeExternalId: p.storeExternalId ?? "",
        sourceType: p.sourceType,
        torobUrl: p.torobUrl ?? "",
        costPrice: p.costPrice,
        minMarginPct: p.minMarginPct ?? "",
        minProfitAmount: p.minProfitAmount ?? "",
        preferredCampaignType: p.preferredCampaignType ?? "auto",
        autoApply: p.autoApply
      }} initialQuotes={p.supplierQuotes} />
      </div>
    </div>;
}
function Box({
  title,
  value,
  sub,
  strong
}) {
  return <div className="card">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-1 num ${strong ? "text-xl font-bold text-emerald-700" : "text-lg font-semibold"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>;
}
function Mini({
  k,
  v
}) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className="num font-medium">{v}</div>
    </div>;
}