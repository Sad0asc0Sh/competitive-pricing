import { db } from "@/db";
import { products } from "@/db/schema";
import { CardRangeRunner, RunButton } from "@/components/actions";
import { ProductForm } from "@/components/product-form";
import { campaignColor, campaignLabel, faDate, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { asc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const rows = await db.select().from(products).orderBy(asc(products.id));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">مدیریت کارت‌های محصول و رنج‌های تخفیف</h1>
          <p className="mt-1 text-xs text-slate-500">
            هر محصول دارای یک شماره کارت (`کارت #۱`، `کارت #۲` و ...) است که می‌توانید در نوار زیر یا در صفحه «کمپین‌ها»، استعلام سقف و کف و اعمال تخفیف را روی رنج دلخواهی از کارت‌ها اجرا کنید.
          </p>
        </div>
        <RunButton label="استعلام و بروزرسانی همه کارت‌ها" />
      </div>

      <CardRangeRunner totalCards={rows.length} />

      <div className="card">
        <h2 className="mb-3 font-bold">افزودن کارت محصول جدید</h2>
        <ProductForm />
      </div>

      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th># کارت</th>
              <th>محصول</th>
              <th>منبع</th>
              <th>تمام‌شده / کف امن</th>
              <th>سقف معیار (خط‌خورده)</th>
              <th>کف قطعی فروش</th>
              <th>درصد تخفیف</th>
              <th>سیستم تخفیف فعال</th>
              <th>آخرین استعلام</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, idx) => (
              <tr key={p.id}>
                <td className="num">
                  <span className="badge bg-slate-100 text-slate-700 font-bold">کارت #{idx + 1}</span>
                </td>
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
                <td className="num">{toman(p.costPrice || p.currentHardFloorPrice)}</td>
                <td className="num line-through decoration-slate-400">{toman(p.currentBasePrice)}</td>
                <td className="num font-bold text-emerald-700">{toman(p.currentFinalPrice)}</td>
                <td className="num font-bold text-rose-600">{pct(p.currentDiscountPct, 0)}</td>
                <td>
                  <div className="flex flex-col gap-1">
                    <span className={`badge border ${campaignColor[p.currentCampaign ?? "none"] ?? "bg-slate-100"}`}>
                      {p.currentCampaignName || campaignLabel[p.currentCampaign ?? "none"]}
                    </span>
                    {p.currentShowInFeatured && (
                      <span className="text-[10px] font-medium text-indigo-700">★ در منتخب‌های صفحه اصلی</span>
                    )}
                  </div>
                </td>
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
                <td colSpan={11} className="py-8 text-center text-slate-400">
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
