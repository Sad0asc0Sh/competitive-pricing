import type { ListingPanel } from "@/lib/pricing/listing";

export function ListingLinks({ panels }: { panels: ListingPanel[] }) {
  if (!panels.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {panels.map(({ prk, sellerCount }, i) => (
        <a key={prk} href={`https://torob.com/p/${encodeURIComponent(prk)}/`} target="_blank" rel="noreferrer"
          className="font-medium text-indigo-700 underline underline-offset-4">
          {sellerCount === 1 ? "پنل تک‌فروشنده" : sellerCount ? `پنل ادغام · ${sellerCount.toLocaleString("fa-IR")} فروشنده` : "پنل ترب"}
          {panels.length > 1 && ` (${(i + 1).toLocaleString("fa-IR")})`} ↗
        </a>
      ))}
    </div>
  );
}
