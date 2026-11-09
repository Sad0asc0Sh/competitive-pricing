"use strict";
/**
 * خلاصه‌سازی تاریخچه قیمت خودی برای مرجع تخفیف own_price_7d.
 *
 * قاعده (۴.۱.۱): «دوام» یعنی هر قیمت تا ردیف بعدی برقرار بوده است — نه اینکه ردیف
 * حداقل ۴۸ ساعت پیش ساخته شده باشد. تصمیم `skipped` (به فروشگاه نرسیده) هرگز مرجع نیست.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeOwnPriceHistory = summarizeOwnPriceHistory;
function summarizeOwnPriceHistory(rows, opts) {
    const now = opts?.now ?? new Date();
    const holdHours = Math.max(0, Number(opts?.holdHours ?? 48) || 0);
    const windowDays = Math.max(1, Number(opts?.windowDays ?? 7) || 7);
    const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
    const usable = rows
        .filter((r) => !r.pushStatus || r.pushStatus === "pushed")
        .filter((r) => {
        const t = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
        return Number.isFinite(t) && t >= windowStart.getTime() && t <= now.getTime();
    })
        .map((r) => ({
        price: Number(r.finalPrice) || 0,
        at: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    }))
        .sort((a, b) => a.at.getTime() - b.at.getTime());
    const holdMs = holdHours * 3_600_000;
    const held = usable
        .map((row, i) => ({
        price: row.price,
        from: row.at,
        to: usable[i + 1]?.at ?? now,
    }))
        .filter((h) => h.price > 0 && h.to.getTime() - h.from.getTime() >= holdMs);
    const priced = usable.filter((r) => r.price > 0);
    const ownStableHigh7d = held.length
        ? Math.max(...held.map((h) => Math.round(h.price)))
        : null;
    const ownAvg7d = priced.length
        ? Math.round(priced.reduce((sum, r) => sum + r.price, 0) / priced.length)
        : null;
    return { ownStableHigh7d, ownAvg7d };
}
