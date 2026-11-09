"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MATCH_FLAGS = void 0;
exports.relateCodes = relateCodes;
exports.compareParsed = compareParsed;
const systemone_supervisor_1 = require("../systemone-supervisor");
const lexicon_1 = require("./lexicon");
const parse_1 = require("./parse");
exports.DEFAULT_MATCH_FLAGS = {
    aliasCodes: true,
    tailCodes: true,
    headClass: true,
    riskMarkers: true,
    attrConflicts: true,
    brandConflicts: true,
    approveNeedsId: true,
    softPrice: true,
};
const REL_RANK = { equal: 8, alias: 7, tail: 6, ext_seg: 5, stem: 4, ext_chars: 3, sibling: 2, unrelated: 1 };
const PRIMARY_ATTRS = new Set(["mp", "ch", "cap", "ports", "volt", "amp", "len", "cat", "ctype", "rg", "speed", "poe", "inch", "cabletype", "lens"]);
const SOFT_ATTRS = new Set(["wifi", "ingress", "res"]);
const ATTR_LABEL = {
    mp: "رزولوشن (مگاپیکسل)",
    ch: "تعداد کانال",
    cap: "ظرفیت",
    ports: "تعداد پورت",
    volt: "ولتاژ",
    amp: "آمپر",
    len: "طول",
    cat: "رده کابل (Cat)",
    ctype: "نوع کابل (UTP/FTP)",
    rg: "نوع کواکسیال (RG)",
    speed: "سرعت پورت",
    poe: "PoE",
    inch: "اینچ",
    cabletype: "نوع کابل",
    lens: "لنز",
    wifi: "کلاس Wi-Fi",
    ingress: "درجه IP",
    res: "رزولوشن",
};
// ───────────────────────────── ابزارها ─────────────────────────────
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
function levenshtein(a, b) {
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}
const digitsOf = (s) => (s.match(/\d/g) ?? []).length;
const lettersOf = (s) => (s.match(/[A-Z]/g) ?? []).length;
function stripPrefixSegs(segs) {
    return segs.length >= 2 && (0, parse_1.isAliasPrefix)(segs[0]) ? segs.slice(1) : segs;
}
function segPrefix(shorter, longer) {
    if (shorter.length >= longer.length)
        return false;
    return shorter.every((s, i) => longer[i] === s);
}
/** نسبت طول کدِ کوتاه به بلند که از آن به بعد اختلاف «پسوند واریانت» است نه «ریشهٔ مدل» */
const STEM_RATIO = 0.8;
function relateCodes(a, b) {
    if (a.canon === b.canon)
        return "equal";
    const [s, l] = a.canon.length <= b.canon.length ? [a, b] : [b, a];
    if (l.canon.endsWith(s.canon)) {
        const leftover = l.canon.slice(0, l.canon.length - s.canon.length);
        if (s.canon.length >= 4 && (0, parse_1.isAliasPrefix)(leftover) && digitsOf(s.canon) >= 2)
            return "alias";
        if (s.canon.length >= 5 && digitsOf(s.canon) >= 3 && lettersOf(s.canon) >= 1)
            return "tail";
    }
    // افزودن بخش (سگمنت) جدید: DH-IPC-HFW1431S ⟷ DH-IPC-HFW1431S-S4
    const sv = [s.segs, stripPrefixSegs(s.segs)];
    const lv = [l.segs, stripPrefixSegs(l.segs)];
    for (const x of sv)
        for (const y of lv)
            if (x.length && segPrefix(x, y))
                return "ext_seg";
    // افزودن حرف/رقم به آخرین بخش: DS-2CD1023G0E-I ⟷ DS-2CD1023G0E-IF
    const strippedS = stripPrefixSegs(s.segs).join("");
    const strippedL = stripPrefixSegs(l.segs).join("");
    if ((l.canon.startsWith(s.canon) && s.canon.length >= 5) || (strippedS.length >= 5 && strippedL.startsWith(strippedS))) {
        // پسوند کوتاه روی یک کد کامل (…-I ⟷ …-IF) = مدل هم‌خانوادهٔ متفاوت؛ کد بسیار کوتاه‌تر = «ریشهٔ مدل» (ابهام، نه تضاد)
        const ratio = strippedL.startsWith(strippedS) ? strippedS.length / strippedL.length : s.canon.length / l.canon.length;
        return ratio >= STEM_RATIO ? "ext_chars" : "stem";
    }
    const ed = levenshtein(strippedS, strippedL);
    const maxLen = Math.max(strippedS.length, strippedL.length);
    let common = 0;
    while (common < strippedS.length && strippedS[common] === strippedL[common])
        common++;
    if (ed <= Math.max(2, Math.ceil(maxLen * 0.2)) || (strippedS.length >= 5 && common >= Math.ceil(strippedS.length * 0.6)))
        return "sibling";
    return "unrelated";
}
function numbersClose(a, b) {
    if (a === b)
        return true;
    const d = Math.abs(a - b);
    return d <= 0.06 || d / Math.max(Math.abs(a), Math.abs(b), 1e-9) <= 0.04;
}
function valuesIntersect(a, b) {
    for (const x of a) {
        for (const y of b) {
            if (typeof x === "number" && typeof y === "number") {
                if (numbersClose(x, y))
                    return true;
            }
            else if (String(x) === String(y))
                return true;
        }
    }
    return false;
}
const showVals = (v) => v.join("/");
function stem(w) {
    return w.replace(/(?:های|ها|ان|ی|ه|ات)$/u, "");
}
function compareParsed(t, c, opt) {
    const F = opt.flags;
    const notes = [];
    const vetoes = [];
    const blockers = [];
    let logit = -1.5;
    /** تضادهای ساختاری (فرم/فناوری/نوع دستگاه/مشخصات اصلی): اگر کد یکسان باشد قفل ریویو، وگرنه وتو */
    const structuralConflicts = [];
    const veto = (cap, reason) => {
        vetoes.push({ cap, reason });
    };
    const block = (reason) => {
        blockers.push(reason);
    };
    const tCodes = t.codes.filter((x) => !x.inCompat);
    const cCodes = c.codes.filter((x) => !x.inCompat);
    const cCompatCodes = c.codes.filter((x) => x.inCompat);
    const targetCoded = tCodes.length > 0;
    // ── ۱) نشانگرهای ریسک (فقط کارت ترب نسبت به محصول سایت)
    if (F.riskMarkers) {
        if (c.counterfeit && !t.counterfeit)
            veto(4, `کارت ترب «${c.counterfeit}» (کپی/غیراصل) است`);
        if (c.defective && !t.defective)
            veto(4, `کارت ترب «${c.defective}» (معیوب/قطعه) است`);
        if (c.used && !t.used)
            veto(8, `کارت ترب کالای دست‌دوم/استوک است («${c.used}») ولی محصول سایت نو است`);
        else if (t.used && !c.used)
            block("محصول سایت استوک است ولی کارت ترب نو است");
        const tp = t.pack;
        const cp = c.pack;
        if (cp && !tp)
            veto(10, `پک/باندل چندعددی تشخیص داده شد («${cp.word}»${cp.qty ? ` ×${cp.qty}` : ""}) ولی محصول سایت تکی است`);
        else if (tp && !cp)
            veto(10, "محصول سایت پک/باندل است ولی کارت ترب تکی است");
        else if (tp && cp) {
            if (tp.qty != null && cp.qty != null && tp.qty !== cp.qty)
                veto(10, `تعداد در پک متفاوت است (سایت ${tp.qty} ، ترب ${cp.qty})`);
            else if (tp.qty == null || cp.qty == null)
                block("تعداد اقلام پک مشخص نیست");
        }
        if (c.bundleWith.length && !t.bundleWith.length) {
            veto(10, `کارت ترب مجموعهٔ ترکیبی است (به‌همراه ${c.bundleWith.join("، ")}) ولی محصول سایت تکی است`);
        }
        else if (t.bundleWith.length && !c.bundleWith.length) {
            block("محصول سایت مجموعهٔ ترکیبی است ولی کارت ترب تکی است");
        }
        if (c.withAccessories.length > t.withAccessories.length)
            notes.push("کارت ترب لوازم همراه ذکر کرده است");
    }
    // ── ۲) رده/نوع کالا (head noun)
    let classMatch = "unknown";
    if (F.headClass) {
        const th = t.head;
        const ch = c.head;
        if (th && ch) {
            if (th.cls === ch.cls) {
                classMatch = "match";
                logit += 1.0;
            }
            else {
                classMatch = "conflict";
                if ((0, lexicon_1.isAccessoryClass)(ch.cls) && !(0, lexicon_1.isAccessoryClass)(th.cls)) {
                    veto(5, `لوازم جانبی/قطعه فرعی تشخیص داده شد (کارت ترب از رده «${ch.cls.slice(4)}» است ولی محصول سایت کالای اصلی است)`);
                }
                else {
                    veto(8, `نوع کالا متفاوت است (محصول سایت «${th.cls}» ، کارت ترب «${ch.cls}»)`);
                }
            }
        }
        else if (th && !ch) {
            logit -= 0.6;
            notes.push("نوع کالا در عنوان ترب مشخص نیست");
        }
        else if (!th && ch) {
            if ((0, lexicon_1.isAccessoryClass)(ch.cls)) {
                logit -= 2.5;
                block("کارت ترب لوازم جانبی به نظر می‌رسد و نوع کالای سایت مشخص نیست");
            }
            else {
                logit -= 0.3;
            }
        }
        // ویژگی‌های فرعی (بولت/دام ، IP/آنالوگ ، DVR/NVR ، اینترنال/اکسترنال)
        if (classMatch === "match") {
            const featConflicts = [];
            for (const key of ["form", "tech", "hddkind"]) {
                const tv = t.features[key];
                const cv = c.features[key];
                if (tv?.length && cv?.length) {
                    // «IP» به‌تنهایی در برخی عنوان‌ها هر دو فناوری را می‌رساند؛ اشتراک کافی است
                    if (!tv.some((x) => cv.includes(x)))
                        featConflicts.push(`${key}: ${tv.join("/")} ≠ ${cv.join("/")}`);
                    else
                        logit += 0.4;
                }
            }
            const subsOf = (p) => p.hits.filter((h) => h.cls === "recorder" && h.sub).map((h) => h.sub);
            const ts = subsOf(t);
            const cs = subsOf(c);
            if (ts.length && cs.length && !ts.some((x) => cs.includes(x)))
                featConflicts.push(`نوع دستگاه ضبط: ${ts.join("/")} ≠ ${cs.join("/")}`);
            if (F.attrConflicts)
                structuralConflicts.push(...featConflicts);
        }
    }
    // ── ۳) برند
    const tExplicit = (0, lexicon_1.expandBrands)(t.brands);
    const cExplicit = (0, lexicon_1.expandBrands)(c.brands);
    const tAll = (0, lexicon_1.expandBrands)([...t.brands, ...t.impliedBrands]);
    const cAll = (0, lexicon_1.expandBrands)([...c.brands, ...c.impliedBrands]);
    let brand = "unknown";
    let explicitBrandAgree = false;
    if (tAll.size && cAll.size) {
        const inter = [...tAll].some((b) => cAll.has(b));
        brand = inter ? "match" : "conflict";
        explicitBrandAgree = tExplicit.size > 0 && cExplicit.size > 0 && [...tExplicit].some((b) => cExplicit.has(b));
    }
    // ── ۴) کد مدل
    let codeRel = "none";
    let positiveId = false;
    const matchedCodes = [];
    const missingCodes = [];
    let identityKey = "";
    let relBest = null;
    let tcBest = null;
    let ccBest = null;
    if (targetCoded) {
        if (!cCodes.length) {
            logit -= 1.2;
            block("کد مدل در عنوان کارت ترب نیست؛ هویت فقط با مشخصات قابل‌احراز نیست");
            for (const tc of tCodes)
                missingCodes.push(tc.raw);
            if (cCompatCodes.length)
                notes.push("کد مدل فقط در بند «مناسب برای …» ذکر شده (میزبان است نه خود کالا)");
        }
        else {
            const per = tCodes.map((tc) => {
                let best = null;
                for (const cc of cCodes) {
                    const rel = relateCodes(tc, cc);
                    if (!best || REL_RANK[rel] > REL_RANK[best.rel])
                        best = { rel, cc };
                }
                return { tc, best: best };
            });
            per.sort((x, y) => REL_RANK[y.best.rel] - REL_RANK[x.best.rel]);
            const top = per[0];
            relBest = top.best.rel;
            tcBest = top.tc;
            ccBest = top.best.cc;
            codeRel = relBest;
            for (const p of per)
                (REL_RANK[p.best.rel] >= REL_RANK.ext_seg ? matchedCodes : missingCodes).push(p.tc.raw);
            const spec = Math.max(0.5, Math.min(1, 0.45 + 0.07 * top.tc.canon.length));
            const rank = REL_RANK[relBest];
            if (relBest === "equal") {
                logit += 7.0 * spec;
                notes.push(`کد مدل دقیقاً یکسان: ${top.tc.canon}`);
                positiveId = true;
            }
            else if (relBest === "alias") {
                if (F.aliasCodes) {
                    logit += 5.6 * spec;
                    notes.push(`کد مدل هم‌ارز با حذف پیشوند برند: ${top.tc.raw} ⟷ ${top.best.cc.raw}`);
                    positiveId = true;
                }
                else {
                    veto(20, `کد مدل متفاوت است (${top.tc.raw} ≠ ${top.best.cc.raw})`);
                }
            }
            else if (relBest === "tail") {
                if (F.tailCodes) {
                    logit += 3.4 * spec;
                    notes.push(`کد ناقص منطبق: ${top.tc.raw} ⊂ ${top.best.cc.raw} (کد کامل تأیید نشد)`);
                    block("کد مدل محصول سایت ناقص است و فقط بخشی از کد کارت ترب را می‌پوشاند");
                }
                else {
                    veto(20, `کد مدل متفاوت است (${top.tc.raw} ≠ ${top.best.cc.raw})`);
                }
            }
            else if (relBest === "ext_seg") {
                logit += 1.6;
                notes.push(`کد مدل با افزوده/کسری بخش پایانی: ${top.tc.raw} ⟷ ${top.best.cc.raw} (ممکن است نسخهٔ متفاوت باشد)`);
                block("پسوند/نسخهٔ کد مدل بین سایت و ترب یکسان نیست");
            }
            else if (relBest === "stem") {
                logit += 0.8;
                notes.push(`کد مدل یکی از دو طرف فقط ریشهٔ مدل است: ${top.tc.raw} ⟷ ${top.best.cc.raw}`);
                block("کد مدل ناقص/ریشه‌ای است و مدل دقیق تایید نشد");
            }
            else if (relBest === "ext_chars" || relBest === "sibling") {
                veto(20, `کد مدل مشابه ولی متفاوت (هم‌خانواده): سایت «${top.tc.raw}» ، ترب «${top.best.cc.raw}»`);
            }
            else {
                veto(20, `عدم تطابق کد مدل فنی: «${tCodes.map((x) => x.raw).join(", ")}» در کارت ترب («${cCodes.map((x) => x.raw).join(", ")}») نیست`);
            }
            // چند کد در محصول سایت: همه باید پوشش داده شوند
            if (rank >= REL_RANK.ext_seg && per.length > 1 && per.some((p) => REL_RANK[p.best.rel] < REL_RANK.ext_seg)) {
                block("محصول سایت چند کد دارد و همهٔ آنها در کارت ترب تایید نشد");
            }
            // کدهای اضافیِ هم‌خانواده در کارت ترب (دو مدل در یک کارت)
            if (rank >= REL_RANK.ext_seg) {
                const extras = cCodes.filter((cc) => cc !== ccBest && tCodes.every((tc) => REL_RANK[relateCodes(tc, cc)] < REL_RANK.ext_seg));
                if (extras.some((cc) => ccBest && REL_RANK[relateCodes(ccBest, cc)] >= REL_RANK.sibling && relateCodes(ccBest, cc) !== "unrelated")) {
                    block("کارت ترب چند مدل هم‌خانواده را با هم ذکر کرده است");
                }
            }
            identityKey = `code:${top.tc.canon}`;
        }
    }
    else if (cCodes.length) {
        logit -= 0.5;
        block("محصول سایت کد مدل ندارد ولی کارت ترب مدل مشخصی دارد؛ تطابق مدل قابل‌احراز نیست");
        notes.push(`کارت ترب کد مدل «${cCodes.map((x) => x.raw.toUpperCase()).join(", ")}» دارد`);
    }
    // قفل‌های وابسته به برند برای کدهای کوتاه/هم‌ارز
    if (targetCoded && relBest && (relBest === "equal" || relBest === "alias") && tcBest && ccBest) {
        const shorter = Math.min(tcBest.canon.length, ccBest.canon.length);
        const shortestCanon = tcBest.canon.length <= ccBest.canon.length ? tcBest.canon : ccBest.canon;
        const distinctive = shorter >= 8 && digitsOf(shortestCanon) >= 3;
        if (relBest === "alias" && !(distinctive || (brand === "match" && explicitBrandAgree))) {
            block("کد با حذف پیشوند برند هم‌ارز شد ولی کد کوتاه است و برند مشترک صریحی تایید نشد");
        }
        if (shorter <= 6 && brand !== "match")
            block("کد مدل کوتاه است و برند مشترکی برای راستی‌آزمایی نیست");
    }
    // ── ۵) برند: امتیاز/تضاد
    if (brand === "match")
        logit += targetCoded ? 1.0 : 2.0;
    else if (brand === "conflict" && F.brandConflicts) {
        if (positiveId && relBest === "equal")
            block(`برند متضاد با وجود کد یکسان (سایت: ${[...tAll].join("/")} ، ترب: ${[...cAll].join("/")})`);
        else
            veto(22, `برند متفاوت است (سایت: ${[...tAll].join("/")} ، ترب: ${[...cAll].join("/")})`);
    }
    else if (brand === "unknown" && !targetCoded) {
        if (cAll.size && !tAll.size)
            block("برند محصول سایت مشخص نیست ولی کارت ترب برند دارد");
        else if (tAll.size && !cAll.size)
            block("برند کارت ترب در عنوان نیامده است");
    }
    // ── ۶) مشخصات تایپ‌شده
    const idByCode = positiveId; // شناسایی مثبت از راه کد (equal/alias)
    const attrKeys = new Set([...Object.keys(t.attrs), ...Object.keys(c.attrs)]);
    let attrMatches = 0;
    let primaryUnverified = 0;
    let primaryExtra = 0;
    const hardConflicts = [];
    const softConflicts = [];
    const multiValued = [];
    for (const key of attrKeys) {
        const tv = t.attrs[key];
        const cv = c.attrs[key];
        const primary = PRIMARY_ATTRS.has(key);
        if (primary && ((tv?.length ?? 0) > 1 || (cv?.length ?? 0) > 1))
            multiValued.push(ATTR_LABEL[key] ?? key);
        if (tv?.length && cv?.length) {
            if (valuesIntersect(tv, cv)) {
                attrMatches++;
                logit += targetCoded ? 0.35 : 0.9;
            }
            else if (primary)
                hardConflicts.push(`${ATTR_LABEL[key] ?? key}: سایت «${showVals(tv)}» ، ترب «${showVals(cv)}»`);
            else
                softConflicts.push(`${ATTR_LABEL[key] ?? key}: «${showVals(tv)}» ≠ «${showVals(cv)}»`);
        }
        else if (tv?.length && !cv?.length) {
            // رزولوشن: mp سایت در برابر 1080p ترب
            if (key === "mp" && c.attrs.res?.length) {
                const ok = tv.some((x) => typeof x === "number" && c.attrs.res.some((y) => typeof y === "number" && Math.abs(x - y) <= 1.01));
                if (!ok)
                    softConflicts.push(`رزولوشن: سایت ${showVals(tv)}MP ، ترب ${showVals(c.attrs.res)}MP-معادل`);
                else
                    attrMatches++;
            }
            else if (primary && key !== "poe")
                primaryUnverified++;
        }
        else if (cv?.length && !tv?.length) {
            if (key === "res" && t.attrs.mp?.length)
                continue;
            if (primary)
                primaryExtra++;
        }
    }
    if (hardConflicts.length && F.attrConflicts)
        structuralConflicts.push(...hardConflicts);
    if (structuralConflicts.length) {
        if (idByCode)
            block(`تضاد مشخصات با وجود کد مدل یکسان — ${structuralConflicts.join(" | ")}`);
        else
            veto(18, `تضاد مشخصات فنی: ${structuralConflicts.join(" | ")}`);
    }
    if (softConflicts.length && F.attrConflicts) {
        if (idByCode)
            notes.push(`مشخصهٔ فرعی متفاوت (با کد یکسان، قفل نمی‌کند): ${softConflicts.join(" | ")}`);
        else {
            logit -= 1.5;
            block(`مشخصهٔ فرعی متفاوت: ${softConflicts.join(" | ")}`);
        }
    }
    if (multiValued.length && !idByCode)
        block(`یک عنوان چند مقدار متفاوت برای ${[...new Set(multiValued)].join("، ")} دارد (مجموعهٔ چندنسخه‌ای/عنوان متناقض)`);
    if (!targetCoded) {
        if (primaryUnverified)
            block("بخشی از مشخصات محصول سایت در کارت ترب ذکر نشده و راستی‌آزمایی نشد");
        if (primaryExtra)
            block("کارت ترب مشخصاتی دارد که در محصول سایت ذکر نشده (ممکن است مدل متفاوتی باشد)");
    }
    // ── ۷) واژه‌های توصیفی (مهم‌تر برای کالای بی‌کد)
    const cWords = new Set(c.words.map(stem));
    const cNorm = ` ${c.norm} `;
    let coverage = 1;
    if (t.words.length) {
        let hit = 0;
        for (const w of t.words)
            if (cWords.has(stem(w)) || cNorm.includes(` ${w} `))
                hit++;
        coverage = hit / t.words.length;
        logit += (targetCoded ? 0.5 : 1.4) * coverage - (targetCoded ? 0.2 : 0.5);
        if (!targetCoded) {
            const need = t.words.length >= 4 ? 0.75 : 0.99;
            if (coverage < need) {
                logit -= 1.0;
                block("واژه‌های اختصاصی محصول سایت (نام سری/نسخه) در کارت ترب پوشش کامل ندارد");
            }
        }
    }
    // واژه‌های اختصاصیِ فقط-در-ترب: نام سری لاتین (Elements/Extreme)، واژهٔ نوع‌ساز (مدیریتی/پرو) یا توضیحات زیاد
    // ⇒ برای کالای بی‌کد مانع تایید خودکارند (ممکن است واریانت/برند دیگری باشد)
    const tStems = new Set(t.words.map(stem));
    const tNorm = ` ${t.norm} `;
    const candOnly = c.words.filter((w) => !tStems.has(stem(w)) && !tNorm.includes(` ${w} `));
    if (!targetCoded) {
        const latin = candOnly.filter((w) => /^[a-z]{3,}$/.test(w));
        const variant = candOnly.filter((w) => lexicon_1.VARIANT_WORDS.has(w));
        const other = candOnly.filter((w) => !/^[a-z]{3,}$/.test(w));
        if (latin.length)
            block(`کارت ترب نام سری/نسخهٔ لاتین دارد که در محصول سایت نیست («${latin.slice(0, 3).join("، ")}»)`);
        else if (variant.length)
            block(`کارت ترب واژهٔ نوع‌ساز دارد که در محصول سایت نیست («${variant.slice(0, 3).join("، ")}»)`);
        else if (other.length > (brand === "match" ? 3 : 1))
            block("کارت ترب توضیحات اختصاصی بیشتری از محصول سایت دارد (برند/سری/نسخهٔ احتمالاً متفاوت)");
        for (const key of ["form", "tech", "hddkind"]) {
            if (c.features[key]?.length && !t.features[key]?.length)
                block(`کارت ترب ویژگی «${c.features[key].join("/")}» دارد که در محصول سایت ذکر نشده`);
        }
    }
    // ── ۸) قیمت (لنگر نرم)
    if (F.softPrice && opt.priceRatio != null && Number.isFinite(opt.priceRatio) && opt.priceRatio > 0) {
        const r = opt.priceRatio;
        if (r < 0.42) {
            veto(12, `قیمت کارت ترب بیش از ۵۸٪ کمتر از لنگر قیمت محصول است — احتمال قطعه جانبی یا کالای اشتباه`);
        }
        else if (r > 2.3) {
            veto(15, `قیمت کارت ترب بیش از ۲.۳ برابر لنگر قیمت محصول است — احتمال پک چندتایی یا مدل بالاتر`);
        }
        else if (r < 0.55 || r > 1.9) {
            logit -= 1.6;
            block("قیمت کارت ترب نسبت به لنگر قیمت محصول غیرعادی است");
        }
        else if (r >= 0.85 && r <= 1.3) {
            logit += 0.5;
            notes.push("هم‌خوانی قیمت با لنگر محصول");
        }
    }
    // ── ۹) معیار تایید برای کالای بی‌کد: همهٔ مشخصات راستی‌آزمایی‌شده + رده + برند (یا هر دو نامعلوم) + هم‌خوانی قیمت
    if (!targetCoded) {
        const hasAnchorEvidence = attrMatches > 0 || (t.words.length > 0 && coverage >= 0.99);
        const brandOk = brand === "match";
        if (classMatch !== "match")
            block("نوع کالا برای راستی‌آزمایی بدون کد مدل کافی نیست");
        if (!brandOk)
            block("برند مشترک برای کالای بدون کد مدل تایید نشد");
        if (!hasAnchorEvidence)
            block("مشخصه‌ای برای راستی‌آزمایی کالای بدون کد مدل وجود ندارد");
        if (F.softPrice && opt.priceRatio != null && (opt.priceRatio < 0.6 || opt.priceRatio > 1.7)) {
            block("برای کالای بدون کد مدل، قیمت کارت ترب باید به لنگر قیمت نزدیک باشد (۰٫۶ تا ۱٫۷ برابر)");
        }
        positiveId = blockers.length === 0 && !vetoes.length && classMatch === "match" && brandOk && hasAnchorEvidence;
        if (positiveId)
            logit += 2.4;
    }
    // ───── ترکیب نهایی
    const reviewCap = Math.max(opt.rejectBelowPct + 5, opt.approveAbovePct - 6);
    let score = Math.round(100 * sigmoid(logit));
    let rejectReason;
    if (vetoes.length) {
        const cap = Math.min(...vetoes.map((v) => v.cap));
        score = Math.min(score, cap);
        rejectReason = vetoes.map((v) => v.reason).join(" ؛ ");
    }
    else {
        if (blockers.length)
            score = Math.min(score, reviewCap);
        if (F.approveNeedsId && !positiveId)
            score = Math.min(score, reviewCap);
    }
    score = Math.max(0, Math.min(100, score));
    const verdict = (0, systemone_supervisor_1.classifyThreeZoneScore)(score, opt.rejectBelowPct, opt.approveAbovePct);
    if (verdict === "reject" && !rejectReason) {
        rejectReason = `امتیاز تطابق (${score}%) زیر خط قرمز رد ناظر (${opt.rejectBelowPct}%) است`;
    }
    if (!identityKey) {
        identityKey = `desc:${[...tAll].sort().join(",")}|${t.head?.cls ?? "?"}|${Object.entries(c.attrs)
            .map(([k, v]) => `${k}=${showVals(v)}`)
            .sort()
            .join(",")}`;
    }
    return {
        score,
        verdict,
        rejectReason,
        matchedCodes,
        missingCodes,
        notes: [...notes, ...blockers.map((b) => `⚠ ${b}`)],
        codeRel,
        brand,
        identityKey,
        positiveId,
        blockers,
        vetoes: vetoes.map((v) => v.reason),
    };
}
