"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = GlobalError;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
function GlobalError({ error, reset, }) {
    (0, react_1.useEffect)(() => {
        console.error("[panel] global error:", error);
    }, [error]);
    return ((0, jsx_runtime_1.jsx)("html", { lang: "fa", dir: "rtl", children: (0, jsx_runtime_1.jsx)("body", { style: {
                margin: 0,
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#f8fafc",
                color: "#0f172a",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                padding: "16px",
            }, children: (0, jsx_runtime_1.jsxs)("div", { style: {
                    maxWidth: "460px",
                    width: "100%",
                    backgroundColor: "#ffffff",
                    border: "1px solid #fecdd3",
                    borderRadius: "16px",
                    padding: "24px",
                    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.06)",
                }, children: [(0, jsx_runtime_1.jsx)("h1", { style: { margin: "0 0 10px", fontSize: "18px", fontWeight: 700 }, children: "\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u067E\u0646\u0644 \u0628\u0627 \u062E\u0637\u0627\u06CC \u0633\u0631\u0648\u0631 \u0645\u0648\u0627\u062C\u0647 \u0634\u062F" }), (0, jsx_runtime_1.jsx)("p", { style: { margin: "0 0 16px", fontSize: "14px", lineHeight: 1.7, color: "#475569" }, children: "\u067E\u0627\u0633\u062E \u0645\u0639\u062A\u0628\u0631\u06CC \u0627\u0632 \u0633\u0631\u0648\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u0646\u0634\u062F. \u067E\u0633 \u0627\u0632 \u0628\u0631\u0631\u0633\u06CC \u0648\u0636\u0639\u06CC\u062A \u0633\u0631\u0648\u06CC\u0633\u060C \u0645\u0647\u0627\u062C\u0631\u062A \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0648 \u0627\u062A\u0635\u0627\u0644 \u067E\u0627\u06CC\u06AF\u0627\u0647\u200C\u062F\u0627\u062F\u0647 \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F." }), error?.digest && ((0, jsx_runtime_1.jsxs)("p", { dir: "ltr", style: {
                            margin: "0 0 16px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            backgroundColor: "#f1f5f9",
                            fontSize: "12px",
                            fontFamily: "monospace",
                            color: "#334155",
                        }, children: ["ERROR ", error.digest] })), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" }, children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => reset(), style: {
                                    cursor: "pointer",
                                    border: "none",
                                    borderRadius: "10px",
                                    padding: "9px 16px",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    backgroundColor: "#4f46e5",
                                    color: "#ffffff",
                                }, children: "\u062A\u0644\u0627\u0634 \u0645\u062C\u062F\u062F" }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => window.location.reload(), style: {
                                    cursor: "pointer",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "10px",
                                    padding: "9px 16px",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    backgroundColor: "#ffffff",
                                    color: "#1e293b",
                                }, children: "\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0645\u062C\u062F\u062F" })] })] }) }) }));
}
