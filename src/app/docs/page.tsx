import { marked } from "marked";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export default async function DocsPage() {
  const md = await readFile(path.join(process.cwd(), "docs", "PRICING_LOGIC.md"), "utf8");
  const html = await marked.parse(md, { gfm: true });
  return (
    <div className="card prose-fa max-w-5xl">
      <style>{`.prose-fa table{width:100%;font-size:.85rem;margin:1rem 0}.prose-fa th,.prose-fa td{border:1px solid #e2e8f0;padding:.4rem .6rem;text-align:right}.prose-fa th{background:#f8fafc}.prose-fa h1{font-size:1.6rem;font-weight:800;margin-bottom:1rem}.prose-fa blockquote{border-right:4px solid #6366f1;padding-right:1rem;color:#475569;margin:1rem 0}`}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
