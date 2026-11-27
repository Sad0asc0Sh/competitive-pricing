import { faDate, faNum, torobStatusLabel } from "@/lib/format";
import type {
  AdminDiscoveryState,
  DiscoveryCardClassification,
  DiscoveryRetrievalOrigin,
  PanelCompetitiveEvidence,
  PanelGroupRole,
  TorobCoverageDiagnostics,
  TorobDataOrigin,
  TorobInquiryAudit,
  TorobOfferEvidence,
  TorobOfferIdentity,
  TorobPrkDiagnostic,
} from "@/lib/pricing/types";

const adminStateMeta: Record<AdminDiscoveryState, { label: string; cls: string }> = {
  never_discovered: { label: "کشف‌نشده", cls: "bg-slate-100 text-slate-700" },
  discovered_not_inspected: { label: "کشف‌شده (بدون بررسی جزئیات)", cls: "bg-sky-50 text-sky-900" },
  inspected_insufficient_evidence: { label: "بررسی‌شده — شواهد ناکافی", cls: "bg-amber-50 text-amber-900" },
  confirmed_compatible: { label: "هم‌هویت تأییدشده", cls: "bg-emerald-50 text-emerald-800" },
  confirmed_incompatible: { label: "ناسازگار تأییدشده", cls: "bg-rose-50 text-rose-800" },
};

const classificationLabels: Record<DiscoveryCardClassification, string> = {
  CONFIRMED_COMPATIBLE: "سازگار قطعی",
  POTENTIAL_MATCH: "نامزد بالقوه",
  CONFIRMED_INCOMPATIBLE: "ناسازگار قطعی",
  NOT_YET_INSPECTED: "در انتظار بررسی",
};

const retrievalOriginLabels: Record<DiscoveryRetrievalOrigin, string> = {
  search: "جست‌وجو",
  similar_products: "کالاهای مشابه",
  known_prk: "گراف شناخته‌شده",
  hybrid_index: "نمایه ترکیبی",
  direct_prk: "PRK مستقیم",
};

const groupRoleMeta: Record<PanelGroupRole, { label: string; cls: string; groupTitle: string }> = {
  primary: { label: "پنل مرجع اصلی", cls: "bg-emerald-100 text-emerald-900", groupTitle: "پنل‌های منتخب بازار" },
  compatible_secondary: { label: "پنل سازگار تکمیلی", cls: "bg-cyan-100 text-cyan-900", groupTitle: "پنل‌های منتخب بازار" },
  self_only: { label: "فقط فروشگاه خودمان", cls: "bg-amber-100 text-amber-900", groupTitle: "فقط فروشگاه خودمان (فاقد رقیب مستقل)" },
  review_required: { label: "نیازمند بازبینی", cls: "bg-amber-50 text-amber-900 border border-amber-200", groupTitle: "نامزدهای نیازمند بررسی" },
  rejected: { label: "ردشده / ناسازگار", cls: "bg-rose-100 text-rose-800", groupTitle: "کارت‌های ردشده" },
};

const evidenceSourceLabels: Record<string, string> = {
  product_details: "جزئیات کارت ترب",
  search_card: "عنوان جست‌وجو",
  seller_listing: "عنوان فروشنده",
  card_title: "عنوان کارت",
  card_specs: "جدول مشخصات",
  seller_corroboration: "تأیید متقاطع فروشندگان",
  admin_confirmation: "تأیید مدیر",
};

