import { brandDisplayAliases, isAccessoryClass } from "@/lib/pricing/match/lexicon";
import { isAliasPrefix, parseTitle, type AttrValue, type ParsedCode, type ParsedTitle } from "@/lib/pricing/match/parse";
import { normalizeText, NUMBER_WORDS } from "@/lib/pricing/match/text";

export type QueryStrategy =
  | "exact"
  | "model_code"
  | "technical"
  | "brand"
  | "descriptor"
  | "alternative_wording"
  | "broad_fallback"
  | "vocabulary_expansion";

export interface PlannedSearchQuery {
  query: string;
  strategy: QueryStrategy;
  phase: "fast" | "expand";
  priority: number;
}

export interface TargetTechnicalSpec {
  key: string;
  canonical: string;
  display: string;
  alternatives: string[];
}

export interface TargetSearchProfile {
  productName: string;
  coreName: string;
  sku?: string | null;
  parsed: ParsedTitle;
  productClass: string | null;
  headTokens: string[];
  brands: string[];
  brandAliases: { fa?: string; en?: string };
  modelCodes: string[];
  strippedModelCodes: string[];
  hardConstraints: string[];
  strongEvidence: string[];
  descriptors: string[];
  packageUnits?: number;
  accessoryIndicators: string[];
  technicalSpecs: TargetTechnicalSpec[];
  isCodeless: boolean;
}

const PERSIAN_DIGITS_WORD = new Map<number, string>(
  Object.entries(NUMBER_WORDS).map(([word, num]) => [num, word]),
);

