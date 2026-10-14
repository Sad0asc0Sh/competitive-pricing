import { db } from "@/db";
import { products } from "@/db/schema";
import { RunButton } from "@/components/actions";
import { ProductForm } from "@/components/product-form";
import { campaignLabel, faDate, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">محصولات</h1>
        <RunButton label="استعلام همه" />
      </div>

      <div className="card">
        <h2 className="mb-3 font-bold">افزودن محصول</h2>
        <ProductForm />
      </div>

      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>محصول</th>
              <th>منبع</th>
              <th>تمام‌شده</th>
              <th>قیمت اصلی</th>
              <th>قیمت نهایی</th>
              <th>تخفیف</th>
              <th>کمپین</th>
              <th>آخرین استعلام</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/products/${p.id}`} className="font-medium text-indigo-700 hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {p.sku}
                    {p.category ? ` · ${p.category}` : ""}
                  </div>
                </td>
                <td>{p.sourceType === "torob" ? "ترب" : p.sourceType === "mock" ? "شبیه‌ساز" : p.sourceType}</td>
                <td className="num">{toman(p.costPrice)}</td>
                <td className="num line-through decoration-slate-400">{toman(p.currentBasePrice)}</td>
                <td className="num font-bold text-emerald-700">{toman(p.currentFinalPrice)}</td>
                <td className="num">{pct(p.currentDiscountPct)}</td>
                <td>{campaignLabel[p.currentCampaign ?? "none"]}</td>
                <td className="text-xs">{faDate(p.lastCheckedAt)}</td>
                <td>
                  <span className={`badge ${statusColor[p.status]}`}>{statusLabel[p.status]}</span>
                </td>
                <td>
                  <RunButton productIds={[p.id]} label="استعلام" className="btn-secondary" />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  محصولی ثبت نشده است
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
