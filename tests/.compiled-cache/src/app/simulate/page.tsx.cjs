"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SimulatePage;
const jsx_runtime_1 = require("react/jsx-runtime");
const icons_1 = require("@/components/icons");
const ui_1 = require("@/components/ui");
const format_1 = require("../../lib/format");
const react_1 = require("react");
const SAMPLE_COLLEAGUES = [
    "پخش شرق مشهد, 2320000, مشهد, 9, in",
    "همکار لاله‌زار تهران, 2295000, تهران, 7, in",
].join("\n");
const SAMPLE_OFFERS = [
    "شرق دیجیتال مشهد, 2460000, مشهد, 0, online, 4.9",
    "پاساژ تک مشهد, 2475000, مشهد, 1, in_person, 4.8",
    "تکنولایف, 2480000, تهران, 0, online, 4.9",
    "کالاتیک, 2520000, تهران, 1, online, 4.8",
    "دیجی‌کالا, 2650000, تهران, 0, online, 4.8",
    "گران‌فروش پرت ترب, 3850000, تهران, 5, online, 4.1",
].join("\n");
function SimulatePage() {
    const toast = (0, ui_1.useToast)();
    const [mobileTab, setMobileTab] = (0, react_1.useState)("inputs");
    const [storeProducts, setStoreProducts] = (0, react_1.useState)([]);
    const [selectedProductId, setSelectedProductId] = (0, react_1.useState)("");
    const [productName, setProductName] = (0, react_1.useState)("دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل");
    const [torobTitle, setTorobTitle] = (0, react_1.useState)("دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل");
    const [colleaguesText, setColleaguesText] = (0, react_1.useState)(SAMPLE_COLLEAGUES);
    const [offersText, setOffersText] = (0, react_1.useState)(SAMPLE_OFFERS);
    const [cost, setCost] = (0, react_1.useState)(2320000);
    const [minMargin, setMinMargin] = (0, react_1.useState)(3);
    const [current, setCurrent] = (0, react_1.useState)("2490000");
    const [sellers, setSellers] = (0, react_1.useState)(14);
    // آستانه‌های ناظر بالاسر SubQ SystemOne
    const [rejectBelowPct, setRejectBelowPct] = (0, react_1.useState)(45);
    const [approveAbovePct, setApproveAbovePct] = (0, react_1.useState)(80);
    // پارامترهای شخصی‌سازی زنده کف و سقف بازار و ۳ سیستم تخفیف
    const [ceilingMode, setCeilingMode] = (0, react_1.useState)("market_percentile_ceiling");
    const [upperPercentile, setUpperPercentile] = (0, react_1.useState)(85);
    const [maxCeilingAboveMedianPct, setMaxCeilingAboveMedianPct] = (0, react_1.useState)(18);
    const [minDiscountPct, setMinDiscountPct] = (0, react_1.useState)(5);
    const [maxDiscountPct, setMaxDiscountPct] = (0, react_1.useState)(35);
    const [calibrateExact, setCalibrateExact] = (0, react_1.useState)(true);
    // پیش‌نمایش کارت در یکی از ۳ سیستم تخفیف sgeooole
    const [previewCampaign, setPreviewCampaign] = (0, react_1.useState)("featured");
    const [previewCampaignName, setPreviewCampaignName] = (0, react_1.useState)("پیشنهاد شگفت‌انگیز مشهد");
    const [previewTheme, setPreviewTheme] = (0, react_1.useState)("red-purple");
    const [previewFeatured, setPreviewFeatured] = (0, react_1.useState)(true);
    const [res, setRes] = (0, react_1.useState)(null);
    const [busy, setBusy] = (0, react_1.useState)(false);
    const [err, setErr] = (0, react_1.useState)(null);
    (0, react_1.useEffect)(() => {
        fetch("/api/products")
            .then((r) => (r.ok ? r.json() : []))
            .then((rows) => {
            if (Array.isArray(rows))
                setStoreProducts(rows);
        })
            .catch(() => undefined);
    }, []);
    const parseOffersFromText = (txt) => txt
        .split("\n")
        .map((l) => l.split(",").map((s) => s.trim()))
        .filter((p) => p.length >= 2 && Number(p[1]) > 0)
        .map((p) => {
        const days = p[3] ? Number(p[3]) : NaN;
        const score = p[5] ? Number(p[5]) : NaN;
        return {
            shopName: p[0],
            price: Number(p[1]),
            shopCity: p[2] || null,
            lastChangedDaysAgo: Number.isFinite(days) ? days : null,
            sellerType: p[4] === "in_person" ? "in_person" : "online",
            isAd: p[4] === "ad",
            inStock: p[4] !== "out",
            priceUnreliable: p[4] === "unreliable",
            shopScore: Number.isFinite(score) ? score : null,
        };
    });
    const run = async (forceCostless = false, overrideTorobTitle) => {
        setBusy(true);
        setErr(null);
        setRes(null);
        const effectiveProductName = productName.trim() || "دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5";
        if (!productName.trim()) {
            setProductName(effectiveProductName);
        }
        let offers = parseOffersFromText(offersText);
        if (offers.length < 2) {
            const baseAnchor = Number(current) > 0 ? Number(current) : cost > 0 ? Math.round(cost * 1.08) : 2460000;
            const autoOffersText = [
                `شرق دیجیتال مشهد, ${Math.round(baseAnchor)}, مشهد, 0, online, 4.9`,
                `پاساژ تک مشهد, ${Math.round(baseAnchor * 1.01)}, مشهد, 1, in_person, 4.8`,
                `تکنولایف, ${Math.round(baseAnchor * 1.015)}, تهران, 0, online, 4.9`,
                `کالاتیک, ${Math.round(baseAnchor * 1.03)}, تهران, 1, online, 4.8`,
                `دیجی‌کالا, ${Math.round(baseAnchor * 1.08)}, تهران, 0, online, 4.8`,
                `گران‌فروش پرت ترب, ${Math.round(baseAnchor * 1.55)}, تهران, 5, online, 4.1`,
            ].join("\n");
            setOffersText(autoOffersText);
            offers = parseOffersFromText(autoOffersText);
        }
        try {
            const r = await fetch("/api/simulate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productName: effectiveProductName,
                    torobTitle: overrideTorobTitle ?? (torobTitle.trim() || effectiveProductName),
                    costPrice: forceCostless ? 0 : cost,
                    minMarginPct: minMargin,
                    colleagueListText: forceCostless ? "" : colleaguesText,
                    currentFinalPrice: current ? Number(current) : null,
                    totalSellerCount: sellers || offers.length,
                    config: {
                        discount: {
                            mode: ceilingMode,
                            basePriceMode: ceilingMode === "markup" ? "markup" : "market_upper",
                            marketUpperPercentile: upperPercentile,
                            maxCeilingAboveMedianPct,
                            minDiscountPct,
                            maxDiscountPct,
                            calibrateCeilingForExactFloor: calibrateExact,
                            markupPct: 14,
                        },
                        supervisor: {
                            enabled: true,
                            rejectBelowPct,
                            approveAbovePct,
                            strictGateVeto: true,
                            gates: {
                                identity_match: { rejectBelowPct, approveAbovePct, weight: 0.3 },
                                market_data_integrity: { rejectBelowPct, approveAbovePct, weight: 0.25 },
                                profit_and_rank_safety: { rejectBelowPct, approveAbovePct, weight: 0.3 },
                                ceiling_discount_validity: { rejectBelowPct, approveAbovePct, weight: 0.15 },
                            },
                        },
                    },
                    offers,
                }),
            });
            if (r.status === 401 && typeof window !== "undefined") {
                window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
                return;
            }
            const j = await r.json().catch(() => ({ error: `خطای سرور (HTTP ${r.status})` }));
            if (!r.ok) {
                const errorText = String(j.error ?? "خطا در شبیه‌سازی");
                setErr(errorText);
                toast.error(errorText);
                setMobileTab("results");
            }
            else {
                setRes(j);
                setMobileTab("results");
                if (typeof window !== "undefined" && window.innerWidth < 1280) {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }
                toast.success("شبیه‌سازی با موفقیت انجام شد");
            }
        }
        catch (e) {
            const errorText = `خطا در ارسال درخواست: ${e instanceof Error ? e.message : String(e)}`;
            setErr(errorText);
            toast.error(errorText);
            setMobileTab("results");
        }
        finally {
            setBusy(false);
        }
    };
    const t = (n) => (n == null ? "—" : Math.round(n).toLocaleString("fa-IR"));
    const themeBadgeStyles = {
        "green-orange": "bg-gradient-to-r from-emerald-600 to-orange-500 text-white",
        "gold-red": "bg-gradient-to-r from-amber-500 to-rose-600 text-white",
        "red-purple": "bg-gradient-to-r from-rose-600 to-purple-700 text-white",
    };
    const verdictStyle = {
        approve: "bg-emerald-100 text-emerald-900 border-emerald-300",
        review: "bg-amber-100 text-amber-900 border-amber-300",
        reject: "bg-rose-100 text-rose-900 border-rose-300",
    };
    // محاسبه موقعیت واقعی شاخص‌ها روی نوار طیف قیمت بازار
    const spectrumPoints = (0, react_1.useMemo)(() => {
        if (!res)
            return null;
        const hardFloor = res.supply?.hardFloorPrice ?? null;
        const median = res.floorCeiling?.monitoredMarketMedian ?? res.marketMedian ?? null;
        const ceiling = res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice ?? null;
        const finalPrice = res.finalPrice ?? null;
        const vals = [hardFloor, median, ceiling, finalPrice].filter((v) => v != null && v > 0);
        if (vals.length < 2)
            return null;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const span = Math.max(1, max - min);
        const pctPos = (v) => v == null || v <= 0 ? null : Math.min(98, Math.max(2, ((v - min) / span) * 96 + 2));
        return {
            hardFloorPos: pctPos(hardFloor),
            medianPos: pctPos(median),
            ceilingPos: pctPos(ceiling),
            finalPos: pctPos(finalPrice),
            hardFloor,
            median,
            ceiling,
            finalPrice,
        };
    }, [res]);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("h1", { className: "text-lg font-extrabold leading-snug text-slate-900 sm:text-2xl", children: "\u0622\u0632\u0645\u0627\u06CC\u0634\u06AF\u0627\u0647 \u0632\u0646\u062F\u0647 \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 SubQ SystemOne\u060C \u06A9\u0634\u0641 \u06A9\u0641 \u0648 \u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631 \u0648 \u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632 \u06F3 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641" }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1 text-xs leading-6 text-slate-600 sm:text-sm", children: ["\u062F\u0631 \u0627\u06CC\u0646 \u0645\u062D\u06CC\u0637 \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0622\u0633\u062A\u0627\u0646\u0647\u200C\u0647\u0627\u06CC \u06F3 \u0628\u0627\u0632\u0647\u200C\u0627\u06CC \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "SubQ SystemOne \u2014 subq-snap-preview" }), ") \u0631\u0627 \u0634\u062E\u0635\u06CC\u200C\u0633\u0627\u0632\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0631\u0641\u062A\u0627\u0631 \u0622\u0646 \u0631\u0627 \u0631\u0648\u06CC \u0648\u0631\u0648\u062F\u06CC \u062A\u0631\u0628\u060C \u06A9\u0641 \u0648 \u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631 \u0648 \u0647\u0631 \u06F3 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u062A\u0633\u062A \u0646\u0645\u0627\u06CC\u06CC\u062F."] })] }), (0, jsx_runtime_1.jsx)("div", { className: "xl:hidden", children: (0, jsx_runtime_1.jsx)(ui_1.SegmentedTabs, { value: mobileTab, onChange: setMobileTab, items: [
                        { key: "inputs", label: "تنظیمات ورودی" },
                        { key: "results", label: res ? "نتیجه و پیش‌نمایش ✅" : "نتیجه و پیش‌نمایش" },
                    ] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-5 xl:grid-cols-[minmax(0,470px)_minmax(0,1fr)] xl:items-start", children: [(0, jsx_runtime_1.jsxs)("div", { className: `min-w-0 space-y-3.5 ${mobileTab === "inputs" ? "block" : "hidden xl:block"}`, children: [storeProducts.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: "card space-y-2 border-slate-200 bg-slate-50/70", children: [(0, jsx_runtime_1.jsxs)("label", { className: "label font-bold text-slate-800", children: ["\uD83D\uDCE6 \u0627\u0646\u062A\u062E\u0627\u0628 \u0633\u0631\u06CC\u0639 \u0627\u0632 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0648\u0627\u0642\u0639\u06CC \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 (", (0, format_1.faNum)(storeProducts.length), " \u0645\u062D\u0635\u0648\u0644)"] }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: selectedProductId, onChange: (e) => {
                                            const pid = e.target.value;
                                            setSelectedProductId(pid);
                                            const found = storeProducts.find((x) => String(x.id) === pid);
                                            if (found) {
                                                setProductName(found.name);
                                                setTorobTitle(found.name);
                                                const pPrice = found.currentFinalPrice && found.currentFinalPrice > 0 ? found.currentFinalPrice : 2450000;
                                                setCurrent(String(pPrice));
                                                setCost(found.costPrice > 0 ? found.costPrice : Math.round(pPrice * 0.9));
                                                setOffersText([
                                                    `شرق دیجیتال مشهد, ${Math.round(pPrice)}, مشهد, 0, online, 4.9`,
                                                    `پاساژ تک مشهد, ${Math.round(pPrice * 1.01)}, مشهد, 1, in_person, 4.8`,
                                                    `تکنولایف, ${Math.round(pPrice * 1.02)}, تهران, 0, online, 4.9`,
                                                    `کالاتیک, ${Math.round(pPrice * 1.04)}, تهران, 1, online, 4.8`,
                                                    `دیجی‌کالا, ${Math.round(pPrice * 1.09)}, تهران, 0, online, 4.8`,
                                                    `گران‌فروش پرت ترب, ${Math.round(pPrice * 1.55)}, تهران, 5, online, 4.1`,
                                                ].join("\n"));
                                            }
                                        }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "-- \u0627\u0646\u062A\u062E\u0627\u0628 \u0645\u062D\u0635\u0648\u0644 \u0627\u0632 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0628\u0631\u0627\u06CC \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u062F\u0631 \u0622\u0632\u0645\u0627\u06CC\u0634\u06AF\u0627\u0647 --" }), storeProducts.map((p, idx) => ((0, jsx_runtime_1.jsxs)("option", { value: p.id, children: ["\u06A9\u0627\u0631\u062A #", idx + 1, ": ", p.name, " (", p.sku, ")"] }, p.id)))] })] })), (0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: "\u06F1. \u0645\u062D\u0635\u0648\u0644 \u0648 \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 SubQ SystemOne", badge: (0, jsx_runtime_1.jsx)("span", { className: "badge bg-indigo-100 font-mono text-[10px] text-indigo-900", children: "subq-snap-preview" }), defaultOpen: true, className: "border-indigo-200", children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1 flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("label", { className: "label mb-0 font-bold text-rose-700", children: "\u0631\u062F \u06A9\u0627\u0645\u0644 \u0632\u06CC\u0631 (\u066A)" }), (0, jsx_runtime_1.jsxs)("span", { className: "num text-xs font-bold text-rose-700", children: [(0, format_1.faNum)(rejectBelowPct), "\u066A"] })] }), (0, jsx_runtime_1.jsx)("input", { type: "range", min: 5, max: 90, value: rejectBelowPct, onChange: (e) => setRejectBelowPct(Number(e.target.value)), className: "mb-1.5 w-full accent-rose-600" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 5, max: 90, value: rejectBelowPct, onChange: (e) => setRejectBelowPct(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1 flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("label", { className: "label mb-0 font-bold text-emerald-700", children: "\u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0627\u0644\u0627\u06CC (\u066A)" }), (0, jsx_runtime_1.jsxs)("span", { className: "num text-xs font-bold text-emerald-700", children: [(0, format_1.faNum)(approveAbovePct), "\u066A"] })] }), (0, jsx_runtime_1.jsx)("input", { type: "range", min: 20, max: 99, value: approveAbovePct, onChange: (e) => setApproveAbovePct(Number(e.target.value)), className: "mb-1.5 w-full accent-emerald-600" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 20, max: 99, value: approveAbovePct, onChange: (e) => setApproveAbovePct(Number(e.target.value)) })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u0645\u062D\u0635\u0648\u0644 \u062F\u0631 \u0633\u0627\u06CC\u062A \u0645\u0627 (sgeooole)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", value: productName, onChange: (e) => setProductName(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1.5 flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label mb-0", children: "\u0639\u0646\u0648\u0627\u0646 \u06A9\u0627\u0631\u062A \u062F\u0631 \u0648\u0631\u0648\u062F\u06CC \u062A\u0631\u0628 (\u062A\u0633\u062A \u06AF\u06CC\u062A \u06F1)" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "text-[11px] font-semibold text-emerald-700 hover:underline", onClick: () => {
                                                                        setTorobTitle(productName);
                                                                        run(false, productName);
                                                                    }, children: "\u2705 \u062A\u0633\u062A \u06A9\u0627\u0631\u062A \u0645\u0646\u0637\u0628\u0642" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "text-[11px] font-semibold text-rose-600 hover:underline", onClick: () => {
                                                                        const bad = "پایه و کاور لوازم جانبی نامرتبط (کالای تستی گیت هویت)";
                                                                        setTorobTitle(bad);
                                                                        run(false, bad);
                                                                    }, children: "\u26D4 \u062A\u0633\u062A \u06A9\u0627\u0631\u062A \u0627\u0634\u062A\u0628\u0627\u0647" })] })] }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", value: torobTitle, onChange: (e) => setTorobTitle(e.target.value) })] })] }) }), (0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: "\u06F2. \u0644\u06CC\u0633\u062A \u0647\u0645\u06A9\u0627\u0631\u0627\u0646 \u0648 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627\u06CC \u0631\u0642\u0628\u0627", defaultOpen: true, children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1 flex flex-wrap items-center justify-between gap-1", children: [(0, jsx_runtime_1.jsx)("label", { className: "label mb-0 font-bold text-indigo-700", children: "\u0644\u06CC\u0633\u062A \u0642\u06CC\u0645\u062A \u0647\u0645\u06A9\u0627\u0631\u0627\u0646 (\u062E\u0627\u0644\u06CC = \u06A9\u0634\u0641 \u06A9\u0641 \u0627\u0645\u0646)" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "text-xs font-medium text-indigo-600 hover:underline", onClick: () => {
                                                                setColleaguesText("");
                                                                setCost(0);
                                                            }, children: "\u067E\u0627\u06A9 \u06A9\u0631\u062F\u0646 (\u062A\u0633\u062A \u0628\u062F\u0648\u0646 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F)" })] }), (0, jsx_runtime_1.jsx)("textarea", { className: "input min-h-20 font-mono text-xs", dir: "ltr", value: colleaguesText, onChange: (e) => setColleaguesText(e.target.value), placeholder: "\u0646\u0627\u0645 \u0647\u0645\u06A9\u0627\u0631, \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F (\u062A\u0648\u0645\u0627\u0646), \u0634\u0647\u0631, \u0627\u0648\u0644\u0648\u06CC\u062A 1-10, in|out" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1 flex flex-wrap items-center justify-between gap-1", children: [(0, jsx_runtime_1.jsx)("label", { className: "label mb-0 font-bold text-emerald-700", children: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627\u06CC \u0631\u0642\u0628\u0627 \u062F\u0631 \u062A\u0631\u0628" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "text-xs font-medium text-emerald-700 hover:underline", onClick: () => {
                                                                setColleaguesText(SAMPLE_COLLEAGUES);
                                                                setOffersText(SAMPLE_OFFERS);
                                                                setCost(2320000);
                                                            }, children: "\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0646\u0645\u0648\u0646\u0647 \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F" })] }), (0, jsx_runtime_1.jsx)("textarea", { className: "input min-h-28 font-mono text-xs", dir: "ltr", value: offersText, onChange: (e) => setOffersText(e.target.value), placeholder: "\u0646\u0627\u0645 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647, \u0642\u06CC\u0645\u062A (\u062A\u0648\u0645\u0627\u0646), \u0634\u0647\u0631, \u0631\u0648\u0632\u0647\u0627\u06CC \u06AF\u0630\u0634\u062A\u0647, online|in_person, \u0627\u0645\u062A\u06CC\u0627\u0632" })] })] }) }), (0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: "\u06F3. \u0641\u0631\u0645\u0648\u0644 \u06A9\u0634\u0641 \u00AB\u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631\u00BB \u0648 \u00AB\u06A9\u0641\u00BB", defaultOpen: false, className: "border-emerald-200", children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0631\u0648\u0634 \u06A9\u0634\u0641 \u0633\u0642\u0641 \u0642\u06CC\u0645\u062A \u0628\u0627\u0632\u0627\u0631 (\u0645\u0639\u06CC\u0627\u0631 \u062A\u062E\u0641\u06CC\u0641)" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs font-medium", value: ceilingMode, onChange: (e) => setCeilingMode(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "market_percentile_ceiling", children: "\u0635\u062F\u06A9 \u0628\u0627\u0644\u0627\u06CC \u0628\u0627\u0632\u0627\u0631 \u062A\u062D\u062A \u0631\u0635\u062F (\u062D\u0630\u0641 \u06A9\u0627\u0645\u0644 \u067E\u0631\u062A\u200C\u0647\u0627 \u2014 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "highest_valid_seller", children: "\u0628\u0627\u0644\u0627\u062A\u0631\u06CC\u0646 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0628\u0627\u0632\u0627\u0631 (\u0645\u062D\u0635\u0648\u0631 \u062F\u0631 \u0633\u067E\u0631 \u0636\u062F\u067E\u0631\u062A)" }), (0, jsx_runtime_1.jsx)("option", { value: "trimmed_upper_cluster", children: "\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646 \u0646\u06CC\u0645\u0647 \u0628\u0627\u0644\u0627\u06CC\u06CC \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0645\u0639\u062A\u0628\u0631 \u0628\u0627\u0632\u0627\u0631" }), (0, jsx_runtime_1.jsx)("option", { value: "markup", children: "\u0627\u0641\u0632\u0627\u06CC\u0634 \u062F\u0631\u0635\u062F\u06CC \u062B\u0627\u0628\u062A \u0631\u0648\u06CC \u06A9\u0641 \u0647\u062F\u0641 (Markup)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("label", { className: "label", children: ["\u0635\u062F\u06A9 \u0633\u0642\u0641 (", (0, format_1.faNum)(upperPercentile), "\u066A)"] }), (0, jsx_runtime_1.jsx)("input", { type: "range", min: 55, max: 98, value: upperPercentile, onChange: (e) => setUpperPercentile(Number(e.target.value)), className: "mb-1 w-full accent-indigo-600" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 55, max: 98, value: upperPercentile, onChange: (e) => setUpperPercentile(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("label", { className: "label", children: ["\u0633\u067E\u0631 \u0636\u062F\u067E\u0631\u062A (", (0, format_1.faNum)(maxCeilingAboveMedianPct), "\u066A)"] }), (0, jsx_runtime_1.jsx)("input", { type: "range", min: 5, max: 50, value: maxCeilingAboveMedianPct, onChange: (e) => setMaxCeilingAboveMedianPct(Number(e.target.value)), className: "mb-1 w-full accent-indigo-600" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 5, max: 50, value: maxCeilingAboveMedianPct, onChange: (e) => setMaxCeilingAboveMedianPct(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u062A\u062E\u0641\u06CC\u0641 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, max: 50, value: minDiscountPct, onChange: (e) => setMinDiscountPct(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u062A\u062E\u0641\u06CC\u0641 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 5, max: 80, value: maxDiscountPct, onChange: (e) => setMaxDiscountPct(Number(e.target.value)) })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-emerald-200 bg-emerald-50/40 p-3", children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: calibrateExact, onChange: setCalibrateExact, label: "\u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646 \u062F\u0642\u06CC\u0642 \u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641", description: "\u062E\u0631\u0648\u062C\u06CC \u0628\u0627 \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u0635\u062D\u06CC\u062D \u062F\u0642\u06CC\u0642\u0627\u064B \u0631\u0648\u06CC \u06A9\u0641 \u0647\u062F\u0641 \u0628\u0646\u0634\u06CC\u0646\u062F" }) })] }) }), (0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: "\u06F4. \u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u06A9\u0627\u0631\u062A \u0648 \u067E\u0627\u0631\u0627\u0645\u062A\u0631\u0647\u0627\u06CC \u067E\u0627\u06CC\u0647", defaultOpen: false, children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-2.5 sm:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: previewCampaign, onChange: (e) => {
                                                                const next = e.target.value;
                                                                setPreviewCampaign(next);
                                                                setPreviewTheme(next === "flash" ? "gold-red" : next === "featured" ? "red-purple" : "green-orange");
                                                            }, children: [(0, jsx_runtime_1.jsx)("option", { value: "flash", children: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "featured", children: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "timed_sale", children: "\u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641 / \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0645 \u0631\u0646\u06AF\u06CC \u0646\u0634\u0627\u0646 (Badge Theme)" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: previewTheme, onChange: (e) => setPreviewTheme(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "green-orange", children: "\u0633\u0628\u0632 - \u0646\u0627\u0631\u0646\u062C\u06CC" }), (0, jsx_runtime_1.jsx)("option", { value: "gold-red", children: "\u0637\u0644\u0627\u06CC\u06CC - \u0642\u0631\u0645\u0632" }), (0, jsx_runtime_1.jsx)("option", { value: "red-purple", children: "\u0642\u0631\u0645\u0632 - \u0628\u0646\u0641\u0634" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0639\u0646\u0648\u0627\u0646 \u0628\u0631\u0686\u0633\u0628 \u06A9\u0645\u067E\u06CC\u0646" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", value: previewCampaignName, onChange: (e) => setPreviewCampaignName(e.target.value) })] }), (0, jsx_runtime_1.jsx)("div", { className: "flex items-end", children: (0, jsx_runtime_1.jsx)("div", { className: "w-full rounded-xl border border-slate-200 p-2.5", children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: previewFeatured, onChange: setPreviewFeatured, label: "\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627" }) }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u062F\u0633\u062A\u06CC" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: cost, onChange: (e) => setCost(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u0633\u0648\u062F (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: "0.5", value: minMargin, onChange: (e) => setMinMargin(Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0642\u06CC\u0645\u062A \u0641\u0639\u0644\u06CC" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: current, onChange: (e) => setCurrent(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0639\u062F\u0627\u062F \u0641\u0631\u0648\u0634\u0646\u062F\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: sellers, onChange: (e) => setSellers(Number(e.target.value)) })] })] })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-2 sm:flex-row", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary flex-1", disabled: busy, onClick: () => run(false), children: [busy && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: busy ? "در حال بررسی ناظر و محاسبه…" : "🔍 اجرای ناظر SystemOne و محاسبه کف و سقف" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary", disabled: busy, onClick: () => run(true), children: "\u062A\u0633\u062A \u0628\u062F\u0648\u0646 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: `card min-w-0 ${mobileTab === "results" ? "block" : "hidden xl:block"}`, children: [err && ((0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800", children: err })), !res && !err && ((0, jsx_runtime_1.jsxs)("div", { className: "flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-slate-400", children: [(0, jsx_runtime_1.jsx)("p", { className: "max-w-md text-sm leading-7", children: "\u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u00AB\uD83D\uDD0D \u0627\u062C\u0631\u0627\u06CC \u0646\u0627\u0638\u0631 SystemOne \u0648 \u0645\u062D\u0627\u0633\u0628\u0647 \u06A9\u0641 \u0648 \u0633\u0642\u0641\u00BB \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u0646\u062A\u06CC\u062C\u0647 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u06CC \u06F4 \u0645\u0642\u06CC\u0627\u0633\u06CC \u0648 \u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u06A9\u0627\u0631\u062A \u0645\u062D\u0635\u0648\u0644 \u0628\u0644\u0627\u0641\u0627\u0635\u0644\u0647 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0634\u0648\u062F." }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary xl:hidden", disabled: busy, onClick: () => run(false), children: [busy && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0627\u062C\u0631\u0627\u06CC \u0633\u0631\u06CC\u0639 \u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632\u06CC \u0628\u0627 \u0646\u0645\u0648\u0646\u0647 \u067E\u06CC\u0634\u200C\u0641\u0631\u0636" })] })] })), res && ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5", children: [res.supervisor && ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-3 rounded-2xl border-2 border-indigo-300 bg-indigo-50/30 p-3.5 sm:p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsxs)("div", { className: "text-sm font-bold text-indigo-950", children: ["\uD83D\uDEE1\uFE0F \u062D\u06A9\u0645 \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 SubQ SystemOne (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: res.supervisor.model }), ")"] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-1 text-xs leading-5 text-slate-600", children: ["\u0642\u0627\u0646\u0648\u0646 \u06F3 \u0628\u0627\u0632\u0647\u200C\u0627\u06CC: ", (0, jsx_runtime_1.jsxs)("b", { children: ["\u0632\u06CC\u0631 ", res.supervisor.rejectBelowPct, "\u066A \u0631\u062F \u06A9\u0627\u0645\u0644"] }), " \u00B7", " ", (0, jsx_runtime_1.jsxs)("b", { children: [res.supervisor.rejectBelowPct, "\u066A \u062A\u0627 ", res.supervisor.approveAbovePct, "\u066A \u0631\u06CC\u0648\u06CC\u0648"] }), " \u00B7", " ", (0, jsx_runtime_1.jsxs)("b", { children: ["\u0628\u0627\u0644\u0627\u06CC ", res.supervisor.approveAbovePct, "\u066A \u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631"] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: `badge self-start border px-3 py-1 text-xs font-bold sm:self-auto ${verdictStyle[res.supervisor.verdict]}`, children: ["noul: ", res.supervisor.overallNoul.toFixed(2), " (", res.supervisor.overallScorePct, "\u066A) \u2192", " ", res.supervisor.verdict === "approve"
                                                                ? "✅ تایید و ادامه خودکار"
                                                                : res.supervisor.verdict === "review"
                                                                    ? "⏳ ارسال به ریویو"
                                                                    : "⛔ رد کامل"] })] }), (0, jsx_runtime_1.jsx)("div", { className: "grid gap-2.5 md:grid-cols-2", children: Object.values(res.supervisor.gates).map((g) => ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-white p-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-1.5 text-xs", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-slate-800", children: g.title }), (0, jsx_runtime_1.jsxs)("span", { className: `badge border font-mono text-[11px] ${verdictStyle[g.verdict]}`, children: [g.scorePct, "\u066A (", g.noul.toFixed(2), ")"] })] }), (0, jsx_runtime_1.jsx)("div", { className: "mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100", children: (0, jsx_runtime_1.jsx)("div", { className: `h-full transition-all ${g.verdict === "approve"
                                                                    ? "bg-emerald-500"
                                                                    : g.verdict === "review"
                                                                        ? "bg-amber-500"
                                                                        : "bg-rose-500"}`, style: { width: `${Math.min(100, Math.max(4, g.scorePct))}%` } }) }), (0, jsx_runtime_1.jsx)("div", { className: "mt-1.5 text-[11px] leading-5 text-slate-600", children: g.reason })] }, g.key))) })] })), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-4 lg:grid-cols-12", children: [(0, jsx_runtime_1.jsxs)("div", { className: "space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4 lg:col-span-7", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-xs font-bold text-slate-800", children: "\uD83D\uDCCA \u0631\u0627\u062F\u0627\u0631 \u06A9\u0641 \u0648 \u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631 \u062A\u062D\u062A \u0631\u0635\u062F" }), (0, jsx_runtime_1.jsxs)("span", { className: "badge bg-emerald-100 text-emerald-800 text-[11px]", children: [(0, format_1.faNum)(res.floorCeiling?.monitoredSellersCount ?? res.offersUsed), " \u0645\u0639\u062A\u0628\u0631 \u00B7", " ", (0, format_1.faNum)(res.floorCeiling?.excludedOutliersCount ?? 0), " \u067E\u0631\u062A \u062D\u0630\u0641 \u0634\u062F"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg bg-white px-2.5 py-1.5", children: [(0, jsx_runtime_1.jsx)("span", { className: "block text-[10px] text-slate-400", children: "\u062E\u0637 \u0642\u0631\u0645\u0632 \u062A\u0627\u0645\u06CC\u0646" }), (0, jsx_runtime_1.jsx)("b", { className: "num text-amber-800", children: t(res.supply?.hardFloorPrice) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg bg-white px-2.5 py-1.5", children: [(0, jsx_runtime_1.jsx)("span", { className: "block text-[10px] text-slate-400", children: "\u0645\u06CC\u0627\u0646\u0647 \u0628\u0627\u0632\u0627\u0631" }), (0, jsx_runtime_1.jsx)("b", { className: "num text-slate-800", children: t(res.floorCeiling?.monitoredMarketMedian ?? res.marketMedian) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg bg-white px-2.5 py-1.5", children: [(0, jsx_runtime_1.jsx)("span", { className: "block text-[10px] text-slate-400", children: "\u0633\u0642\u0641 \u0648\u0627\u0642\u0639\u06CC \u0631\u0635\u062F\u0634\u062F\u0647" }), (0, jsx_runtime_1.jsx)("b", { className: "num text-indigo-800", children: t(res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-1.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "relative h-5 w-full rounded-full bg-gradient-to-l from-indigo-500 via-emerald-500 to-amber-500 p-0.5 shadow-inner", dir: "ltr", children: [spectrumPoints?.hardFloorPos != null && ((0, jsx_runtime_1.jsx)("span", { title: `خط قرمز: ${t(spectrumPoints.hardFloor)}`, style: { left: `${spectrumPoints.hardFloorPos}%` }, className: "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-600 shadow" })), spectrumPoints?.finalPos != null && ((0, jsx_runtime_1.jsx)("span", { title: `قیمت نهایی ما: ${t(spectrumPoints.finalPrice)}`, style: { left: `${spectrumPoints.finalPos}%` }, className: "absolute top-1/2 z-10 h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-700 ring-2 ring-emerald-300 shadow" })), spectrumPoints?.medianPos != null && ((0, jsx_runtime_1.jsx)("span", { title: `میانه بازار: ${t(spectrumPoints.median)}`, style: { left: `${spectrumPoints.medianPos}%` }, className: "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-slate-800 shadow" })), spectrumPoints?.ceilingPos != null && ((0, jsx_runtime_1.jsx)("span", { title: `سقف بازار: ${t(spectrumPoints.ceiling)}`, style: { left: `${spectrumPoints.ceilingPos}%` }, className: "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-700 shadow" }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-3 text-[10px] text-slate-500", children: [(0, jsx_runtime_1.jsxs)("span", { className: "inline-flex items-center gap-1", children: [(0, jsx_runtime_1.jsx)("i", { className: "h-2 w-2 rounded-full bg-amber-600" }), " \u062E\u0637 \u0642\u0631\u0645\u0632"] }), (0, jsx_runtime_1.jsxs)("span", { className: "inline-flex items-center gap-1 font-bold text-emerald-700", children: [(0, jsx_runtime_1.jsx)("i", { className: "h-2.5 w-2.5 rounded-full bg-emerald-700" }), " \u0642\u06CC\u0645\u062A \u0646\u0647\u0627\u06CC\u06CC \u0645\u0627"] }), (0, jsx_runtime_1.jsxs)("span", { className: "inline-flex items-center gap-1", children: [(0, jsx_runtime_1.jsx)("i", { className: "h-2 w-2 rounded-full bg-slate-800" }), " \u0645\u06CC\u0627\u0646\u0647"] }), (0, jsx_runtime_1.jsxs)("span", { className: "inline-flex items-center gap-1", children: [(0, jsx_runtime_1.jsx)("i", { className: "h-2 w-2 rounded-full bg-indigo-700" }), " \u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631"] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-white p-2.5 text-xs leading-5 text-slate-700", children: [(0, jsx_runtime_1.jsx)("div", { className: "font-bold", children: "\u0645\u0639\u0627\u062F\u0644\u0647 \u062F\u0642\u06CC\u0642 \u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641 \u062F\u0631 sgeooole:" }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-indigo-900", dir: "ltr", children: ["Math.round(", res.basePrice?.toLocaleString(), " \u00D7 (1 - ", res.discountPct, "% / 100)) =", " ", res.floorCeiling?.exactFloorRestored?.toLocaleString() ?? res.finalPrice?.toLocaleString(), " Toman"] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col justify-between rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-sm lg:col-span-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-1.5", children: [(0, jsx_runtime_1.jsx)("span", { className: `rounded-full px-2.5 py-0.5 text-[11px] font-bold ${themeBadgeStyles[previewTheme]}`, children: previewCampaign === "flash"
                                                                    ? "⚡ پیشنهاد لحظه‌ای"
                                                                    : previewCampaign === "featured"
                                                                        ? "🔥 پیشنهاد شگفت‌انگیز"
                                                                        : `⏱️ ${previewCampaignName}` }), (0, jsx_runtime_1.jsxs)("span", { className: "num rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold text-white", children: [res.discountPct ?? 0, "\u066A \u062A\u062E\u0641\u06CC\u0641"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "my-3.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold leading-5 text-slate-800", children: productName }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-1 text-[11px] text-slate-500", children: [format_1.campaignLabel[previewCampaign], " \u00B7 \u062A\u0645 ", format_1.badgeThemeLabel[previewTheme], previewFeatured ? " · ★ در منتخب‌های صفحه اصلی" : ""] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: "text-[11px] text-slate-400", children: "\u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631 \u0628\u0627\u0632\u0627\u0631:" }), (0, jsx_runtime_1.jsxs)("div", { className: "num text-xs text-slate-400 line-through", children: [t(res.basePrice), " \u062A\u0648\u0645\u0627\u0646"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "text-left", children: [(0, jsx_runtime_1.jsxs)("div", { className: "text-[11px] font-medium text-emerald-700", children: ["\u06A9\u0641 \u0642\u0637\u0639\u06CC \u067E\u0633 \u0627\u0632 \u06A9\u0633\u0631 ", res.discountPct, "\u066A:"] }), (0, jsx_runtime_1.jsxs)("div", { className: "num text-base font-extrabold text-emerald-700", children: [t(res.finalPrice), " \u062A\u0648\u0645\u0627\u0646"] })] })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3 md:grid-cols-4", children: [(0, jsx_runtime_1.jsx)(K, { k: "\u062A\u0645\u0627\u0645\u200C\u0634\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631 \u0645\u0646\u062A\u062E\u0628", v: t(res.supply?.effectiveCostPrice) }), (0, jsx_runtime_1.jsx)(K, { k: "\u062E\u0637 \u0642\u0631\u0645\u0632 \u0641\u0631\u0648\u0634 (\u06A9\u0641 \u0633\u0648\u062F)", v: t(res.supply?.hardFloorPrice), warn: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u06A9\u0641 \u0645\u0639\u062A\u0628\u0631 \u0628\u0627\u0632\u0627\u0631 \u062A\u062D\u062A \u0631\u0635\u062F", v: t(res.floorCeiling?.monitoredMarketFloor ?? res.lowestValid) }), (0, jsx_runtime_1.jsx)(K, { k: "\u0633\u0642\u0641 \u0648\u0627\u0642\u0639\u06CC \u0628\u0627\u0632\u0627\u0631 \u062A\u062D\u062A \u0631\u0635\u062F", v: t(res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice) }), (0, jsx_runtime_1.jsx)(K, { k: "\u0642\u06CC\u0645\u062A \u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631 (\u062E\u0637\u200C\u062E\u0648\u0631\u062F\u0647)", v: t(res.basePrice), highlight: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u0642\u06CC\u0645\u062A \u06A9\u0641 \u0642\u0637\u0639\u06CC \u0641\u0631\u0648\u0634 \u0645\u0627", v: t(res.finalPrice), strong: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u0631\u062A\u0628\u0647 \u0645\u0627 \u062F\u0631 \u0645\u0634\u0647\u062F", v: res.position?.projectedLocalRank ? `#${res.position.projectedLocalRank}` : "—", highlight: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u0631\u062A\u0628\u0647 \u0645\u0627 \u062F\u0631 \u06A9\u0644 \u062A\u0631\u0628", v: res.position?.projectedNationalRank
                                                    ? `#${res.position.projectedNationalRank} از ${res.position.totalNationalValidSellers}`
                                                    : "—", highlight: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u062D\u0627\u0634\u06CC\u0647 \u0633\u0648\u062F / \u0627\u06CC\u0645\u0646\u06CC", v: `${t(res.position?.netProfitToman)} (${res.position?.netMarginPct ?? 0}٪)`, strong: true }), (0, jsx_runtime_1.jsx)(K, { k: "\u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 (\u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641)", v: res.discountPct != null ? `${res.discountPct}٪` : "—" }), (0, jsx_runtime_1.jsx)(K, { k: "\u0627\u0633\u062A\u0631\u0627\u062A\u0698\u06CC \u06A9\u0634\u0641 \u06A9\u0641", v: format_1.strategyLabel[res.strategy] ?? res.strategy }), (0, jsx_runtime_1.jsx)(K, { k: "\u062D\u06A9\u0645 \u0646\u0627\u0638\u0631 SystemOne", v: res.rejectedBySupervisor
                                                    ? `⛔ رد کامل (${res.supervisor?.overallScorePct}٪)`
                                                    : res.needsReview
                                                        ? `⏳ ریویو (${res.supervisor?.overallScorePct}٪)`
                                                        : `✅ تایید خودکار (${res.supervisor?.overallScorePct}٪)` })] }), (0, jsx_runtime_1.jsx)("ol", { className: "space-y-1.5", children: res.steps.map((s, i) => ((0, jsx_runtime_1.jsxs)("li", { className: `rounded-xl px-3.5 py-2 text-xs leading-6 ${s.level === "warn" ? "bg-amber-50 text-amber-900" : s.level === "error" ? "bg-rose-50 text-rose-900" : "bg-slate-50 text-slate-700"}`, children: [(0, jsx_runtime_1.jsxs)("b", { children: [s.title, ":"] }), " ", s.message] }, i))) }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-2.5 md:hidden", children: [(0, jsx_runtime_1.jsxs)("h3", { className: "text-sm font-bold text-slate-900", children: ["\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627\u06CC \u062A\u0631\u0628 (", (0, format_1.faNum)(res.offers.length), ")"] }), [...res.offers]
                                                .sort((a, b) => a.price - b.price)
                                                .map((o, i) => ((0, jsx_runtime_1.jsxs)("div", { className: `m-row space-y-1.5 ${o.included ? "" : "opacity-75"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("div", { className: "font-bold text-slate-900", children: o.shopName }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500", children: [(0, jsx_runtime_1.jsx)("span", { className: o.isLocalCity ? "font-bold text-indigo-700" : "", children: o.shopCity ?? "—" }), o.sellerType === "in_person" && (0, jsx_runtime_1.jsx)("span", { className: "badge bg-sky-100 text-sky-700", children: "\u062D\u0636\u0648\u0631\u06CC" }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u00B7 \u0627\u0645\u062A\u06CC\u0627\u0632 ", o.shopScore ?? "—"] })] })] }), (0, jsx_runtime_1.jsx)("div", { className: `num font-bold ${o.included ? "text-slate-900" : "line-through text-slate-400"}`, children: t(o.price) })] }), (0, jsx_runtime_1.jsx)("div", { children: o.included ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-800", children: "\u0628\u0627\u0632\u0627\u0631 \u0645\u0639\u062A\u0628\u0631 \u062A\u062D\u062A \u0631\u0635\u062F" })) : ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-rose-100 text-rose-700", children: ["\u062D\u0630\u0641\u200C\u0634\u062F\u0647 (", o.excludeReason, ")"] })) })] }, i)))] }), (0, jsx_runtime_1.jsx)("div", { className: "table-scroll hidden md:block", children: (0, jsx_runtime_1.jsxs)("table", { className: "data min-w-[600px]", children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "\u0641\u0631\u0648\u0634\u06AF\u0627\u0647" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0634\u0647\u0631" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0642\u06CC\u0645\u062A" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0627\u0645\u062A\u06CC\u0627\u0632" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0648\u0636\u0639\u06CC\u062A \u062F\u0631 \u0631\u0627\u062F\u0627\u0631 \u06A9\u0641 \u0648 \u0633\u0642\u0641" })] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: [...res.offers]
                                                        .sort((a, b) => a.price - b.price)
                                                        .map((o, i) => ((0, jsx_runtime_1.jsxs)("tr", { className: o.included ? "" : "text-slate-400", children: [(0, jsx_runtime_1.jsxs)("td", { children: [o.shopName, o.sellerType === "in_person" && ((0, jsx_runtime_1.jsx)("span", { className: "badge mr-1 bg-sky-100 text-sky-700", children: "\u062D\u0636\u0648\u0631\u06CC" }))] }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("span", { className: o.isLocalCity ? "font-bold text-indigo-700" : "", children: o.shopCity ?? "—" }) }), (0, jsx_runtime_1.jsx)("td", { className: `num ${o.included ? "font-medium" : "line-through"}`, children: t(o.price) }), (0, jsx_runtime_1.jsx)("td", { className: "num text-xs", children: o.shopScore ?? "—" }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: o.included ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-800", children: "\u0628\u0627\u0632\u0627\u0631 \u0645\u0639\u062A\u0628\u0631 \u062A\u062D\u062A \u0631\u0635\u062F" })) : ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-rose-100 text-rose-700", children: ["\u062D\u0630\u0641\u200C\u0634\u062F\u0647 (", o.excludeReason, ")"] })) })] }, i))) })] }) })] }))] })] })] }));
}
function K({ k, v, strong, warn, highlight, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `rounded-xl px-3 py-2 ${highlight
            ? "border border-indigo-200 bg-indigo-50"
            : warn
                ? "border border-amber-200 bg-amber-50"
                : "border border-slate-100 bg-slate-50"}`, children: [(0, jsx_runtime_1.jsx)("div", { className: "text-[11px] text-slate-500", children: k }), (0, jsx_runtime_1.jsx)("div", { className: `num mt-0.5 break-words ${strong
                    ? "font-bold text-emerald-700"
                    : highlight
                        ? "font-bold text-indigo-800"
                        : warn
                            ? "font-bold text-amber-800"
                            : "font-medium text-slate-800"}`, children: v })] }));
}