export function TorobPanelComparison({ panels }: { panels?: PanelCompetitiveEvidence[] }) {
  if (!panels?.length) return null;
  const groups: Array<{ key: string; title: string; items: PanelCompetitiveEvidence[] }> = [
    {
      key: "selected",
      title: "پنل‌های منتخب بازار (مرجع قیمت‌گذاری)",
      items: panels.filter((p) => p.groupRole === "primary" || p.groupRole === "compatible_secondary"),
    },
    {
      key: "self",
      title: "کارت‌های فقط فروشگاه خودمان (حذف از کف رقبا)",
      items: panels.filter((p) => p.groupRole === "self_only"),
    },
    {
      key: "review",
      title: "نامزدهای نیازمند بازبینی",
      items: panels.filter((p) => !p.groupRole || p.groupRole === "review_required"),
    },
    {
      key: "rejected",
      title: "کارت‌های ردشده (واریانت/محصول متفاوت)",
      items: panels.filter((p) => p.groupRole === "rejected"),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900">مقایسه و تشخیص پنل‌های ترب ({faNum(panels.length)} کارت)</span>
        <span className="text-[11px] text-slate-500">تفکیک فروشگاه خودمان، رقبای مستقل تأییدشده و واریانت‌های نیازمند بازبینی</span>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-600">{group.title}</div>
          <div className="space-y-1.5">
            {group.items.map((p) => {
              const role = groupRoleMeta[p.groupRole ?? "review_required"];
              const cov = coverageLabels[p.coverageStatus];
              const pctScore = p.score != null ? Math.round(p.score) : Math.round(p.matchConfidence * 100);
              return (
                <div key={p.prk} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className={`badge ${role.cls}`}>{role.label}</span>
                      <span className="badge bg-slate-100 text-slate-700">{torobStatusLabel[p.identityStatus]} ({faNum(pctScore)}٪)</span>
                      <span className={`badge ${cov.cls}`}>{cov.label}</span>
                      {p.offersTruncated && <span className="badge bg-amber-100 text-amber-900">برش‌خورده (Truncated)</span>}
                    </div>
                    <a
                      href={p.url ?? `https://torob.com/p/${encodeURIComponent(p.prk)}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="num shrink-0 font-mono text-[11px] text-indigo-700 underline"
                    >
                      PRK: {p.prk}
                    </a>
                  </div>
                  <div className="font-semibold text-slate-900">{p.title || "بدون عنوان"}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 num">
                    <span>گزارش‌شده در ترب: <strong>{p.reportedSellerCount == null ? "نامشخص" : faNum(p.reportedSellerCount)}</strong></span>
                    <span>استخراج‌شده: <strong>{faNum(p.extractedOfferCount)}</strong></span>
                    <span>فروشگاه خودمان: <strong className={p.ownStoreOfferCount > 0 ? "text-amber-800" : ""}>{faNum(p.ownStoreOfferCount)}</strong></span>
                    <span>رقبای مستقل یکتا: <strong>{faNum(p.uniqueExternalSellerCount)}</strong></span>
                    <span>رقبای تأییدشده: <strong className="text-emerald-800">{faNum(p.confirmedCompetitorCount)}</strong></span>
                    {p.reviewRequiredCompetitorCount > 0 && <span>نیازمند بررسی: <strong className="text-amber-800">{faNum(p.reviewRequiredCompetitorCount)}</strong></span>}
                    {p.rejectedCompetitorCount > 0 && <span>ردشده: <strong className="text-rose-800">{faNum(p.rejectedCompetitorCount)}</strong></span>}
                    {p.freshness && <span>تازه‌ترین پیشنهاد: <strong>{faDate(p.freshness)}</strong></span>}
                  </div>
                  {(p.discoveringQueries?.length || p.evidenceSources?.length) ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {p.discoveringQueries && p.discoveringQueries.length > 0 && (
                        <span>پرس‌وجوها: {p.discoveringQueries.join("، ")}</span>
                      )}
                      {p.evidenceSources && p.evidenceSources.length > 0 && (
                        <span>منابع شواهد: {p.evidenceSources.map((s) => evidenceSourceLabels[s] ?? s).join(" · ")}</span>
                      )}
                    </div>
                  ) : null}
                  {(p.selectionReason || p.exclusionReason) && (
                    <p className="text-[11px] leading-5 text-slate-700">
                      <strong>{p.selectionReason ? "دلیل انتخاب:" : "دلیل عدم انتخاب/جداسازی:"}</strong>{" "}
                      {p.selectionReason ?? p.exclusionReason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const coverageLabels: Record<TorobCoverageDiagnostics["status"], { label: string; cls: string }> = {
  complete_within_scope: { label: "تکمیل‌شده در محدودهٔ جست‌وجو", cls: "bg-emerald-50 text-emerald-800" },
  partial: { label: "پوشش جزئی", cls: "bg-amber-50 text-amber-900" },
  uncertain: { label: "پوشش نیازمند بررسی", cls: "bg-amber-50 text-amber-900" },
  unavailable: { label: "منبع در دسترس نیست", cls: "bg-rose-50 text-rose-800" },
};

const stoppingLabels: Record<TorobCoverageDiagnostics["stoppingReason"], string> = {
  scope_completed: "پایان محدودهٔ طراحی‌شده",
  confirmed_consolidated: "تأیید کارت متمرکز",
  time_budget: "اتمام بودجهٔ زمانی",
  request_budget: "اتمام سقف درخواست",
  plateau: "توقف به‌دلیل نبود نتیجهٔ جدید",
  response_truncated: "برش خروجی جست‌وجو",
  source_unavailable: "اختلال موقت منبع",
  access_restricted: "محدودیت دسترسی",
  direct_prk_lookup: "استعلام مستقیم PRK",
};

const transportLabels: Record<TorobDataOrigin, string> = {
  torob_mcp: "MCP ترب",
  torob_api: "API ترب",
  torob_page: "صفحهٔ محصول ترب",
};
const sourceLabels: Record<TorobOfferIdentity["sources"][number], string> = {
  seller_listing: "عنوان فروشنده",
  seller_specs: "مشخصات فروشنده",
  product_details: "جزئیات کارت",
  search_card: "عنوان کارت در جست‌وجو",
};
const specLabels: Record<string, string> = {
  frequency: "فرکانس", buttons: "تعداد دکمه", bluetooth: "بلوتوث", access_model: "مدل",
  volt: "ولتاژ", cap: "ظرفیت", ch: "تعداد کانال", ports: "تعداد پورت", mp: "مگاپیکسل",
};

function specValue(key: string, value: string | number): string {
  if (key === "bluetooth") return value === "yes" ? "دارد" : "ندارد";
  if (key === "frequency" && typeof value === "number") {
    if (value >= 1_000_000) return `${faNum(value / 1_000_000, 3)} مگاهرتز`;
    if (value >= 1_000) return `${faNum(value / 1_000, 3)} کیلوهرتز`;
    return `${faNum(value)} هرتز`;
  }
  return typeof value === "number" ? faNum(value) : value;
}

function Specs({ specs, expected }: Pick<TorobOfferIdentity, "specs"> & { expected?: TorobOfferIdentity["expectedSpecs"] }) {
  const fields = [...new Set([...Object.keys(specs ?? {}), ...Object.keys(expected ?? {})])];
  if (!fields.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {fields.map((key) => {
        const actual = specs?.[key] ?? [];
        const wanted = expected?.[key] ?? [];
        const tone = !wanted.length ? "" : !actual.length ? "text-amber-800" :
          actual.length === wanted.length && actual.every((value) => wanted.includes(value)) ? "text-emerald-800" : "text-rose-800";
        return <li key={key} className={tone}>
          <strong>{specLabels[key] ?? key}</strong> · {actual.map((value) => specValue(key, value)).join(" / ") || "ذکر نشده"}
          {wanted.length > 0 && <span> · محصول سایت {wanted.map((value) => specValue(key, value)).join(" / ")}</span>}
        </li>;
      })}
    </ul>
  );
}

function ImageLinks({ urls }: { urls?: string[] }) {
  const images = urls?.filter((url) => typeof url === "string" && url.startsWith("https://"));
  if (!images?.length) return null;
  return <div className="flex flex-wrap gap-3">
    {images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">تصویر {faNum(index + 1)}</a>)}
  </div>;
}

export function TorobOfferDetails({ evidence }: { evidence: TorobOfferEvidence }) {
  const identity = evidence.identity;
  if (!identity) return null;
  const color = identity.status === "MATCH_CONFIRMED" ? "bg-emerald-50 text-emerald-800" :
    identity.status === "REVIEW_REQUIRED" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800";
  return (
    <details className="mt-1 max-w-lg text-xs whitespace-normal text-slate-700">
      <summary className="cursor-pointer">
        <span className={`badge ${color}`}>{torobStatusLabel[identity.status]}</span>
        {identity.identityScore != null && <span className="mr-1.5 text-[11px] text-slate-500 num">({faNum(Math.round(identity.identityScore))}٪)</span>}
      </summary>
      <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 leading-5">
        <p>{identity.reason}</p>
        <div className="flex flex-wrap gap-x-2">
          <a className="text-indigo-700 underline" href={`https://torob.com/p/${encodeURIComponent(identity.prk)}/`} target="_blank" rel="noreferrer">کارت ترب</a>
          {identity.origin && <span>{transportLabels[identity.origin]}</span>}
          {identity.sources.map((source) => <span key={source}>{sourceLabels[source]}</span>)}
        </div>
        <Specs specs={identity.specs} expected={identity.expectedSpecs} />
        {Boolean(identity.matchedAttributes?.length) && (
          <p className="text-[11px] text-emerald-800"><strong>ویژگی‌های هم‌تراز:</strong> {identity.matchedAttributes!.join("، ")}</p>
        )}
        {Boolean(identity.missingAttributes?.length) && (
          <p className="text-[11px] text-amber-900"><strong>شواهد نامشخص / نیازمند بررسی:</strong> {identity.missingAttributes!.join("، ")}</p>
        )}
        {Boolean(identity.conflictingAttributes?.length) && (
          <p className="text-[11px] text-rose-800"><strong>تعارض‌های فنی:</strong> {identity.conflictingAttributes!.join("، ")}</p>
        )}
        {Boolean(identity.brands?.length || identity.models?.length) && <p dir="auto">{[...(identity.brands ?? []), ...(identity.models ?? [])].join(" · ")}</p>}
        {identity.packageUnits != null && <p>تعداد در بسته · {faNum(identity.packageUnits)}</p>}
        {identity.sharedImage && <p>نشانی تصویر مشترک در کارت و پیشنهاد فروشنده ثبت شد.</p>}
        <ImageLinks urls={evidence.imageUrls} />
      </div>
    </details>
  );
}

function DiscoveryDiagnosticsSection({ diagnostics }: { diagnostics?: TorobPrkDiagnostic[] }) {
  if (!diagnostics?.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900">وضعیت کشف و ارزیابی تک‌تک کارت‌ها ({faNum(diagnostics.length)} PRK)</span>
        <span className="text-[11px] text-slate-500">تفکیک منشأ کشف، عنوان فروشندگان، شواهد هم‌تراز و دلیل شمول/رد</span>
      </div>
      <div className="space-y-2">
        {diagnostics.map((d) => {
          const stateStyle = adminStateMeta[d.adminState];
          return (
            <details key={d.prk} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className={`badge ${stateStyle.cls}`}>{stateStyle.label}</span>
                  <span className="badge bg-slate-100 text-slate-700">{classificationLabels[d.classification]}</span>
                  <span className="badge bg-indigo-50 text-indigo-800">{retrievalOriginLabels[d.retrievalOrigin]}</span>
                  <strong className="text-slate-900">{d.canonicalCardTitle || "بدون عنوان متعارف"}</strong>
                </div>
                <span className="num font-mono text-[11px] text-slate-600">PRK: {d.prk}</span>
              </summary>
              <div className="mt-2 space-y-1.5 leading-5 text-[11px]">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-600 num">
                  <span>تکمیل استعلام جزئیات: <strong>{d.inspectionCompleted ? "بله" : "خیر"}</strong></span>
                  {d.candidateInspectionPriority != null && <span>اولویت بررسی: <strong>{faNum(d.candidateInspectionPriority)}</strong></span>}
                  {d.similarProductSeed && <span>بذر کالاهای مشابه: <strong className="font-mono">{d.similarProductSeed}</strong></span>}
                  <span>فروشندگان تأییدشده: <strong className="text-emerald-800">{faNum(d.confirmedSellerCount)}</strong></span>
                  <span>نیازمند بازبینی: <strong className="text-amber-800">{faNum(d.reviewRequiredSellerCount)}</strong></span>
                  <span>ردشده: <strong className="text-rose-800">{faNum(d.rejectedSellerCount)}</strong></span>
                  <span>رقبای مستقل: <strong>{faNum(d.externalCompetitorCount)}</strong></span>
                </div>
                <p><strong>دلیل شمول یا عدم شمول:</strong> {d.reasonForInclusionOrExclusion}</p>
                {d.sellerSpecificTitles.length > 0 && (
                  <p><strong>عنوان‌های فروشندگان:</strong> {d.sellerSpecificTitles.join(" | ")}</p>
                )}
                {d.technicalAttributeMatches.length > 0 && (
                  <p className="text-emerald-800"><strong>انطباق‌های فنی:</strong> {d.technicalAttributeMatches.join("، ")}</p>
                )}
                {d.missingIdentityEvidence.length > 0 && (
                  <p className="text-amber-900"><strong>شواهد نامشخص/کسری:</strong> {d.missingIdentityEvidence.join("، ")}</p>
                )}
                {d.hardContradictions.length > 0 && (
                  <p className="text-rose-800"><strong>تعارض‌های سخت:</strong> {d.hardContradictions.join("، ")}</p>
                )}
                {d.sellerAssessments && d.sellerAssessments.length > 0 && (
                  <ul className="space-y-1 rounded border border-slate-200 bg-white p-2">
                    {d.sellerAssessments.map((s, idx) => (
                      <li key={`${s.sellerName}-${idx}`} className="border-b border-slate-100 pb-1 last:border-b-0 last:pb-0">
                        <span className="font-semibold text-slate-900">{s.sellerName}</span>
                        {" · "}
                        <span>{torobStatusLabel[s.status]} ({faNum(Math.round(s.identityScore))}٪)</span>
                        {s.sellerListingTitle && <span> · «{s.sellerListingTitle}»</span>}
                        <span className="block text-slate-500">{s.confidenceReason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function TorobSearchDetails({ audit }: { audit?: TorobInquiryAudit }) {
  if (!audit?.search && !audit?.candidate && !audit?.coverage && !audit?.panelEvidence?.length && !audit?.discoveryDiagnostics?.length) return null;
  const queries = audit.search?.queries ?? [];
  const cards = audit.search?.candidates?.length ? audit.search.candidates : audit.candidate ? [audit.candidate] : [];
  const counts = audit.offerIdentityCounts;
  const coverage = audit.coverage ?? audit.search?.coverage;
  const covStyle = coverage ? coverageLabels[coverage.status] : undefined;
  const diagnostics = audit.discoveryDiagnostics ?? audit.search?.discoveryDiagnostics;
  return (
    <details className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
      <summary className="cursor-pointer font-semibold">شواهد جست‌وجو و تطبیق ترب</summary>
      <TorobPanelComparison panels={audit?.panelEvidence} />
      <DiscoveryDiagnosticsSection diagnostics={diagnostics} />
      {coverage && covStyle && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${covStyle.cls}`}>{covStyle.label}</span>
            <span>حالت: {coverage.mode === "extended" ? "توسعه‌یافته" : "تعاملی"}</span>
            <span>توقف: {stoppingLabels[coverage.stoppingReason]}</span>
          </div>
          <p className="text-slate-600">
            {faNum(coverage.queriesExecuted)}/{faNum(coverage.queriesGenerated)} پرس‌وجو ·{" "}
            {faNum(coverage.pagesRequested)} صفحه بررسی‌شده ({faNum(coverage.pagesRemaining)} صفحه باقی‌مانده) ·{" "}
            {faNum(coverage.uniquePrksDiscovered)} PRK یکتا ({faNum(coverage.candidatePrksInspected)} بررسی‌شده،{" "}
            {faNum(coverage.promisingUninspectedCount)} موردِ مستعدِ بررسی‌نشده) ·{" "}
            {faNum(coverage.apiRequestsMade)} درخواست API (کش {faNum(Math.round(coverage.cacheHitRate * 100))}٪)
          </p>
          {coverage.limitations.length > 0 && (
            <ul className="list-inside list-disc text-amber-900">
              {coverage.limitations.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </div>
      )}
      {counts && <p>
        {faNum(counts.MATCH_CONFIRMED)} پیشنهاد هم‌هویت · {faNum(counts.REVIEW_REQUIRED)} نیازمند بررسی · {faNum(counts.IDENTITY_MISMATCH)} نامنطبق
      </p>}
      {queries.length > 0 && <ol className="space-y-1">
        {queries.map((query, index) => <li key={query.query}>
          {faNum(index + 1)}. {query.query} · {faNum(query.mapped)} کارت
          {query.origin && <span> · {transportLabels[query.origin]}</span>}
          {query.issue && <span className="text-amber-800"> · {query.issue}</span>}
        </li>)}
      </ol>}
      <div className="space-y-1.5">
        {cards.map((card) => {
          const selected = audit.candidate?.prk === card.prk;
          const inspection = card.inspection;
          const observed = inspection ?? card;
          const title = card.titleFa || card.titleEn || "عنوان کارت دریافت نشد";
          return (
            <details key={card.prk} className="rounded-lg border border-slate-200 bg-white p-2">
              <summary className="cursor-pointer leading-5">
                <strong>{title}</strong> · {torobStatusLabel[observed.status]}{selected && " · کارت منتخب"}
              </summary>
              <div className="mt-2 space-y-2 leading-5">
                {card.titleFa && card.titleEn && <p dir="auto">{card.titleEn}</p>}
                {card.queries.length > 0 && <p>عبارت‌های جست‌وجو · {[...new Set(card.queries)]
                  .map((index) => queries[index - 1]?.query).filter(Boolean).join("، ")}</p>}
                {card.observations?.some(({ titleFa, titleEn }) => titleFa !== card.titleFa || titleEn !== card.titleEn) &&
                  <ul>{card.observations.map(({ query, titleFa, titleEn }, i) => <li key={i}>{faNum(query)} · {[titleFa, titleEn].filter(Boolean).join(" / ") || "عنوان دریافت نشد"}</li>)}</ul>}
                {inspection && <p>عنوان در جزئیات · {[inspection.titleFa, inspection.titleEn].filter(Boolean).join(" / ") || "دریافت نشد"}</p>}
                {observed.origin && <p>{transportLabels[observed.origin]}</p>}
                {!inspection && card.extraction === "not_requested" && <p>جزئیات این کارت در محدودهٔ استعلام دریافت نشد.</p>}
                <Specs specs={observed.specs} />
                <ImageLinks urls={observed.imageUrls} />
                {observed.reasons.length > 0 && <ul className="list-inside list-disc">{observed.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}
