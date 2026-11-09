'use strict'
/**
 * رندر عنوان محصول به «سبک فروشگاه» یا «سبک ترب» + سازنده‌ی نمونه‌های منفی (لوازم جانبی، پک، استوک، ...).
 * همه‌ی تصادف‌ها از rng ورودی می‌آید تا بنچمارک کاملاً قابل‌تکرار باشد.
 */
const { BRANDS, KINDS, CATALOG } = require('./catalog.cjs')
const { toFaDigits, NUM_WORDS_FA } = require('./fa.cjs')

const ZWNJ = '‌'

function brandStr(brand, form, rng) {
  const b = BRANDS[brand]
  if (!b || brand === 'generic' || form === 'none') return ''
  if (form === 'fa') return rng.pick(b.fa)
  if (form === 'en') return rng.pick(b.en)
  return `${rng.pick(b.fa)} ${rng.pick(b.en)}`
}

function codeStr(p, form) {
  if (!p.code) return ''
  let c = p.code
  const b = BRANDS[p.brand]
  if (form === 'noprefix' && b && b.prefixes && b.prefixes.length) {
    for (const pre of b.prefixes) {
      if (c.startsWith(pre)) {
        c = c.slice(pre.length)
        break
      }
    }
  } else if (form === 'nodash') c = c.replace(/-/g, '')
  else if (form === 'lower') c = c.toLowerCase()
  return c
}

function randomStyle(rng, side, p) {
  const torob = side === 'torob'
  return {
    side,
    brandForm: rng.pickW(
      torob
        ? [['fa', 55], ['en', 25], ['both', 10], ['none', 10]]
        : [['fa', 48], ['en', 24], ['both', 8], ['none', 20]],
    ),
    includeCode: Boolean(p.code) && (torob ? true : rng.chance(0.8)),
    codeForm: rng.pickW([['exact', 74], ['nodash', 6], ['lower', 6], ['noprefix', 14]]),
    modelWord: rng.pickW([['مدل', torob ? 62 : 38], ['', torob ? 24 : 40], ['کد', 6], ['کد مدل', 8]]),
    order: rng.pickW([['std', 58], ['brandFirst', 14], ['codeFirst', torob ? 4 : 11], ['codeLast', 17]]),
    faDigits: rng.chance(torob ? 0.1 : 0.28),
    arabicLetters: rng.chance(0.04),
    spaceCctv: rng.chance(0.15),
    noise: rng.chance(torob ? 0.28 : 0.38),
    lensText: rng.chance(0.22),
    typeIdx: -1,
  }
}

function numStr(n, st, rng, allowWord = true) {
  if (allowWord && NUM_WORDS_FA[n] && rng.chance(0.06)) return NUM_WORDS_FA[n]
  return st.faDigits ? toFaDigits(String(n)) : String(n)
}

function specTokens(p, rng, st) {
  const a = p.attrs
  const out = []
  const N = (n, w = true) => numStr(n, st, rng, w)
  if (a.mp)
    out.push(
      rng.pickW([
        [`${N(a.mp, false)}MP`, 22], [`${N(a.mp)} مگاپیکسل`, 36], [`${N(a.mp)} مگاپیکسلی`, 12],
        [`${N(a.mp, false)}مگاپیکسل`, 5], [`رزولوشن ${N(a.mp)} مگاپیکسل`, 10], [`${N(a.mp, false)} MP`, 10], [`${N(a.mp, false)} مگ`, 5],
      ]),
    )
  if (a.ch)
    out.push(
      rng.pickW([
        [`${N(a.ch)} کانال`, 50], [`${N(a.ch, false)}CH`, 20], [`${N(a.ch, false)} Channel`, 8],
        [`${N(a.ch)} کانالی`, 12], [`${N(a.ch, false)} کانال`, 10],
      ]),
    )
  if (a.tb)
    out.push(
      rng.pickW([
        [`${N(a.tb, false)} ترابایت`, 40], [`${N(a.tb, false)}TB`, 25], [`${N(a.tb, false)} TB`, 8],
        [`ظرفیت ${N(a.tb, false)} ترابایت`, 17], [`${N(a.tb, false)} ترابایتی`, 10],
      ]),
    )
  if (a.gb)
    out.push(
      rng.pickW([
        [`${N(a.gb, false)} گیگابایت`, 40], [`${N(a.gb, false)}GB`, 28], [`${N(a.gb, false)} GB`, 8],
        [`ظرفیت ${N(a.gb, false)} گیگابایت`, 14], [`${N(a.gb, false)} گیگ`, 10],
      ]),
    )
  if (a.ports)
    out.push(
      rng.pickW([
        [`${N(a.ports)} پورت`, 50], [`${N(a.ports)} پورتی`, 16], [`${N(a.ports, false)} Port`, 14],
        [`${N(a.ports, false)}-Port`, 6], [`${N(a.ports, false)} port`, 14],
      ]),
    )
  if (a.speed === 'gigabit') out.push(rng.pick(['گیگابیت', 'Gigabit', '10/100/1000', 'گیگابیتی']))
  if (a.speed === '100') out.push(rng.pick(['10/100', 'فست اترنت', '100 مگابیت']))
  if (a.poe) out.push(rng.pick(['PoE', 'POE', 'پی او ای']))
  if (a.volt && a.amp)
    out.push(
      rng.pickW([
        [`${N(a.volt, false)} ولت ${N(a.amp, false)} آمپر`, 52], [`${N(a.volt, false)}V ${N(a.amp, false)}A`, 24],
        [`${N(a.volt, false)}V/${N(a.amp, false)}A`, 10], [`${N(a.volt, false)} ولت ${N(a.amp, false)}A`, 14],
      ]),
    )
  if (a.cat) out.push(rng.pick([`Cat${a.cat}`, `CAT${a.cat}`, `Cat ${a.cat}`, `کت ${st.faDigits ? toFaDigits(String(a.cat)) : a.cat}`]))
  if (a.ctype) out.push(a.ctype)
  if (a.core) out.push(a.core)
  if (a.len)
    out.push(
      rng.pickW([
        [`${N(a.len, false)} متری`, 50], [`${N(a.len, false)} متر`, 30], [`${N(a.len, false)}m`, 10], [`طول ${N(a.len, false)} متر`, 10],
      ]),
    )
  return out
}

