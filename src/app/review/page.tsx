import { db } from "@/db";
import { priceDecisions, products } from "@/db/schema";
import { DecisionActions } from "@/components/actions";
import { campaignLabel, faDate, pct, toman } from "@/lib/format";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const [rows, rejectedRows] = await Promise.all([
    db
      .select({ d: priceDecisions, name: products.name, sku: products.sku, cost: products.costPrice, current: products.currentFinalPrice })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(eq(priceDecisions.status, "pending_review"))
      .orderBy(desc(priceDecisions.createdAt)),
    db
      .select({ d: priceDecisions, name: products.name, sku: products.sku })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(eq(priceDecisions.status, "rejected"))
      .orderBy(desc(priceDecisions.createdAt))
      .limit(20),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">صف بازبینی انسانی</h1>
        <p className="mt-1 text-sm text-slate-500">
          تصمیم‌هایی که موتور به دلیل اعتماد پایین، کمبود داده، جهش قیمت یا برخورد با کف سود، برای تأیید نگه داشته است.
        </p>
      </div>
      {rows.map(({ d, name, sku, cost, current }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
        const supMsg = steps.find((s) => s.step === "supervisor")?.message;
        const aiMsg = steps.find((s) => s.step === "ai_review")?.message;
        // ۴.۱.۲ (N5): رتبه‌ی رسمی فقط روی فروشنده‌های قابل‌اتکاست؛ رتبه‌ی «با احتساب
        // فروشنده‌های مشکوک/کهنه» کنارش نمایش داده می‌شود تا ریویوور بداند آیا ارزان‌فروش
        // تازه‌ای زیر قیمت ما هست یا نه. برای تصمیم‌های قدیمی از steps می‌خوانیم.
        const positionStep = steps.find((s) => s.step === "position");
        const rankIncludingSuspect =
          d.rankIncludingSuspect ?? (Number(positionStep?.data?.rankIncludingSuspect) || null);
        const totalIncludingSuspect =
          d.totalSellersIncludingSuspect || Number(positionStep?.data?.totalSellersIncludingSuspect) || 0;
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
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-7">
              <Item k="تمام‌شده" v={toman(cost)} />
              <Item k="قیمت فعلی" v={toman(current)} />
              <Item k="مرجع بازار" v={toman(d.referencePrice)} />
              <Item k="پیشنهاد: اصلی" v={toman(d.basePrice)} />
              <Item k="پیشنهاد: نهایی" v={toman(d.finalPrice)} strong />
              <Item k="تخفیف / کمپین" v={`${pct(d.discountPct)} · ${campaignLabel[d.campaignType ?? "none"]}`} />
              <Item
                k="رتبه ملی / با مشکوک"
                v={`${d.projectedNationalRank ?? "—"} / ${rankIncludingSuspect ?? "—"} از ${totalIncludingSuspect || "—"}`}
              />
            </div>
            {d.marketConflict && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                ⚠️ تعارض بازار: فروشنده‌ی «مشکوک پایین» زیر قیمت پیشنهادی ما هست — پیش از تأیید، رتبه‌ی ستون
                «با مشکوک» را با رتبه‌ی رسمی مقایسه کنید.
              </p>
            )}
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{reasons}</p>
            {supMsg && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">🛡️ ناظر: {supMsg}</p>}
            {aiMsg && <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">🤖 هوش مصنوعی: {aiMsg}</p>}
          </div>
        );
      })}
      {!rows.length && <div className="card text-center text-slate-400">صف بازبینی خالی است ✅</div>}

      <div>
        <h2 className="text-lg font-bold">ردشده‌های اخیر ناظر (وارد فروشگاه نمی‌شوند)</h2>
        <p className="mt-1 text-xs text-slate-500">
          تصمیم‌های زیر امتیاز آستانه رد گرفته‌اند و به‌صورت خودکار متوقف شده‌اند؛ دکمه «تأیید و اعمال» برای آن‌ها قفل است.
        </p>
      </div>
      {rejectedRows.map(({ d, name, sku }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const supMsg = steps.find((s) => s.step === "supervisor")?.message ?? "رد توسط ناظر SystemOne";
        return (
          <div key={d.id} className="card border-rose-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/products/${d.productId}`} className="font-bold text-rose-700 hover:underline">
                  {name}
                </Link>
                <div className="text-xs text-slate-400">
                  {sku} · تصمیم #{d.id} · {faDate(d.createdAt)}
                </div>
              </div>
              <span className="badge bg-rose-100 text-rose-700">⛔ ردشده — غیرقابل اعمال</span>
            </div>
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{supMsg}</p>
          </div>
        );
      })}
      {!rejectedRows.length && <div className="card text-center text-xs text-slate-400">مورد ردشده‌ای ثبت نشده</div>}
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
