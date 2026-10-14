import { db } from "@/db";
import { activityLogs, priceDecisions, priceRuns, products, schedules } from "@/db/schema";
import { RunButton } from "@/components/actions";
import { campaignLabel, faDate, faNum, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { aiEnabled } from "@/lib/ai/client";
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">داشبورد قیمت‌گذاری</h1>
          <p className="mt-1 text-sm text-slate-500">
            استعلام خودکار بعدی: <b>{faDate(nextRun)}</b> · هوش مصنوعی: {aiEnabled() ? <span className="text-emerald-600">فعال</span> : <span className="text-amber-600">غیرفعال (AI_API_KEY تنظیم نشده)</span>}
          </p>
        </div>
        <RunButton label="استعلام همه محصولات فعال" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat title="محصولات" value={faNum(total)} href="/products" />
        <Stat title="در انتظار بازبینی" value={faNum(pending)} href="/review" tone={pending > 0 ? "amber" : "default"} />
        <Stat title="محصولات نیازمند توجه" value={faNum(needsReview)} href="/review" tone={needsReview > 0 ? "amber" : "default"} />
        <Stat title="زمان‌بندی‌های فعال" value={faNum(sch.length)} href="/settings" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {["flash", "featured", "none"].map((t) => {
          const s = campaignStats.find((c) => (c.campaign ?? "none") === t);
          return (
            <div key={t} className="card">
              <div className="text-xs text-slate-500">{campaignLabel[t]}</div>
              <div className="mt-2 text-2xl font-bold">{faNum(s?.c ?? 0)} محصول</div>
              <div className="text-xs text-slate-500">میانگین تخفیف {pct(s?.avg ? Number(s.avg) : null)}</div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">آخرین تصمیم‌های قیمت</h2>
          <Link href="/runs" className="text-sm text-indigo-600">
            همه اجراها
          </Link>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>محصول</th>
              <th>کف خام</th>
              <th>کف معتبر</th>
              <th>مرجع بازار</th>
              <th>قیمت اصلی</th>
              <th>قیمت نهایی</th>
              <th>تخفیف</th>
              <th>کمپین</th>
              <th>اعتماد</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {recentDecisions.map(({ d, name, sku }) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/products/${d.productId}`} className="text-indigo-700 hover:underline">
                    {name}
                  </Link>
                  <div className="text-xs text-slate-400">{sku}</div>
                </td>
                <td className="num text-slate-400">{toman(d.lowestRaw)}</td>
                <td className="num">{toman(d.lowestValid)}</td>
                <td className="num">{toman(d.referencePrice)}</td>
                <td className="num line-through decoration-slate-400">{toman(d.basePrice)}</td>
                <td className="num font-bold text-emerald-700">{toman(d.finalPrice)}</td>
                <td className="num">{pct(d.discountPct)}</td>
                <td>{campaignLabel[d.campaignType ?? "none"]}</td>
                <td className="num">{pct(d.confidence * 100, 0)}</td>
                <td>
                  <span className={`badge ${statusColor[d.status]}`}>{statusLabel[d.status]}</span>
                </td>
              </tr>
            ))}
            {!recentDecisions.length && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  هنوز تصمیمی ثبت نشده. از صفحه محصولات یک محصول اضافه کنید و «اجرای استعلام» را بزنید.
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
                <span className={`badge ${l.level === "error" ? "bg-rose-100 text-rose-700" : l.level === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{l.scope}</span>
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