const NOISE_TOROB = ['اورجینال', 'اصلی', 'جدید', 'گارانتی اصالت و سلامت فیزیکی', 'اکبند', 'نسخه جدید']
const NOISE_STORE = ['اصلی', 'گارانتی ۱۸ ماهه', 'ارسال فوری', 'اورجینال', 'با ضمانت', 'ضمانت اصالت']

function postProcess(title, rng, st) {
  let t = title.replace(/\s+/g, ' ').trim()
  if (st.spaceCctv) t = t.replace(/مداربسته/g, 'مدار بسته')
  if (rng.chance(0.4)) t = t.replace(new RegExp(ZWNJ, 'g'), ' ')
  if (st.arabicLetters) t = t.replace(/ی/g, 'ي').replace(/ک/g, 'ك')
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * رندر یک محصول. خروجی شامل عنوان و «آنچه عنوان بیان کرده» (stated) برای تعیین ابهام است.
 */
function renderProduct(p, rng, side, force = {}) {
  const st = Object.assign(randomStyle(rng, side, p), force)
  const kind = KINDS[p.kind]
  let typePhrase = rng.pick(kind.fa)
  // عبارت نوعِ کابل نباید با ویژگی تعارض/تکرار داشته باشد («کابل شبکه کت ۶» برای محصول Cat5 ، «RG59» تکراری)
  if (p.attrs && p.attrs.cat) typePhrase = typePhrase.replace(/\s*(?:Cat6|کت ۶)\s*$/i, '').trim() || 'کابل شبکه'
  if (p.attrs && p.attrs.core) typePhrase = typePhrase.replace(/\s*RG59\s*$/i, '').trim() || 'کابل کواکسیال'
  const brand = brandStr(p.brand, st.brandForm, rng)
  const specs = specTokens(p, rng, st)
  const stated = { brand: Boolean(brand) && p.brand !== 'generic', code: false, attrs: Object.keys(p.attrs) }
  let code = ''
  if (p.code && st.includeCode) {
    code = codeStr(p, st.codeForm)
    stated.code = true
  }
  const mw = code ? st.modelWord : ''
  let lens = ''
  if (p.fam === 'camera' && st.lensText) lens = rng.pick(['2.8mm', '3.6mm', '4mm', '2.8 میلی متر', 'لنز 2.8'])
  let parts
  if (!p.code) {
    // کالای بدون کد: نوع + برند + مشخصات
    parts = st.order === 'brandFirst' ? [brand, typePhrase, ...specs] : st.order === 'codeLast' ? [typePhrase, ...specs, brand] : [typePhrase, brand, ...specs]
  } else {
    switch (st.order) {
      case 'brandFirst': parts = [brand, typePhrase, mw, code, ...specs, lens]; break
      case 'codeFirst': parts = [code, typePhrase, brand, ...specs, lens]; break
      case 'codeLast': parts = [typePhrase, brand, ...specs, lens, mw, code]; break
      default: parts = [typePhrase, brand, mw, code, ...specs, lens]
    }
  }
  if (st.noise) {
    const nz = rng.pick(side === 'torob' ? NOISE_TOROB : NOISE_STORE)
    if (rng.chance(0.5)) parts.push(nz)
    else parts.unshift(nz === 'اصلی' ? '' : '')
    if (!parts.includes(nz) && rng.chance(0.5)) parts.push(nz)
  }
  const titleFa = postProcess(parts.filter(Boolean).join(' '), rng, st)
  const enBrand = BRANDS[p.brand] && BRANDS[p.brand].en.length ? BRANDS[p.brand].en[0] : ''
  const titleEn = rng.chance(side === 'torob' ? 0.45 : 0)
    ? `${enBrand} ${p.code || ''} ${kind.en}`.replace(/\s+/g, ' ').trim()
    : null
  return { titleFa, titleEn, stated, st }
}

// ------------------------------------------------------------------ منفی‌ها

const ACC_BY_FAM = {
  camera: ['پایه دیواری', 'براکت نصب', 'جعبه تقسیم', 'کاور محافظ', 'کاور ضد آب', 'سایبان', 'هوزینگ', 'پایه سقفی', 'قاب محافظ', 'لنز یدکی', 'پایه ستونی'],
  recorder: ['کیس هارد', 'براکت هارد', 'ریموت کنترل', 'کابل SATA', 'پایه رک', 'قاب محافظ'],
  storage: ['براکت هارد', 'کیس هارد اکسترنال', 'کابل SATA', 'قاب هارد', 'داک هارد'],
  sdcard: ['ریدر کارت حافظه', 'کیس کارت حافظه', 'آداپتور microSD', 'کاور کارت حافظه'],
  network: ['ماژول SFP', 'کابل پچ کورد', 'براکت رک', 'آداپتور برق', 'آنتن تقویتی', 'کاور محافظ'],
  accessory: ['پیچ و رولپلاک', 'کاور محافظ', 'پد لاستیکی'],
  power: ['کابل برق', 'جک DC', 'کاور محافظ', 'فیش'],
  cable: ['فیش', 'کانکتور', 'سوکت', 'کاور محافظ', 'کیف حمل'],
}

function priceJitter(rng, x, lo, hi) {
  return Math.round((x * rng.float(lo, hi)) / 1000) * 1000
}

function accessoryCard(p, rng) {
  const acc = rng.pick(ACC_BY_FAM[p.fam] || ACC_BY_FAM.accessory)
  const kind = KINDS[p.kind]
  const brand = brandStr(p.brand, rng.pick(['fa', 'en', 'fa']), rng)
  const code = p.code ? codeStr(p, rng.pick(['exact', 'exact', 'noprefix'])) : ''
  const typeShort = rng.pick(kind.short)
  const form = rng.int(0, 3)
  let t
  if (!p.code) t = `${acc} ${rng.pick(kind.fa)} ${brand}`.trim()
  else if (form === 0) t = `${acc} مناسب ${typeShort} ${brand} ${code}`
  else if (form === 1) t = `${acc} ${typeShort} ${brand} مدل ${code}`
  else if (form === 2) t = `${acc} ${brand} ${code}`
  else t = `${acc} ${typeShort} ${brand}`
  const specs = rng.chance(0.3) ? specTokens(p, rng, { faDigits: false }) : []
  return { titleFa: postProcess([t, ...specs].join(' '), rng, { spaceCctv: false }), price: priceJitter(rng, p.price, 0.03, 0.22), mentionsCode: Boolean(code) && form !== 3, acc }
}

function packCard(p, rng) {
  const n = rng.pick([2, 3, 4, 4, 8, 10])
  const kind = KINDS[p.kind]
  const brand = brandStr(p.brand, rng.pick(['fa', 'en']), rng)
  const code = p.code ? codeStr(p, 'exact') : ''
  const w = rng.pick(['پک', 'بسته', 'کیت', 'پکیج'])
  const u = rng.pick(['عددی', 'تایی'])
  const variant = rng.int(0, 2)
  let t
  let price
  if (variant === 0) {
    t = `${w} ${n} ${u} ${rng.pick(kind.fa)} ${brand} ${code ? 'مدل ' + code : ''} ${specTokens(p, rng, { faDigits: false }).join(' ')}`
    price = priceJitter(rng, p.price * n, 0.92, 1.0)
  } else if (variant === 1 && p.fam === 'camera') {
    t = `پکیج ${n} دوربین مداربسته ${brand} ${code} به همراه دستگاه ضبط و هارد`
    price = priceJitter(rng, p.price * n + 9000000, 0.95, 1.05)
  } else {
    const m = rng.pick([2, 3, 4])
    t = `${{ 2: 'دو', 3: 'سه', 4: 'چهار' }[m]} عددی ${rng.pick(kind.short)} ${brand} ${code}`
    price = priceJitter(rng, p.price * m, 0.92, 1.0)
  }
  return { titleFa: postProcess(t, rng, { spaceCctv: false }), price, n }
}

function usedCard(p, rng) {
  const kind = KINDS[p.kind]
  const brand = brandStr(p.brand, rng.pick(['fa', 'en']), rng)
  const code = p.code ? codeStr(p, 'exact') : ''
  const u = rng.pick(['استوک', 'کارکرده', 'دست دوم', 'ریفربیش'])
  const t = rng.chance(0.5) ? `${rng.pick(kind.fa)} ${brand} ${code} ${u}` : `${u} ${rng.pick(kind.short)} ${brand} ${code}`
  return { titleFa: postProcess(t, rng, { spaceCctv: false }), price: priceJitter(rng, p.price, 0.4, 0.75) }
}

// ------------------------------------------------------------------ جهش کد مدل (هم‌خانواده‌های ساختگی)

const SUFFIX_POOL = ['F', 'IF', 'IUF', 'U', 'W', 'Z', 'B', 'L', 'A', 'LU', 'D', 'AS']

function mutateCode(code, rng) {
  const segs = code.split('-')
  const how = rng.pickW([['revSuffix', 3], ['addSuffix', 3], ['digit', 3], ['seriesLetter', 2], ['dropSuffix', 1.2]])
  const out = segs.slice()
  const last = out.length - 1
  switch (how) {
    case 'revSuffix': {
      const s = out[last]
      if (/^[A-Z]\d$/.test(s)) {
        const d = Number(s[1])
        out[last] = `${s[0]}${d > 3 ? d - 1 : d + 1}`
      } else if (/^[A-Z]+$/.test(s)) out[last] = rng.pick(SUFFIX_POOL.filter((x) => x !== s))
      else out[last] = s + rng.pick(['1', '2', 'E'])
      return { code: out.join('-'), how, ambiguous: false }
    }
    case 'addSuffix': {
      const add = rng.pick(SUFFIX_POOL)
      return { code: `${code}-${add}`, how, ambiguous: false }
    }
    case 'digit': {
      const idx = out.findIndex((s) => /\d/.test(s))
      if (idx < 0) return mutateCode(code, rng)
      const s = out[idx].split('')
      const dpos = s.map((c, i) => (/\d/.test(c) && i > 0 ? i : -1)).filter((i) => i >= 0)
      if (!dpos.length) return mutateCode(code, rng)
      const i = rng.pick(dpos)
      let nd = Number(s[i])
      nd = (nd + rng.int(1, 3)) % 10
      if (String(nd) === s[i]) nd = (nd + 1) % 10
      s[i] = String(nd)
      out[idx] = s.join('')
      return { code: out.join('-'), how, ambiguous: false }
    }
    case 'seriesLetter': {
      const idx = out.findIndex((s) => /[A-Z]/.test(s) && /\d/.test(s))
      if (idx < 0) return mutateCode(code, rng)
      const s = out[idx].split('')
      const lpos = s.map((c, i) => (/[A-Z]/.test(c) ? i : -1)).filter((i) => i >= 0)
      const i = rng.pick(lpos)
      const alt = 'ABCDEFGHKLMNPRSTUWXZ'.split('').filter((c) => c !== s[i])
      s[i] = rng.pick(alt)
      out[idx] = s.join('')
      return { code: out.join('-'), how, ambiguous: false }
    }
    default: {
      // حذف بخش پایانی فقط وقتی باقیمانده هنوز یک کد معتبر (دارای رقم) است؛ وگرنه عنوان نامعتبر مثل «مدل DGS» تولید می‌شود
      if (out.length < 3 || !/\d/.test(out.slice(0, -1).join(''))) return mutateCode(code, rng)
      out.pop()
      return { code: out.join('-'), how: 'dropSuffix', ambiguous: true }
    }
  }
}

// ------------------------------------------------------------------ شباهت کد (برای انتخاب هم‌خانواده‌های واقعی)

function editDistance(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[m][n]
}

function attrsEqual(a, b) {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k] === b[k])
}

module.exports = {
  renderProduct,
  accessoryCard,
  packCard,
  usedCard,
  mutateCode,
  editDistance,
  attrsEqual,
  priceJitter,
  brandStr,
  codeStr,
  specTokens,
  CATALOG,
  KINDS,
  BRANDS,
}
