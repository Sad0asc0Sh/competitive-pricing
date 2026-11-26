"use client";

import { CollapsibleSection } from "./ui";

export interface DocsTocItem {
  id: string;
  text: string;
}

export function DocsClient({ html, toc }: { html: string; toc: DocsTocItem[] }) {
  const tocLinks = (
    <ul className="space-y-1.5 text-xs">
      {toc.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className="block rounded-lg px-2.5 py-1.5 leading-5 text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-700"
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      {toc.length > 0 && (
        <div className="xl:hidden">
          <CollapsibleSection title="فهرست مطالب مستندات" subtitle={`${toc.length.toLocaleString("fa-IR")} بخش`} defaultOpen={false}>
            {tocLinks}
          </CollapsibleSection>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_250px] xl:items-start">
        <article className="card prose-fa max-w-none min-w-0">
          <div dangerouslySetInnerHTML={{ __html: html }} />
          <div className="mt-8 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="btn-secondary btn-sm"
            >
              ↑ بازگشت به بالای صفحه
            </button>
          </div>
        </article>

        {toc.length > 0 && (
          <aside className="card hidden xl:sticky xl:top-20 xl:block">
            <div className="mb-2.5 text-xs font-bold text-slate-900">فهرست سرفصل‌ها</div>
            {tocLinks}
          </aside>
        )}
      </div>
    </div>
  );
}
