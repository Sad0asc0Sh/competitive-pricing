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

      {/* نمای موبایل محصولات: کارت به‌جای جدول ۱۱ ستونه */}
      <div className="space-y-3 lg:hidden">
        {rows.map((p, idx) => (
          <div key={p.id} className="m-row">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/products/${p.id}`} className="block truncate font-bold text-indigo-700">
                  {p.name}
                </Link>
                <div className="text-xs text-slate-400">
                  کارت #{idx + 1} · {p.sku}
                  {p.category ? ` · ${p.category}` : ""}
                </div>
              </div>
              <span className={`badge ${statusColor[p.status]}`}>{statusLabel[p.status]}</span>
            </div>
            <div className="m-row-kv">
              <span>منبع استعلام</span>
              <span>{p.sourceType === "torob" ? "ترب" : p.sourceType}</span>
            </div>
            <div className="m-row-kv">
              <span>کف قطعی فروش</span>
              <span className="num font-bold text-emerald-700">{toman(p.currentFinalPrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>سقف معیار (خط‌خورده)</span>
              <span className="num line-through decoration-slate-400">{toman(p.currentBasePrice)}</span>
            </div>
            <div className="m-row-kv">
              <span>تخفیف / سیستم</span>
              <span className="num font-bold text-rose-600">
                {pct(p.currentDiscountPct, 0)} · {p.currentCampaignName || campaignLabel[p.currentCampaign ?? "none"]}
              </span>
            </div>
            <div className="m-row-kv">
              <span>آخرین استعلام</span>
              <span className="text-xs">{faDate(p.lastCheckedAt)}</span>
            </div>
            <div className="mt-3">
              <RunButton productIds={[p.id]} label="استعلام این کارت" className="btn-secondary w-full" />
            </div>
          </div>
        ))}
        {!rows.length && <div className="empty-state">محصولی ثبت نشده است</div>}
      </div>

      <div className="card hidden lg:block">
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
                <td>{p.sourceType === "torob" ? "ترب" : p.sourceType}</td>
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
