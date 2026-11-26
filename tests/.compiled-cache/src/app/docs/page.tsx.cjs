"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = DocsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const docs_client_1 = require("@/components/docs-client");
const marked_1 = require("marked");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
exports.dynamic = "force-dynamic";
function stripHtmlTags(raw) {
    return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
async function renderPricingDocs(md) {
    const rawHtml = await marked_1.marked.parse(md, { gfm: true });
    const toc = [];
    let idx = 0;
    const withIds = rawHtml.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
        idx += 1;
        const id = `sec-${idx}`;
        const text = stripHtmlTags(inner);
        if (text)
            toc.push({ id, text });
        return `<h2 id="${id}">${inner}</h2>`;
    });
    const html = withIds.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="docs-table-wrap"><table>$1</table></div>');
    return { html, toc };
}
async function DocsPage() {
    const md = await (0, promises_1.readFile)(node_path_1.default.join(process.cwd(), "docs", "PRICING_LOGIC.md"), "utf8");
    const { html, toc } = await renderPricingDocs(md);
    return (0, jsx_runtime_1.jsx)(docs_client_1.DocsClient, { html: html, toc: toc });
}
