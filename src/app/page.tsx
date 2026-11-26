import { db } from "@/db";
import { activityLogs, priceDecisions, priceRuns, products, schedules } from "@/db/schema";
import { CardRangeRunner, RunButton } from "@/components/actions";
import { DashboardDecisionsSection, type DashboardDecisionItem } from "@/components/dashboard-client";
import { campaignColor, campaignLabel, faDate, faNum, pct, statusColor, statusLabel } from "@/lib/format";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { getAIStatus } from "@/lib/ai/config";
import { getStoreStatus } from "@/lib/store/connectors";
import { count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await ensureDefaults();
  const [[{ total }], [{ needsReview }], [{ pending }], recentDecisions, recentRuns, logs, sch, campaignStats] =
    await Promise.all([
      db.select({ total: count() }).from(products),
      db.select({ needsReview: count() }).from(products).where(eq(products.status, "needs_review")),
      db.select({ pending: count() }).from(priceDecisions).where(eq(priceDecisions.status, "pending_review")),
      db
        .select({ d: priceDecisions, name: products.name, sku: products.sku })
        .from(priceDecisions)
        .innerJoin(products, eq(products.id, priceDecisions.productId))
        .orderBy(desc(priceDecisions.createdAt))
        .limit(10),
      db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(5),
      db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(8),
      db.select().from(schedules).where(eq(schedules.active, true)),
      db
        .select({ campaign: products.currentCampaign, c: count(), avg: sql<number>`avg(${products.currentDiscountPct})` })
        .from(products)
        .groupBy(products.currentCampaign),
    ]);

  const nextRun = sch.map((s) => s.nextRunAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
  const aiStatus = await getAIStatus();
  let storeStatus = null;
  try {
    storeStatus = await getStoreStatus();
  } catch {
    storeStatus = null;
  }

  const serializedDecisions: DashboardDecisionItem[] = recentDecisions.map(({ d, name, sku }) => ({
    id: d.id,
    productId: d.productId,
    name,
    sku,
    status: d.status,
    finalPrice: d.finalPrice,
    basePrice: d.basePrice,
    discountPct: d.discountPct,
    campaignType: d.campaignType,
    campaignName: d.campaignName,
    showInFeatured: d.showInFeatured,
    localLowestValid: d.localLowestValid,
    lowestValid: d.lowestValid,
    hardFloorPrice: d.hardFloorPrice,
    effectiveCostPrice: d.effectiveCostPrice,
    projectedLocalRank: d.projectedLocalRank,
    projectedNationalRank: d.projectedNationalRank,
    netProfitToman: d.netProfitToman,
    netMarginPct: d.netMarginPct,
    createdAt: d.createdAt.toISOString(),
  }));

  const storeConnected = Boolean(storeStatus?.activeType || storeStatus?.envFallback);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* هدر و نوار عملیات */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2.5">
          <h1 className="text-lg font-extrabold leading-snug text-slate-900 sm:text-xl lg:text-2xl">
            مرکز فرماندهی قیمت‌گذاری، کشف کف و سقف بازار و ۳ سیستم تخفیف
          </h1>

          {/* وضعیت سرویس‌ها در قالب چیپ‌های خوانا */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 transition hover:border-slate-300"
            >
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              <span>استعلام بعدی:</span>
              <b className="text-slate-900">{faDate(nextRun)}</b>
            </Link>

            <Link
              href="/settings"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${
                aiStatus.ai.configured
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${aiStatus.ai.configured ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span>
                هوش مصنوعی:{" "}
                {aiStatus.ai.configured
                  ? `${aiStatus.ai.model} (${aiStatus.ai.source === "db" ? "پنل" : ".env"})`
                  : "غیرفعال"}
              </span>
            </Link>

            <Link
              href="/settings"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${
                aiStatus.subq.configured
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${aiStatus.subq.configured ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span>
                ناظر SubQ:{" "}
                {aiStatus.subq.configured
                  ? `${aiStatus.subq.model} (${aiStatus.subq.source === "db" ? "پنل" : ".env"})`
                  : "موتور آنی محلی"}
              </span>
            </Link>

            <Link
              href="/settings"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${
                storeConnected
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${storeConnected ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span>
                فروشگاه:{" "}
                {storeStatus?.activeType
                  ? `متصل (${storeStatus.activeType})`
                  : storeStatus?.envFallback
                    ? "متصل (env sgeooole)"
                    : "قطع"}
              </span>
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link href="/campaigns" className="btn-secondary flex-1 sm:flex-initial">
            🎛️ استودیو تخفیف
          </Link>
          <Link href="/simulate" className="btn-secondary flex-1 sm:flex-initial">
            🧪 آزمایشگاه شبیه‌ساز
          </Link>
          <div className="w-full sm:w-auto">
            <RunButton label="استعلام کارت‌های فعال" className="btn-primary w-full sm:w-auto" />
          </div>
        </div>
      </div>

      {/* اجرای سریع روی رنج کارت‌ها (روی موبایل جمع‌شونده برای دسترسی فوری به آمار) */}
      <CardRangeRunner totalCards={total} defaultCollapsedOnMobile />

      {/* کارت‌های KPI */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat title="کل کارت‌های محصول" value={faNum(total)} href="/products" accent="indigo" />
        <Stat title="در انتظار بازبینی" value={faNum(pending)} href="/review" tone={pending > 0 ? "amber" : "default"} />
        <Stat title="نیازمند توجه" value={faNum(needsReview)} href="/review" tone={needsReview > 0 ? "amber" : "default"} />
        <Stat title="زمان‌بندی‌های فعال" value={faNum(sch.length)} href="/settings" accent="emerald" />
      </div>

      {/* وضعیت ۳ سیستم تخفیف */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {(["flash", "featured", "timed_sale", "none"] as const).map((t) => {
          const s = campaignStats.find((c) => (c.campaign ?? "none") === t);
          return (
            <Link key={t} href="/campaigns" className="card block transition hover:shadow-md active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <span className={`badge border text-[11px] sm:text-xs ${campaignColor[t] ?? "bg-slate-100"}`}>
                  {campaignLabel[t]}
                </span>
              </div>
              <div className="num mt-3 text-xl font-bold text-slate-900 sm:text-2xl">{faNum(s?.c ?? 0)} کارت</div>
              <div className="mt-1 text-[11px] text-slate-500 sm:text-xs">
                میانگین تخفیف سقف به کف: <b className="num">{pct(s?.avg ? Number(s.avg) : null, 0)}</b>
              </div>
            </Link>
          );
        })}
      </div>

      {/* بخش آخرین تصمیم‌های موتور (واکنش‌گرا + فیلتر و جستجو) */}
      <DashboardDecisionsSection decisions={serializedDecisions} />

      {/* اجراهای اخیر و لاگ فعالیت */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">اجراهای اخیر</h2>
            <Link href="/runs" className="text-xs font-medium text-indigo-600 hover:underline">
              مشاهده همه
            </Link>
          </div>
          <ul className="space-y-2 text-sm">
            {recentRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/runs?run=${r.id}`}
                  className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 transition hover:bg-indigo-50/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num font-semibold text-slate-800">#{r.id}</span>
                    <span className="text-xs text-slate-600">
                      {r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API"} · {faDate(r.startedAt)}
                    </span>
                    <span className={`badge text-[11px] ${statusColor[r.status] ?? "bg-slate-100"}`}>
                      {statusLabel[r.status] ?? r.status}
                    </span>
                  </div>
                  <span className="num text-xs text-slate-500">
                    {faNum(r.applied)} اعمال / {faNum(r.pendingReview)} بازبینی / {faNum(r.failed)} خطا
                  </span>
                </Link>
              </li>
            ))}
            {!recentRuns.length && <li className="py-4 text-center text-xs text-slate-400">اجرایی ثبت نشده</li>}
          </ul>
        </div>

        <div className="card">
          <h2 className="mb-3 font-bold text-slate-900">لاگ فعالیت</h2>
          <ul className="space-y-2.5 text-xs">
            {logs.map((l) => (
              <li key={l.id} className="rounded-xl bg-slate-50/80 px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`badge ${
                      l.level === "error"
                        ? "bg-rose-100 text-rose-700"
                        : l.level === "warn"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-200/70 text-slate-700"
                    }`}
                  >
                    {l.scope}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-slate-400">{faDate(l.createdAt)}</span>
                </div>
                <p className="break-words leading-5 text-slate-700">{l.message}</p>
              </li>
            ))}
            {!logs.length && <li className="py-4 text-center text-xs text-slate-400">لاگی ثبت نشده</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  href,
  tone = "default",
  accent,
}: {
  title: string;
  value: string;
  href: string;
  tone?: "default" | "amber";
  accent?: "indigo" | "emerald";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-300 bg-amber-50/80"
      : accent === "indigo"
        ? "border-r-4 border-r-indigo-500"
        : accent === "emerald"
          ? "border-r-4 border-r-emerald-500"
          : "";

  return (
    <Link href={href} className={`card block transition hover:shadow-md active:scale-[0.98] ${toneClass}`}>
      <div className="text-xs font-medium text-slate-500">{title}</div>
      <div className="num mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">{value}</div>
    </Link>
  );
}
