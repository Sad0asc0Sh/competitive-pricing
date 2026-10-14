import { db } from "@/db";
import { priceDecisions, priceRuns, products } from "@/db/schema";
import { campaignLabel, faDate, faNum, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const runs = await db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(50);
  const selected = run ? Number(run) : runs[0]?.id;
  const decisions = selected
    ? await db
        .select({ d: priceDecisions, name: products.name, sku: products.sku })
        .from(priceDecisions)
        .innerJoin(products, eq(products.id, priceDecisions.productId))
        .where(eq(priceDecisions.runId, selected))
        .orderBy(desc(priceDecisions.createdAt))
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="card">
        <h1 className="mb-3 text-lg font-bold">اجراها</h1>
        <ul className="space-y-1">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs?run=${r.id}`} className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${selected === r.id ? "bg-indigo-50 text-indigo-800" : ""}`}>
                <div className="flex items-center justify-between">
                  <span>
                    #{r.id} · {r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API"}
                  </span>
                  <span className={`badge ${statusColor[r.status]}`}>{statusLabel[r.status]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {faDate(r.startedAt)} · {faNum(r.totalProducts)} محصول · {faNum(r.applied)}✓ {faNum(r.pendingReview)}⏳ {faNum(r.failed)}✗
                </div>
              </Link>
            </li>
          ))}
          {!runs.length && <li className="text-sm text-slate-400">اجرایی ثبت نشده</li>}
        </ul>
      </div>
      <div className="card overflow-x-auto">
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
            {decisions.map(({ d, name, sku }) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/products/${d.productId}`} className="text-indigo-700 hover:underline">
                    {name}
                  </Link>
                  <div className="text-xs text-slate-400">{sku}</div>
                </td>
                <td>{d.source}</td>
                <td className="num">
                  {faNum(d.offersUsed)}/{faNum(d.offersTotal)}
                </td>
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
            {!decisions.length && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-slate-400">
                  تصمیمی وجود ندارد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