function formatFrequency(hz: number): { short: string; withMhz: string; fa: string } {
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

function buildTechSpecs(parsed: ParsedTitle): TargetTechnicalSpec[] {
  const specs: TargetTechnicalSpec[] = [];
  const attrs = parsed.attrs;
  const pushSpec = (key: string, values: AttrValue[] | undefined, formatter: (v: AttrValue) => { display: string; alternatives?: string[] } | null) => {
    if (!values?.length) return;
    for (const value of values) {
      const formatted = formatter(value);
      if (!formatted) continue;
      specs.push({
        key,
        canonical: `${key}:${value}`,
        display: formatted.display,
        alternatives: formatted.alternatives ?? [],
      });
    }
  };

  pushSpec("frequency", attrs.frequency, (v) => {
    if (typeof v !== "number") return null;
    const f = formatFrequency(v);
    return { display: f.short, alternatives: [f.withMhz, `فرکانس ${f.short}`, f.fa] };
  });
  pushSpec("buttons", attrs.buttons, (v) => {
    if (typeof v !== "number") return null;
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
    if (typeof v !== "number") return null;
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
    if (typeof v !== "number") return null;
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

function stripLeadingBrandPrefix(code: ParsedCode): string | null {
  if (code.segs.length < 2 || !isAliasPrefix(code.segs[0])) return null;
  const tail = code.segs.slice(1).join("-");
  return tail.replace(/[^a-z0-9]/gi, "").length >= 5 ? tail : null;
}

export function decomposeTargetProduct(productName: string, sku?: string | null): TargetSearchProfile {
  const parsed = parseTitle(productName, { sku });
  const coreName = productName
    .replace(/\s*[([]\s*(?:مناسب|مخصوص|ویژه|جهت|برای|compatible|for)\s[^)\]]*[)\]]/gi, " ")
    .split(/\s+(?:مناسب\s+برای|مخصوص|ویژهٔ?|جهت|compatible\s+with)\s+/i)[0]
    .trim() || productName;
  const identity = parseTitle(coreName, { sku });
  const activeParsed = identity.head || identity.codes.length ? identity : parsed;
  const headTokens = activeParsed.head ? activeParsed.tokens.slice(activeParsed.head.at, activeParsed.head.at + activeParsed.head.len) : [];
  const primaryCodes = parsed.codes.filter((item) => !item.inCompat);
  const wordParts = productName.split(/[\s،,;()[\]]+/);
  const modelCodes = primaryCodes.map((code) =>
    wordParts.find((word) => normalizeText(word).replace(/[^0-9a-z]/g, "").toUpperCase() === code.canon) ?? code.raw,
  );
  const strippedModelCodes = [...new Set(primaryCodes.map(stripLeadingBrandPrefix).filter((x): x is string => Boolean(x)))];
  const brands = [...new Set([...parsed.brands, ...primaryCodes.map((c) => c.brandHint).filter((b): b is string => Boolean(b))])];
  const primaryBrand = brands[0];
  const brandAliases = primaryBrand ? brandDisplayAliases(primaryBrand) : {};
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
  const accessoryIndicators = parsed.hits.filter((h) => isAccessoryClass(h.cls)).map((h) => h.cls);
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

function tokenBagKey(normalized: string): string {
  return normalized.split(" ").filter(Boolean).sort().join(" ");
}

export function buildSearchQueryPlan(productName: string, sku?: string | null): PlannedSearchQuery[] {
  const profile = decomposeTargetProduct(productName, sku);
  const plan: PlannedSearchQuery[] = [];
  const seenExact = new Set<string>();
  const seenBag = new Set<string>();

  const add = (query: string, strategy: QueryStrategy, phase: "fast" | "expand", priority: number, allowReordered = false) => {
    const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
    const normalized = normalizeText(text);
    if (normalized.length < 3 || seenExact.has(normalized)) return;
    const bag = tokenBagKey(normalized);
    if (!allowReordered && seenBag.has(bag)) return;
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

  const rawCodeFromTitle = parseTitle(coreName).codes.some((item) => !item.inCompat && item.canon.length >= 5);
  if (rawCode) {
    const original = productName.split(/[\s،,;()[\]]+/)
      .find((word) => normalizeText(word).replace(/[^0-9a-z]/g, "").toUpperCase() === rawCode.canon) ?? rawCode.raw;
    add(original, "model_code", "fast", 95);
    if (brand && !original.toLowerCase().startsWith(brand)) {
      add(`${brand} ${original}`, "brand", "fast", 90);
    }
    const stripped = stripLeadingBrandPrefix(rawCode);
    if (stripped) {
      add(brandFa ? `${brandFa} ${stripped}` : brand ? `${brand} ${stripped}` : stripped, "model_code", "expand", 84);
      add(stripped, "model_code", "expand", 80);
    }
    if (brandFa) add(`${brandFa} ${original}`, "alternative_wording", "expand", 78);
    if (headTokens.length) add([...headTokens, brandFa ?? brandEn, original].filter(Boolean).join(" "), "alternative_wording", "expand", 75);
    if (rawCodeFromTitle) return plan;
  }

  if (parsed.family === "remotag" && (!parsed.head || parsed.head.cls === "access_control")) {
    const brandLabel = brand === "beta" ? "بتا" : brandFa ?? brand ?? "";
    add(`ریموتگ ${brandLabel}`, "brand", "fast", 92);
    add(`اکسس کنترل ریموتگ ${brandLabel}`, "descriptor", "fast", 88);
    const intercom = profile.parsed === parsed
      ? parsed.tokens.includes("ایفون")
      : parseTitle(productName, { sku }).tokens.includes("ایفون");
    add(`برد کنترل دسترسی ریموتگ ${intercom ? "آیفون " : ""}${brandLabel}`, "alternative_wording", "fast", 84);
    if (intercom) add(`ماژول کارتی ریموتی آیفون ${brandLabel}`, "alternative_wording", "fast", 80);
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
      const styleToken = parsed.designStyle ? normalizeText(parsed.designStyle.replace(/^طرح\s+/u, "")) : "";
      const functionalDescriptors = words.filter((w) => w !== styleToken);
      const primaryDesc = functionalDescriptors[0] ?? words[0];
      const secondaryDesc = functionalDescriptors[1];
      const pairedDesc = functionalDescriptors.slice(0, 2).join(" ");
      const altStyle = parsed.designStyle ?? (primaryDesc ? `طرح ${primaryDesc}` : undefined);

      // Preserve proven fast core remote queries while ensuring strong brandless/wall/channel/learn-code/design/alias coverage.
      add([...head, primaryDesc, rf, brand].filter(Boolean).join(" "), "technical", "fast", 94);
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
      if (rf) add([...head, rf, brand].filter(Boolean).join(" "), "technical", brand ? "fast" : "expand", 89);
      if (primaryDesc && brand) add([...head, primaryDesc, brand].join(" "), "brand", "fast", 86);
      if (pairedDesc && !brand) add([...head, pairedDesc].join(" "), "descriptor", "expand", 84);
      else if (primaryDesc) add([...head, primaryDesc].join(" "), "descriptor", "fast", 82);
      if (primaryDesc && buttons) add([...head, primaryDesc, String(buttons), "دکمه"].join(" "), "descriptor", "fast", 78);

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
        if (wordCount) add([...head, primaryDesc, wordCount, "دکمه"].join(" "), "alternative_wording", "expand", 74);
      }
      if (hasBt && freqSpec?.alternatives[0]) {
        add(`bluetooth remote ${freqSpec.alternatives[0]}`, "alternative_wording", "expand", 70);
      }
      if (brandFa || brand) {
        add([...head, hasBt ? "بلوتوثی" : undefined, brandFa ?? brand].filter(Boolean).join(" "), "broad_fallback", "expand", 68);
      } else if (secondaryDesc) {
        add([...head, secondaryDesc, functionalDescriptors.includes("لرن") ? "لرن" : undefined].filter(Boolean).join(" "), "broad_fallback", "expand", 69);
      }
    } else {
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
      } else if (brandFa || brand) {
        add([...head, brandFa ?? brand].filter(Boolean).join(" "), "broad_fallback", "expand", 68);
      }
    }
  } else if (technicalSpecs.length || words.length || brandFa) {
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

export function buildSearchQueries(productName: string, sku?: string | null): string[] {
  const plan = buildSearchQueryPlan(productName, sku);
  const fast = plan.filter((item) => item.phase === "fast");
  const selected = fast.length >= 3 || plan.length <= 6 ? (fast.length ? fast : plan) : plan;
  return selected.slice(0, 6).map(({ query }) => query);
}

export function extractVocabularyExpansions(
  profile: TargetSearchProfile,
  observedTitles: string[],
  suggestedQueries: string[],
  alreadyNormalized: Set<string>,
  limit = 2,
): PlannedSearchQuery[] {
  const expansions: PlannedSearchQuery[] = [];
  const seenBag = new Set([...alreadyNormalized].map(tokenBagKey));
  const add = (query: string, strategy: QueryStrategy, priority: number) => {
    if (expansions.length >= limit) return;
    const text = query.replace(/[\u200c\u200d\s]+/g, " ").trim().slice(0, 180);
    const normalized = normalizeText(text);
    if (normalized.length < 3 || alreadyNormalized.has(normalized)) return;
    const bag = tokenBagKey(normalized);
    if (seenBag.has(bag)) return;
    alreadyNormalized.add(normalized);
    seenBag.add(bag);
    expansions.push({ query: text, strategy, phase: "expand", priority });
  };

  for (const suggestion of suggestedQueries) {
    const parsed = parseTitle(suggestion);
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
  for (const title of observedTitles) {
    if (expansions.length >= limit) break;
    const parsed = parseTitle(title);
    if (profile.productClass && parsed.head && parsed.head.cls !== profile.productClass) continue;
    if (parsed.designStyle && head.length) {
      add([...head, parsed.designStyle, rf, profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 76);
    }
    if (profile.productClass === "acc:remote" && parsed.tokens.includes("لرن") && parsed.tokens.includes("کد") && head.length) {
      const sideDesc = profile.descriptors.find((d) => d !== "لرن");
      add([...head, sideDesc, "کد لرن", rf, profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 75);
    }
    if (profile.productClass === "acc:remote" && parsed.attrs.bluetooth?.includes("yes") && !profile.parsed.attrs.bluetooth?.includes("yes") && head.length) {
      const sideDesc = profile.descriptors.find((d) => d !== "لرن") ?? profile.descriptors[0];
      add([...head, sideDesc, "بلوتوثی", rf].filter(Boolean).join(" "), "vocabulary_expansion", 73);
    }
    const freqSpec = profile.technicalSpecs.find((s) => s.key === "frequency");
    if (freqSpec?.alternatives[0] && parsed.tokens.some((t) => t.endsWith("mhz") || t.endsWith("khz")) && head.length) {
      add([...head, profile.descriptors[0], freqSpec.alternatives[0], profile.brands[0]].filter(Boolean).join(" "), "vocabulary_expansion", 74);
    }
  }
  return expansions;
}
