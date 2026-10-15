import { db } from "@/db";
import { activityLogs, priceDecisions, priceRuns, products, schedules } from "@/db/schema";
import { CardRangeRunner, RunButton } from "@/components/actions";
import { campaignColor, campaignLabel, faDate, faNum, pct, statusColor, statusLabel, strategyLabel, toman } from "@/lib/format";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { getAIStatus } from "@/lib/ai/client";
import { getStoreStatus } from "@/lib/store/connectors";
import { count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await ensureDefaults();
  const [[{ total }], [{ needsReview }], [{ pending }], recentDecisions, recentRuns, logs, sch, campaignStats] = await Promise.all([
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
  const aiStatus = getAIStatus();
  let storeStatus = null;
  try {
    storeStatus = await getStoreStatus();
  } catch {
    storeStatus = null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            مرکز فرماندهی قیمت‌گذاری، کشف کف و سقف بازار و ۳ سیستم تخفیف (sgeooole · ترب و مشهد)
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            استعلام خودکار بعدی: <b>{faDate(nextRun)}</b> · هوش مصنوعی:{" "}
            {aiStatus.aiEnabled ? (
              <span className="text-emerald-600">فعال ({aiStatus.aiModel})</span>
            ) : (
              <span className="text-amber-600">غیرفعال (AI_API_KEY در .env تنظیم نشده)</span>
            )}{" "}
            · ناظر SubQ:{" "}
            {aiStatus.subqEnabled ? (
              <span className="text-emerald-600">متصل ({aiStatus.subqModel})</span>
            ) : (
              <span className="text-slate-500">موتور آنی محلی (SUBQ_API_KEY تنظیم نشده)</span>
            )}{" "}
            · فروشگاه:{" "}
            {storeStatus?.activeType ? (
              <span className="text-emerald-600">متصل ({storeStatus.activeType})</span>
            ) : storeStatus?.envFallback ? (
              <span className="text-emerald-600">متصل (env sgeooole)</span>
            ) : (
              <span className="text-rose-600">قطع — کانکتور یا SGEOOOLE_API_URL را تنظیم کنید</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/campaigns" className="btn-secondary">
            🎛️ استودیو ۳ سیستم تخفیف
          </Link>
          <Link href="/simulate" className="btn-secondary">
            🧪 آزمایشگاه کف و سقف
          </Link>
          <RunButton label="استعلام همه کارت‌های فعال" />
        </div>
      </div>

      {/* اجرای سریع روی رنج کارت‌ها مستقیماً از داشبورد */}
      <CardRangeRunner totalCards={total} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat title="کل کارت‌های محصول" value={faNum(total)} href="/products" />
        <Stat title="در انتظار بازبینی" value={faNum(pending)} href="/review" tone={pending > 0 ? "amber" : "default"} />
        <Stat title="نیازمند توجه" value={faNum(needsReview)} href="/review" tone={needsReview > 0 ? "amber" : "default"} />
        <Stat title="زمان‌بندی‌های فعال" value={faNum(sch.length)} href="/settings" />
      </div>

      {/* وضعیت هر ۳ سیستم تخفیف فروشگاه sgeooole */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {(["flash", "featured", "timed_sale", "none"] as const).map((t) => {
          const s = campaignStats.find((c) => (c.campaign ?? "none") === t);
          return (
            <Link key={t} href="/campaigns" className="card block transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className={`badge border ${campaignColor[t] ?? "bg-slate-100"}`}>{campaignLabel[t]}</span>
              </div>
              <div className="mt-3 text-2xl font-bold num">{faNum(s?.c ?? 0)} کارت</div>
              <div className="mt-1 text-xs text-slate-500">
                میانگین تخفیف سقف به کف: <b>{pct(s?.avg ? Number(s.avg) : null, 0)}</b>
              </div>
            </Link>
          );
        })}
      </div>

      {/* نمای موبایل آخرین تصمیم‌ها: کارت به‌جای جدول ۱۰ ستونه */}
      <div className="space-y-3 md:hidden">
        <h2 className="px-1 font-bold">آخرین تصمیم‌های موتور</h2>
        {recentDecisions.map(({ d, name, sku }) => (
          <div key={d.id} className="m-row">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/products/${d.productId}`} className="block truncate font-bold text-indigo-700">
                  {name}
                </Link>
                <div className="text-xs text-slate-400">{sku}</div>
              </div>
              <span className={`badge ${statusColor[d.status]}`}>{statusLabel[d.status]}</span>
            </div>
            <div className="m-row-kv">
              <span>کف قطعی ما</span>
              <span className="num font-bold text-emerald-700">{toman(d.finalPrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>سقف معیار (خط‌خورده)</span>
              <span className="num line-through decoration-slate-400">{toman(d.basePrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>تخفیف / سیستم</span>
              <span className="num font-bold text-rose-600">
                {pct(d.discountPct, 0)} · {campaignLabel[d.campaignType ?? "none"]}
              </span>
            </div>
            <div className="m-row-kv">
              <span>کف مشهد / ترب</span>
              <span className="num text-xs">
                {toman(d.localLowestValid)} / {toman(d.lowestValid)}
              </span>
            </div>
            <div className="m-row-kv">
              <span>سود خالص</span>
              <span className="num text-xs">
                {toman(d.netProfitToman)} ({pct(d.netMarginPct)})
              </span>
            </div>
          </div>
        ))}
        {!recentDecisions.length && (
          <div className="empty-state">هنوز تصمیمی ثبت نشده. از صفحه محصولات یک محصول اضافه کنید یا رنج کارت‌ها را استعلام کنید.</div>
        )}
      </div>

      <div className="card hidden md:block">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">
            آخرین تصمیم‌های موتور (کشف سقف واقعی بازار بدون پرت → اعمال درصد تخفیف روی کف رقابتی)
          </h2>
          <Link href="/runs" className="text-sm text-indigo-600">
            همه اجراها
          </Link>
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
            {recentDecisions.map(({ d, name, sku }) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/products/${d.productId}`} className="text-indigo-700 hover:underline font-medium">
                    {name}
                  </Link>
                  <div className="text-xs text-slate-400">{sku}</div>
                </td>
                <td className="num text-amber-700 font-medium">{toman(d.hardFloorPrice ?? d.effectiveCostPrice)}</td>
                <td className="num text-xs">
                  مشهد: {toman(d.localLowestValid)}
                  <br />
                  ترب: {toman(d.lowestValid)}
                </td>
                <td className="num line-through decoration-slate-400">{toman(d.basePrice)}</td>
                <td className="num font-bold text-rose-600">{pct(d.discountPct, 0)}</td>
                <td className="num font-bold text-emerald-700">{toman(d.finalPrice)}</td>
                <td>
                  <span className={`badge border ${campaignColor[d.campaignType ?? "none"] ?? "bg-slate-100"}`}>
                    {d.campaignName || campaignLabel[d.campaignType ?? "none"]}
                  </span>
                  {d.showInFeatured && (
                    <div className="mt-0.5 text-[10px] font-medium text-indigo-700">★ منتخب صفحه اصلی</div>
                  )}
                </td>
                <td className="num">
                  <span className="badge bg-indigo-50 text-indigo-800">
                    مشهد #{faNum(d.projectedLocalRank ?? 1)} | ترب #{faNum(d.projectedNationalRank ?? 1)}
                  </span>
                </td>
                <td className="num text-xs font-medium">
                  {toman(d.netProfitToman)} ({pct(d.netMarginPct)})
                </td>
                <td>
                  <span className={`badge ${statusColor[d.status]}`}>{statusLabel[d.status]}</span>
                </td>
              </tr>
            ))}
            {!recentDecisions.length && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  هنوز تصمیمی ثبت نشده. از صفحه محصولات یک محصول اضافه کنید یا از نوار بالا رنج کارت‌ها را استعلام کنید.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-bold">اجراهای اخیر</h2>
          <ul className="space-y-2 text-sm">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span>
                  #{r.id} · {r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API"} · {faDate(r.startedAt)}
                </span>
                <span className="text-xs text-slate-500">
                  {faNum(r.applied)} اعمال / {faNum(r.pendingReview)} بازبینی / {faNum(r.failed)} خطا
                </span>
              </li>
            ))}
            {!recentRuns.length && <li className="text-slate-400">اجرایی ثبت نشده</li>}
          </ul>
        </div>
        <div className="card">
          <h2 className="mb-3 font-bold">لاگ فعالیت</h2>
          <ul className="space-y-2 text-xs">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span
                  className={`badge ${
                    l.level === "error"
                      ? "bg-rose-100 text-rose-700"
                      : l.level === "warn"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {l.scope}
                </span>
                <span className="text-slate-700">{l.message}</span>
                <span className="mr-auto whitespace-nowrap text-slate-400">{faDate(l.createdAt)}</span>
              </li>
            ))}
            {!logs.length && <li className="text-slate-400">لاگی ثبت نشده</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value, href, tone = "default" }: { title: string; value: string; href: string; tone?: "default" | "amber" }) {
  return (
    <Link href={href} className={`card block transition hover:shadow-md ${tone === "amber" ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-bold num">{value}</div>
    </Link>
  );
}
