"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeTargetProduct = decomposeTargetProduct;
exports.buildSearchQueryPlan = buildSearchQueryPlan;
exports.buildSearchQueries = buildSearchQueries;
exports.extractVocabularyExpansions = extractVocabularyExpansions;
const descriptors_1 = require("../pricing/match/descriptors");
const lexicon_1 = require("../pricing/match/lexicon");
const parse_1 = require("../pricing/match/parse");
const text_1 = require("../pricing/match/text");
const PERSIAN_DIGITS_WORD = new Map(Object.entries(text_1.NUMBER_WORDS).map(([word, num]) => [num, word]));
function formatFrequency(hz) {
    if (hz >= 1_000_000_000) {
        const ghz = hz / 1_000_000_000;
        return { short: String(ghz), withMhz: `${ghz}GHz`, fa: `${ghz} گیگاهرتز` };
    }
    if (hz >= 1_000_000) {
        const mhz = hz / 1_000_000;
        return { short: String(mhz), withMhz: `${mhz}MHz`, fa: `${mhz} مگاهرتز` };
    }
    if (hz >= 1_000) {
        const khz = hz / 1_000;
        return { short: `${khz} khz`, withMhz: `${khz}KHz`, fa: `${khz} کیلوهرتز` };
    }
    return { short: `${hz} hz`, withMhz: `${hz}Hz`, fa: `${hz} هرتز` };
}
function buildTechSpecs(parsed) {
    const specs = [];
    const attrs = parsed.attrs;
    const pushSpec = (key, values, formatter) => {
        if (!values?.length)
            return;
        for (const value of values) {
            const formatted = formatter(value);
            if (!formatted)
                continue;
            specs.push({
                key,
                canonical: `${key}:${value}`,
                display: formatted.display,
                alternatives: formatted.alternatives ?? [],
            });
        }
    };
    pushSpec("frequency", attrs.frequency, (v) => {
        if (typeof v !== "number")
            return null;
        const f = formatFrequency(v);
        return { display: f.short, alternatives: [f.withMhz, `فرکانس ${f.short}`, f.fa] };
    });
    pushSpec("buttons", attrs.buttons, (v) => {
        if (typeof v !== "number")
            return null;
        const word = PERSIAN_DIGITS_WORD.get(v);
        return {
            display: `${v} دکمه`,
            alternatives: [...(word ? [`${word} دکمه`, `${word} کلید`] : []), `${v} کلید`, `${v} button`],
        };
    });
    pushSpec("bluetooth", attrs.bluetooth, (v) => v === "yes" ? { display: "بلوتوثی", alternatives: ["بلوتوث", "bluetooth"] } : null);
    pushSpec("mp", attrs.mp, (v) => ({ display: `${v} مگاپیکسل`, alternatives: [`${v}mp`, `${v}MP`] }));
    pushSpec("ch", attrs.ch, (v) => ({ display: `${v} کانال`, alternatives: [`${v}ch`] }));
    pushSpec("cap", attrs.cap, (v) => {
        if (typeof v !== "number")
            return null;
        if (v >= 1000 && v % 1000 === 0) {
            const tb = v / 1000;
            return { display: `${tb} ترابایت`, alternatives: [`${tb}tb`, `${tb}TB`] };
        }
        return { display: `${v} گیگابایت`, alternatives: [`${v}gb`, `${v}GB`] };
    });
    pushSpec("ram", attrs.ram, (v) => ({ display: `رم ${v}`, alternatives: [`${v}gb ram`] }));
    pushSpec("ports", attrs.ports, (v) => ({ display: `${v} پورت`, alternatives: [`${v} port`] }));
    pushSpec("volt", attrs.volt, (v) => ({ display: `${v} ولت`, alternatives: [`${v}v`, `${v}V`] }));
    pushSpec("amp", attrs.amp, (v) => ({ display: `${v} آمپر`, alternatives: [`${v}a`, `${v}A`] }));
    pushSpec("watt", attrs.watt, (v) => {
        if (typeof v !== "number")
            return null;
        return v >= 1000 && v % 1000 === 0
            ? { display: `${v / 1000} کیلووات`, alternatives: [`${v / 1000}kw`] }
            : { display: `${v} وات`, alternatives: [`${v}w`] };
    });
    pushSpec("va", attrs.va, (v) => ({ display: `${v} ولت آمپر`, alternatives: [`${v}va`] }));
    pushSpec("ah", attrs.ah, (v) => ({ display: `${v} آمپر ساعت`, alternatives: [`${v}ah`] }));
    pushSpec("len", attrs.len, (v) => ({ display: `${v} متر`, alternatives: [`${v}m`, `${v} متری`] }));
    pushSpec("cat", attrs.cat, (v) => ({ display: `cat${v}`, alternatives: [`کت ${v}`, `cat ${v}`] }));
    pushSpec("ctype", attrs.ctype, (v) => ({ display: String(v).toUpperCase(), alternatives: [String(v)] }));
    pushSpec("poles", attrs.poles, (v) => ({ display: `${v}p`, alternatives: [`${v} پل`] }));
    pushSpec("curve", attrs.curve, (v) => ({ display: `تیپ ${v}`, alternatives: [String(v)] }));
    pushSpec("lens", attrs.lens, (v) => ({ display: `لنز ${v}`, alternatives: [`${v}mm`] }));
    pushSpec("access_model", attrs.access_model, (v) => ({ display: `مدل ${v}`, alternatives: [String(v)] }));
    return specs;
}
function stripLeadingBrandPrefix(code) {
    if (code.segs.length < 2 || !(0, parse_1.isAliasPrefix)(code.segs[0]))
        return null;
    const tail = code.segs.slice(1).join("-");
    return tail.replace(/[^a-z0-9]/gi, "").length >= 5 ? tail : null;
}
function decomposeTargetProduct(productName, sku) {
    const parsed = (0, parse_1.parseTitle)(productName, { sku });
    const coreName = productName
        .replace(/\s*[([]\s*(?:مناسب|مخصوص|ویژه|جهت|برای|compatible|for)\s[^)\]]*[)\]]/gi, " ")
        .split(/\s+(?:مناسب\s+برای|مخصوص|ویژهٔ?|جهت|compatible\s+with)\s+/i)[0]
        .trim() || productName;
    const identity = (0, parse_1.parseTitle)(coreName, { sku });
    const activeParsed = identity.head || identity.codes.length ? identity : parsed;
    const headTokens = activeParsed.head ? activeParsed.tokens.slice(activeParsed.head.at, activeParsed.head.at + activeParsed.head.len) : [];
    const primaryCodes = parsed.codes.filter((item) => !item.inCompat);
    const wordParts = productName.split(/[\s،,;()[\]]+/);
    const modelCodes = primaryCodes.map((code) => wordParts.find((word) => (0, text_1.normalizeText)(word).replace(/[^0-9a-z]/g, "").toUpperCase() === code.canon) ?? code.raw);
    const strippedModelCodes = [...new Set(primaryCodes.map(stripLeadingBrandPrefix).filter((x) => Boolean(x)))];
    const brands = [...new Set([...parsed.brands, ...primaryCodes.map((c) => c.brandHint).filter((b) => Boolean(b))])];
    const primaryBrand = brands[0];
    const brandAliases = primaryBrand ? (0, lexicon_1.brandDisplayAliases)(primaryBrand) : {};
    const technicalSpecs = buildTechSpecs(activeParsed);
    const hardConstraints = [
        ...(activeParsed.head ? [`class:${activeParsed.head.cls}`] : []),
        ...primaryCodes.map((c) => `code:${c.canon}`),
        ...technicalSpecs.map((s) => s.canonical),
        ...(activeParsed.packageUnits != null ? [`units:${activeParsed.packageUnits}`] : []),
    ];
    const strongEvidence = [
        ...brands.map((b) => `brand:${b}`),
        ...activeParsed.words.slice(0, 4).map((w) => `desc:${w}`),
    ];
    const accessoryIndicators = parsed.hits.filter((h) => (0, lexicon_1.isAccessoryClass)(h.cls)).map((h) => h.cls);
    return {
        productName,
        coreName,
        sku,
        parsed: { ...activeParsed, tokens: parsed.tokens.includes("ایفون") && !activeParsed.tokens.includes("ایفون") ? parsed.tokens : activeParsed.tokens },
        productClass: activeParsed.head?.cls ?? null,
        headTokens,
        brands,
        brandAliases,
        modelCodes,
        strippedModelCodes,
        hardConstraints,
        strongEvidence,
        descriptors: activeParsed.words,
        packageUnits: activeParsed.packageUnits ?? parsed.packageUnits,
        accessoryIndicators,
        technicalSpecs,
        isCodeless: !primaryCodes.some((item) => item.canon.length >= 3),
    };
}
function tokenBagKey(normalized) {
    return normalized.split(" ").filter(Boolean).sort().join(" ");
}
function buildSearchQueryPlan(productName, sku) {
    const profile = decomposeTargetProduct(productName, sku);
    const plan = [];
    const seenExact = new Set();
    const seenBag = new Set();
    const add = (query, strategy, phase, priority, allowReordered = false) => {
        const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
        const normalized = (0, text_1.normalizeText)(text);
        if (normalized.length < 3 || seenExact.has(normalized))
            return;
        const bag = tokenBagKey(normalized);
        if (!allowReordered && seenBag.has(bag))
            return;
        seenExact.add(normalized);
        seenBag.add(bag);
        plan.push({ query: text, strategy, phase, priority });
    };
    const { parsed, coreName, brands, brandAliases, headTokens, technicalSpecs, descriptors } = profile;
    const brand = brands[0];
    const brandFa = brandAliases.fa && brandAliases.fa !== brand ? brandAliases.fa : undefined;
    const brandEn = brandAliases.en ?? brand;
    const rawCode = parsed.codes.filter((item) => !item.inCompat && item.canon.length >= 5)
        .sort((a, b) => b.canon.length - a.canon.length)[0];
    add(coreName || productName, "exact", "fast", 100, true);
    const rawCodeFromTitle = (0, parse_1.parseTitle)(coreName).codes.some((item) => !item.inCompat && item.canon.length >= 5);
    if (rawCode) {
        const original = productName.split(/[\s،,;()[\]]+/)
            .find((word) => (0, text_1.normalizeText)(word).replace(/[^0-9a-z]/g, "").toUpperCase() === rawCode.canon) ?? rawCode.raw;
        add(original, "model_code", "fast", 95);
        if (brand && !original.toLowerCase().startsWith(brand)) {
            add(`${brand} ${original}`, "brand", "fast", 90);
        }
        const stripped = stripLeadingBrandPrefix(rawCode);
        if (stripped) {
            add(brandFa ? `${brandFa} ${stripped}` : brand ? `${brand} ${stripped}` : stripped, "model_code", "expand", 84);
            add(stripped, "model_code", "expand", 80);
        }
        if (brandFa)
            add(`${brandFa} ${original}`, "alternative_wording", "expand", 78);
        if (headTokens.length)
            add([...headTokens, brandFa ?? brandEn, original].filter(Boolean).join(" "), "alternative_wording", "expand", 75);
        if (rawCodeFromTitle)
            return plan;
    }
    if (parsed.family === "remotag" && (!parsed.head || parsed.head.cls === "access_control")) {
        const brandLabel = brand === "beta" ? "بتا" : brandFa ?? brand ?? "";
        add(`ریموتگ ${brandLabel}`, "brand", "fast", 92);
        add(`اکسس کنترل ریموتگ ${brandLabel}`, "descriptor", "fast", 88);
        const intercom = profile.parsed === parsed
            ? parsed.tokens.includes("ایفون")
            : (0, parse_1.parseTitle)(productName, { sku }).tokens.includes("ایفون");
        add(`برد کنترل دسترسی ریموتگ ${intercom ? "آیفون " : ""}${brandLabel}`, "alternative_wording", "fast", 84);
        if (intercom)
            add(`ماژول کارتی ریموتی آیفون ${brandLabel}`, "alternative_wording", "fast", 80);
        return plan;
    }
    const head = headTokens;
    const words = descriptors.slice(0, 3);
    const remote = parsed.head?.cls === "acc:remote";
    if (!remote && words.length && (brand || head.length)) {
        add([...head, brand, ...words].filter(Boolean).join(" "), "descriptor", "fast", 90);
    }
    const codelessSearchTarget = head.length > 0 && (!rawCodeFromTitle || !parsed.codes.some((item) => !item.inCompat));
    if (codelessSearchTarget) {
        const freqSpec = technicalSpecs.find((s) => s.key === "frequency");
        const [frequency] = parsed.attrs.frequency ?? [];
        const rf = typeof frequency === "number" && parsed.attrs.frequency.length === 1
            ? formatFrequency(frequency).short
            : undefined;
        const [descriptor] = words;
        const [buttons] = parsed.attrs.buttons ?? [];
        const hasBt = parsed.attrs.bluetooth?.includes("yes");
        if (remote) {
            const chSpec = technicalSpecs.find((s) => s.key === "ch");
            const [channels] = parsed.attrs.ch ?? [];
            const styleToken = parsed.designStyle ? (0, text_1.normalizeText)(parsed.designStyle.replace(/^طرح\s+/u, "")) : "";
            const allDescWords = parsed.descriptorWords ?? words;
            const classified = allDescWords.map((w) => (0, descriptors_1.classifyDescriptorToken)(w, "acc:remote"));
            const colorWords = classified.filter((d) => d.group === "color").map((d) => d.token);
            const marketingWords = classified.filter((d) => d.group === "marketing").map((d) => d.token);
            const softStyleWords = classified.filter((d) => ["cosmetic_style", "shape", "material"].includes(d.group)).map((d) => d.token);
            const functionalDescriptors = words.filter((w) => w !== styleToken && !marketingWords.includes(w) && !colorWords.includes(w) && !softStyleWords.includes(w));
            const primaryDesc = functionalDescriptors[0] ?? colorWords[0] ?? softStyleWords[0] ?? words[0];
            const secondaryDesc = functionalDescriptors[1] ?? (functionalDescriptors[0] ? colorWords[0] ?? softStyleWords[0] : colorWords[1] ?? softStyleWords[1]);
            const pairedDesc = functionalDescriptors.slice(0, 2).join(" ");
            // فقط وقتی واژهٔ اصلی توصیف طرح/مدل واقعی است (نه صفت تبلیغاتی مثل «لوکس» یا رنگ/جنس) عبارت «طرح ...» بساز.
            const designCandidate = functionalDescriptors.find((w) => w !== "لرن" && w !== "دیواری");
            const altStyle = parsed.designStyle ?? (designCandidate ? `طرح ${designCandidate}` : undefined);
            const colorDesc = colorWords[0];
            const marketingDesc = marketingWords[0];
            // Preserve proven fast core remote queries while ensuring strong brandless/wall/channel/learn-code/design/color/alias coverage.
            if (functionalDescriptors.length || brand) {
                add([...head, primaryDesc, rf, brand].filter(Boolean).join(" "), "technical", "fast", 94);
            }
            else if (rf && (hasBt || colorDesc)) {
                add([...head, hasBt ? "بلوتوثی" : undefined, colorDesc, rf].filter(Boolean).join(" "), "technical", "fast", 95);
                if (colorDesc) {
                    add([...head, colorDesc, "فرکانس", rf].filter(Boolean).join(" "), "alternative_wording", "fast", 92);
                }
                add([...head, hasBt ? "بلوتوثی" : undefined, rf].filter(Boolean).join(" "), "technical", "fast", 90);
                if (marketingDesc && hasBt) {
                    add([...head, "بلوتوثی", marketingDesc].join(" "), "descriptor", "expand", 82);
                }
            }
            if (functionalDescriptors.length >= 2 && rf) {
                add([...head, pairedDesc, rf, brand].filter(Boolean).join(" "), "technical", "fast", 93);
            }
            if (secondaryDesc && rf) {
                add([...head, secondaryDesc, rf, brand].filter(Boolean).join(" "), "technical", "fast", 92);
            }
            if (functionalDescriptors.includes("لرن") && rf) {
                add([...head, secondaryDesc && secondaryDesc !== "لرن" ? secondaryDesc : undefined, "کد لرن", rf, brand].filter(Boolean).join(" "), "alternative_wording", "fast", 91);
            }
            if (chSpec && rf) {
                add([...head, secondaryDesc && secondaryDesc !== "لرن" ? secondaryDesc : primaryDesc, chSpec.display, rf, brand].filter(Boolean).join(" "), "technical", brand ? "fast" : "expand", 90);
            }
            if (rf)
                add([...head, rf, brand].filter(Boolean).join(" "), "technical", brand ? "fast" : "expand", 89);
            if (primaryDesc && brand)
                add([...head, primaryDesc, brand].join(" "), "brand", "fast", 86);
            if (pairedDesc && !brand)
                add([...head, pairedDesc].join(" "), "descriptor", "expand", 84);
            else if (primaryDesc && functionalDescriptors.length)
                add([...head, primaryDesc].join(" "), "descriptor", "fast", 82);
            if (primaryDesc && buttons)
                add([...head, primaryDesc, String(buttons), "دکمه"].join(" "), "descriptor", "fast", 78);
            // Phase 2 expansion queries: catch brandless consolidated cards, «طرح <style>», learn-code synonyms, Persian brands, and frequency units.
            if (primaryDesc && rf) {
                add([...head, hasBt ? "بلوتوثی" : undefined, primaryDesc, rf].filter(Boolean).join(" "), "technical", "expand", 89);
                if (altStyle) {
                    add([...head, hasBt ? "بلوتوثی" : undefined, secondaryDesc && secondaryDesc !== styleToken ? secondaryDesc : undefined, altStyle, rf].filter(Boolean).join(" "), "alternative_wording", "expand", 87);
                    add([...head, altStyle, rf].filter(Boolean).join(" "), "alternative_wording", "expand", 80);
                }
            }
            if (functionalDescriptors.includes("لرن") && rf) {
                add([...head, "کد لرن", rf].join(" "), "alternative_wording", "expand", 88);
                add([...head, secondaryDesc && secondaryDesc !== "لرن" ? secondaryDesc : undefined, "کد لرن", freqSpec?.alternatives[2] ?? rf].filter(Boolean).join(" "), "alternative_wording", "expand", 86);
                add([...head, "کنترل", secondaryDesc && secondaryDesc !== "لرن" ? secondaryDesc : primaryDesc, freqSpec?.alternatives[0] ?? rf].filter(Boolean).join(" "), "alternative_wording", "expand", 82);
            }
            if (typeof channels === "number" && !brand) {
                const channelWord = PERSIAN_DIGITS_WORD.get(channels);
                if (channelWord && secondaryDesc && rf) {
                    add([...head, secondaryDesc, channelWord, "کانال", rf].join(" "), "alternative_wording", "expand", 79);
                }
                if (chSpec && secondaryDesc) {
                    add([...head, secondaryDesc, chSpec.display].join(" "), "descriptor", "expand", 77);
                }
            }
            if (hasBt && rf && primaryDesc) {
                add([...head, "بلوتوثی", rf].filter(Boolean).join(" "), "technical", "expand", 81);
            }
            if (colorDesc && rf) {
                add([...head, colorDesc, rf].join(" "), "descriptor", "expand", 85);
            }
            if (brandFa && (rf || primaryDesc)) {
                add([...head, primaryDesc, rf, brandFa].filter(Boolean).join(" "), "brand", "expand", 84);
            }
            if (primaryDesc && rf) {
                add([...head, hasBt ? "بلوتوثی" : undefined, secondaryDesc && secondaryDesc !== primaryDesc ? secondaryDesc : primaryDesc, "فرکانس", rf].filter(Boolean).join(" "), "alternative_wording", "expand", 80);
            }
            if (freqSpec?.alternatives[2] && (secondaryDesc || primaryDesc)) {
                add([...head, secondaryDesc ?? primaryDesc, freqSpec.alternatives[2]].filter(Boolean).join(" "), "alternative_wording", "expand", 78);
            }
            if (freqSpec?.alternatives[0]) {
                add([...head, freqSpec.alternatives[0], brand].filter(Boolean).join(" "), "alternative_wording", "expand", 76);
            }
            if (primaryDesc && typeof buttons === "number") {
                const wordCount = PERSIAN_DIGITS_WORD.get(buttons);
                if (wordCount)
                    add([...head, primaryDesc, wordCount, "دکمه"].join(" "), "alternative_wording", "expand", 74);
            }
            if (hasBt && freqSpec?.alternatives[0]) {
                add(`bluetooth remote ${freqSpec.alternatives[0]}`, "alternative_wording", "expand", 70);
            }
            if (brandFa || brand) {
                add([...head, hasBt ? "بلوتوثی" : undefined, brandFa ?? brand].filter(Boolean).join(" "), "broad_fallback", "expand", 68);
            }
            else if (secondaryDesc) {
                add([...head, secondaryDesc, functionalDescriptors.includes("لرن") ? "لرن" : undefined].filter(Boolean).join(" "), "broad_fallback", "expand", 69);
            }
        }
        else {
            const topSpecs = technicalSpecs.slice(0, 2).map((s) => s.display);
            const altSpecs = technicalSpecs.slice(0, 2).map((s) => s.alternatives[0] ?? s.display);
            if (topSpecs.length) {
                add([...head, ...topSpecs, brand].filter(Boolean).join(" "), "technical", "fast", 92);
                add([...head, ...topSpecs].join(" "), "technical", "fast", 88);
            }
            for (const word of words) {
                add([...head, word, brand].filter(Boolean).join(" "), "descriptor", "fast", 84);
            }
            if (altSpecs.length) {
                add([...head, ...altSpecs, brandFa ?? brand].filter(Boolean).join(" "), "alternative_wording", "expand", 80);
            }
            if (brandFa && (topSpecs.length || words.length)) {
                add([...head, ...topSpecs, brandFa, ...words.slice(0, 1)].filter(Boolean).join(" "), "brand", "expand", 76);
            }
            if (words.length) {
                add([...head, words[0]].join(" "), "broad_fallback", "expand", 70);
            }
            else if (brandFa || brand) {
                add([...head, brandFa ?? brand].filter(Boolean).join(" "), "broad_fallback", "expand", 68);
            }
        }
    }
    else if (technicalSpecs.length || words.length || brandFa) {
        const topSpecs = technicalSpecs.slice(0, 2).map((s) => s.display);
        if (topSpecs.length) {
            add([...head, ...topSpecs, brandFa ?? brand].filter(Boolean).join(" "), "technical", "fast", 86);
            add([...head, ...topSpecs].filter(Boolean).join(" "), "technical", "expand", 80);
        }
        if (brandFa && words.length) {
            add([...head, brandFa, ...words.slice(0, 2)].filter(Boolean).join(" "), "brand", "expand", 75);
        }
    }
    return plan;
}
function buildSearchQueries(productName, sku) {
    const plan = buildSearchQueryPlan(productName, sku);
    const fast = plan.filter((item) => item.phase === "fast");
    const selected = fast.length >= 3 || plan.length <= 6 ? (fast.length ? fast : plan) : plan;
    return selected.slice(0, 6).map(({ query }) => query);
}
function extractVocabularyExpansions(profile, observedTitles, suggestedQueries, alreadyNormalized, limit = 2, descriptorPolicy) {
    const candidates = [];
    const seenBag = new Set([...alreadyNormalized].map(tokenBagKey));
    const seenNorm = new Set(alreadyNormalized);
    const add = (query, strategy, priority) => {
        const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
        const normalized = (0, text_1.normalizeText)(text);
        if (normalized.length < 3 || seenNorm.has(normalized))
            return;
        const bag = tokenBagKey(normalized);
        if (seenBag.has(bag))
            return;
        seenNorm.add(normalized);
        seenBag.add(bag);
        candidates.push({ query: text, strategy, phase: "expand", priority });
    };
    for (const suggestion of suggestedQueries) {
        const parsed = (0, parse_1.parseTitle)(suggestion);
        const sameClass = !profile.productClass || !parsed.head || parsed.head.cls === profile.productClass;
        const sharesTerm = profile.descriptors.some((w) => parsed.tokens.includes(w)) ||
            profile.brands.some((b) => parsed.brands.includes(b)) ||
            Object.entries(profile.parsed.attrs).some(([k, vals]) => parsed.attrs[k]?.some((v) => vals.includes(v)));
        if (sameClass && sharesTerm) {
            add(suggestion, "vocabulary_expansion", 78);
        }
    }
    const head = profile.headTokens;
    const freq = profile.parsed.attrs.frequency?.[0];
    const rf = typeof freq === "number" ? formatFrequency(freq).short : undefined;
    const hasBt = profile.parsed.attrs.bluetooth?.includes("yes");
    const targetDescWords = new Set(profile.parsed.descriptorWords ?? profile.descriptors);
    const targetColors = (profile.parsed.descriptorWords ?? [])
        .filter((w) => (0, descriptors_1.classifyDescriptorToken)(w, profile.productClass, descriptorPolicy).group === "color");
    // استخراج واژگان بازار از عنوان‌های فروشندگان و کارت‌های هم‌تراز (با شمارش فراوانی برای رتبه‌بندی بازدهی کشف)
    const termCounts = new Map();
    for (const title of observedTitles) {
        const parsed = (0, parse_1.parseTitle)(title);
        if (profile.productClass && parsed.head && parsed.head.cls !== profile.productClass)
            continue;
        if (parsed.counterfeit || parsed.used || parsed.defective || parsed.pack)
            continue;
        // اگر مشخصات فنی اصلی متضاد است (مثلاً فرکانس دیگر)، واژگان آن عنوان را برای گسترش جست‌وجو نگیر
        const hasAttrConflict = Object.entries(profile.parsed.attrs).some(([k, vals]) => vals.length > 0 && parsed.attrs[k]?.length && !parsed.attrs[k].some((v) => vals.includes(v)));
        if (hasAttrConflict)
            continue;
        if (parsed.designStyle && head.length) {
            add([...head, parsed.designStyle, rf, profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 77);
        }
        if (profile.productClass === "acc:remote" && parsed.tokens.includes("لرن") && parsed.tokens.includes("کد") && head.length) {
            const sideDesc = profile.descriptors.find((d) => d !== "لرن");
            add([...head, sideDesc, "کد لرن", rf, profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 76);
        }
        if (profile.productClass === "acc:remote" && parsed.attrs.bluetooth?.includes("yes") && !hasBt && head.length) {
            const sideDesc = profile.descriptors.find((d) => d !== "لرن") ?? profile.descriptors[0];
            add([...head, sideDesc, "بلوتوثی", rf].filter(Boolean).join(" "), "vocabulary_expansion", 74);
        }
        const freqSpec = profile.technicalSpecs.find((s) => s.key === "frequency");
        if (freqSpec?.alternatives[0] && parsed.tokens.some((t) => t.endsWith("mhz") || t.endsWith("khz")) && head.length) {
            add([...head, profile.descriptors[0], freqSpec.alternatives[0], profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 75);
        }
        for (const w of parsed.descriptorWords ?? parsed.words) {
            if (targetDescWords.has(w))
                continue;
            const cls = (0, descriptors_1.classifyDescriptorToken)(w, profile.productClass, descriptorPolicy);
            if (["cosmetic_style", "material", "shape", "color", "marketing", "unknown"].includes(cls.group)) {
                const prev = termCounts.get(w);
                termCounts.set(w, { group: cls.group, count: (prev?.count ?? 0) + 1 });
            }
        }
    }
    if (head.length && (rf || hasBt || targetColors.length)) {
        const rankedTerms = [...termCounts.entries()].sort((a, b) => {
            const weight = (g) => (g === "cosmetic_style" || g === "material" || g === "shape" ? 2 : 1);
            return b[1].count * weight(b[1].group) - a[1].count * weight(a[1].group);
        });
        for (const [term, info] of rankedTerms.slice(0, 6)) {
            const prio = 80 + Math.min(8, info.count * 2);
            add([...head, hasBt ? "بلوتوثی" : undefined, term, rf, profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", prio);
            if (targetColors[0] && info.group === "shape") {
                add([...head, hasBt ? "بلوتوثی" : undefined, term, targetColors[0]].filter(Boolean).join(" "), "vocabulary_expansion", prio - 1);
            }
        }
    }
    const chosen = candidates.sort((a, b) => b.priority - a.priority).slice(0, limit);
    for (const item of chosen)
        alreadyNormalized.add((0, text_1.normalizeText)(item.query));
    return chosen;
}
