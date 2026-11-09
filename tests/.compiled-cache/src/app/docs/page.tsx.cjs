"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = DocsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const marked_1 = require("marked");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
exports.dynamic = "force-dynamic";
async function DocsPage() {
    const md = await (0, promises_1.readFile)(node_path_1.default.join(process.cwd(), "docs", "PRICING_LOGIC.md"), "utf8");
    const html = await marked_1.marked.parse(md, { gfm: true });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "card prose-fa max-w-5xl", children: [(0, jsx_runtime_1.jsx)("style", { children: `.prose-fa table{width:100%;font-size:.85rem;margin:1rem 0}.prose-fa th,.prose-fa td{border:1px solid #e2e8f0;padding:.4rem .6rem;text-align:right}.prose-fa th{background:#f8fafc}.prose-fa h1{font-size:1.6rem;font-weight:800;margin-bottom:1rem}.prose-fa blockquote{border-right:4px solid #6366f1;padding-right:1rem;color:#475569;margin:1rem 0}` }), (0, jsx_runtime_1.jsx)("div", { dangerouslySetInnerHTML: { __html: html } })] }));
}
