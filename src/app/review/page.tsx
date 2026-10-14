import { db } from "@/db";
import { priceDecisions, products } from "@/db/schema";
import { DecisionActions } from "@/components/actions";
import { campaignLabel, faDate, pct, toman } from "@/lib/format";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const rows = await db
    .select({ d: priceDecisions, name: products.name, sku: products.sku, cost: products.costPrice, current: products.currentFinalPrice })
    .from(priceDecisions)
    .innerJoin(products, eq(products.id, priceDecisions.productId))
    .where(eq(priceDecisions.status, "pending_review"))
    .orderBy(desc(priceDecisions.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">صف بازبینی انسانی</h1>
        <p className="mt-1 text-sm text-slate-500">
          تصمیم‌هایی که موتور به دلیل اعتماد پایین، کمبود داده، جهش قیمت یا برخورد با کف سود، برای تأیید نگه داشته است.
        </p>
      </div>
      {rows.map(({ d, name, sku, cost, current }) => {
        const reasons = d.steps.find((s) => s.step === "decision")?.message ?? "";
        return (
          <div key={d.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/products/${d.productId}`} className="text-lg font-bold text-indigo-700 hover:underline">
                  {name}
                </Link>
                <div className="text-xs text-slate-400">
                  {sku} · تصمیم #{d.id} · {faDate(d.createdAt)}
                </div>
              </div>
              <DecisionActions decisionId={d.id} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
              <Item k="تمام‌شده" v={toman(cost)} />
              <Item k="قیمت فعلی" v={toman(current)} />
              <Item k="مرجع بازار" v={toman(d.referencePrice)} />
              <Item k="پیشنهاد: اصلی" v={toman(d.basePrice)} />
              <Item k="پیشنهاد: نهایی" v={toman(d.finalPrice)} strong />
              <Item k="تخفیف / کمپین" v={`${pct(d.discountPct)} · ${campaignLabel[d.campaignType ?? "none"]}`} />
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{reasons}</p>
          </div>
        );
      })}
      {!rows.length && <div className="card text-center text-slate-400">صف بازبینی خالی است ✅</div>}
    </div>
  );
}

function Item({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className={`num ${strong ? "font-bold text-emerald-700" : "font-medium"}`}>{v}</div>
    </div>
  );
}
