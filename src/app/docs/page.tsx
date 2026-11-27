import { DocsClient, type DocsTocItem } from "@/components/docs-client";
import { marked } from "marked";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function renderPricingDocs(md: string): Promise<{ html: string; toc: DocsTocItem[] }> {
  const rawHtml = await marked.parse(md, { gfm: true });
  const toc: DocsTocItem[] = [];
  let idx = 0;

  const withIds = rawHtml.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner: string) => {
    idx += 1;
    const id = `sec-${idx}`;
    const text = stripHtmlTags(inner);
    if (text) toc.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });

  const html = withIds.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="docs-table-wrap"><table>$1</table></div>');
  return { html, toc };
}

export default async function DocsPage() {
  let md: string;
  try {
    md = await readFile(path.join(process.cwd(), "docs", "PRICING_LOGIC.md"), "utf8");
  } catch {
    md = "## مستندات منطق قیمت‌گذاری\n\nفایل مستندات (`docs/PRICING_LOGIC.md`) در محیط فعلی در دسترس نیست.";
  }
  const { html, toc } = await renderPricingDocs(md);

  return <DocsClient html={html} toc={toc} />;
}
