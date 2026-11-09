'use strict'
/**
 * مولد بنچمارک تطابق محصول (سنتتیک، قابل‌تکرار).
 * هر «کیس» = یک محصول فروشگاه (target) + لیست کارت‌های نتیجه‌ی جستجوی ترب (candidates) با برچسب حقیقت.
 * برچسب‌ها: same | diff | ambig (ambig: با اطلاعاتِ نام فروشگاه قابل‌تشخیص نیست ⇒ تصمیم ایده‌آل «ریویو» است).
 */
const { makeRng, hashStr } = require('../lib/rng.cjs')
const T = require('../lib/titles.cjs')
const { CATALOG } = T

const hex6 = (rng) => Array.from({ length: 6 }, () => '0123456789ABCDEF'[rng.int(0, 15)]).join('')

function labelFor(up, other, stated) {
  const attrsSame = T.attrsEqual(up.attrs, other.attrs)
  const brandSame = up.brand === other.brand
  if (!stated.code && attrsSame && other.kind === up.kind && (brandSame || !stated.brand)) {
    return { label: 'ambig', negType: brandSame ? 'sibling_model' : 'different_brand' }
  }
  if (brandSame && attrsSame) return { label: 'diff', negType: 'sibling_model' }
  if (brandSame) return { label: 'diff', negType: 'spec_variant' }
  return { label: 'diff', negType: 'different_brand' }
}

function attrDist(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let d = 0
  for (const k of keys) if (a[k] !== b[k]) d++
  return d
}

function buildCase(up, rng, opts) {
  const shift = opts.shift
  const force = shift
    ? {
        noise: rng.chance(0.6),
        arabicLetters: rng.chance(0.12),
        faDigits: rng.chance(0.4),
        codeForm: rng.pickW([['exact', 52], ['nodash', 14], ['lower', 12], ['noprefix', 22]]),
      }
    : {}
  const tr = T.renderProduct(up, rng, 'store', force)
  const skuMode = rng.pickW([['code', 52], ['internal', 26], ['none', 22]])
  let sku = null
  if (skuMode === 'code' && up.code) sku = up.code
  else if (skuMode === 'internal') sku = rng.chance(0.9) ? 'KY-' + String(rng.int(1, 9999999)).padStart(7, '0') : 'KY-' + hex6(rng)
  const anchor = rng.chance(0.9) ? Math.round((up.price * rng.float(0.8, 1.05)) / 1000) * 1000 : null
  const stated = { ...tr.stated, code: tr.stated.code || Boolean(sku && sku === up.code) }

  const cards = []
  const add = (c) => cards.push(c)
  const trueCardPresent = rng.chance(0.88)
  const tforce = shift ? { noise: rng.chance(0.5), arabicLetters: rng.chance(0.1), codeForm: rng.pickW([['exact', 55], ['nodash', 12], ['lower', 10], ['noprefix', 23]]) } : {}

  if (trueCardPresent) {
    const r = T.renderProduct(up, rng, 'torob', tforce)
    add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, up.price, 0.965, 1.0), sellerCount: rng.int(3, 45), label: 'same', negType: null, role: 'true' })
    if (rng.chance(0.07)) {
      const r2 = T.renderProduct(up, rng, 'torob', tforce)
      add({ titleFa: r2.titleFa, titleEn: r2.titleEn, priceToman: T.priceJitter(rng, up.price, 1.0, 1.08), sellerCount: rng.int(1, 8), label: 'same', negType: null, role: 'dup' })
    }
  }

  // --- هم‌خانواده‌های واقعی کاتالوگ
  let pool
  if (up.code) pool = CATALOG.filter((c) => c.id !== up.id && c.brand === up.brand && c.kind === up.kind)
  else pool = CATALOG.filter((c) => c.id !== up.id && c.kind === up.kind)
  const key = (c) => (up.code && c.code ? T.editDistance(up.code, c.code) : attrDist(up.attrs, c.attrs))
  const near = pool.sort((a, b) => key(a) - key(b)).slice(0, 7)
  const nNear = Math.min(near.length, rng.int(2, 5))
  for (const s of rng.sample(near, nNear)) {
    const r = T.renderProduct(s, rng, 'torob', tforce)
    const lb = labelFor(up, s, stated)
    add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, s.price, 0.965, 1.0), sellerCount: rng.int(2, 40), ...lb, role: 'near' })
  }

  // --- هم‌خانواده‌های ساختگی (جهش کد)
  if (up.code) {
    const nMut = rng.int(1, 3)
    for (let i = 0; i < nMut; i++) {
      const m = T.mutateCode(up.code, rng)
      if (m.code === up.code) continue
      const clone = { ...up, id: up.id + '~m' + i, code: m.code, price: Math.round(up.price * rng.float(0.8, 1.35)) }
      const r = T.renderProduct(clone, rng, 'torob', { ...tforce, includeCode: true })
      let lb = { label: 'diff', negType: 'sibling_model' }
      if (m.ambiguous || (!stated.code && m.how !== 'digit')) lb = { label: 'ambig', negType: 'sibling_model' }
      add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, clone.price, 0.97, 1.0), sellerCount: rng.int(1, 25), ...lb, role: 'mut:' + m.how })
    }
  }

  // --- لوازم جانبی
  for (let i = 0, n = rng.int(2, 4); i < n; i++) {
    const a = T.accessoryCard(up, rng)
    add({ titleFa: a.titleFa, titleEn: null, priceToman: a.price, sellerCount: rng.int(1, 20), label: 'diff', negType: 'accessory', available: true, role: 'acc' })
  }
  // --- پک/کیت
  for (let i = 0, n = rng.int(1, 2); i < n; i++) {
    const k = T.packCard(up, rng)
    add({ titleFa: k.titleFa, titleEn: null, priceToman: k.price, sellerCount: rng.int(1, 10), label: 'diff', negType: 'bundle_pack', role: 'pack' })
  }
  // --- استوک
  if (rng.chance(0.4)) {
    const u = T.usedCard(up, rng)
    add({ titleFa: u.titleFa, titleEn: null, priceToman: u.price, sellerCount: rng.int(1, 6), label: 'diff', negType: 'used_refurb', role: 'used' })
  }
  // --- برند دیگر با همان مشخصات
  const others = CATALOG.filter((c) => c.brand !== up.brand && c.fam === up.fam)
  const sameSpecOthers = others.filter((c) => c.kind === up.kind).sort((a, b) => attrDist(up.attrs, a.attrs) - attrDist(up.attrs, b.attrs))
  for (const o of sameSpecOthers.slice(0, rng.int(1, 2))) {
    const r = T.renderProduct(o, rng, 'torob', tforce)
    const lb = labelFor(up, o, stated)
    add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, o.price, 0.97, 1.0), sellerCount: rng.int(2, 40), ...lb, role: 'brand' })
  }
  // --- هم‌خانواده‌ی دیگر (بین‌دسته‌ای)
  const cross = CATALOG.filter((c) => c.fam !== up.fam && (c.brand === up.brand || rng.chance(0.15)))
  for (const o of rng.sample(cross, Math.min(cross.length, rng.int(1, 2)))) {
    const r = T.renderProduct(o, rng, 'torob', tforce)
    add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, o.price, 0.97, 1.0), sellerCount: rng.int(1, 40), label: 'diff', negType: 'cross_category', role: 'cross' })
  }
  // --- نامرتبط
  const unrel = CATALOG.filter((c) => c.fam !== up.fam && c.brand !== up.brand)
  for (const o of rng.sample(unrel, Math.min(unrel.length, rng.int(1, 2)))) {
    const r = T.renderProduct(o, rng, 'torob', tforce)
    add({ titleFa: r.titleFa, titleEn: r.titleEn, priceToman: T.priceJitter(rng, o.price, 0.97, 1.0), sellerCount: rng.int(1, 40), label: 'diff', negType: 'unrelated', role: 'unrel' })
  }

  // --- برش به ۲۴ (حداکثر خروجی جستجو) با حفظ کارت درست
  let list = rng.shuffle(cards)
  if (list.length > 24) {
    const mustKeep = list.filter((c) => c.role === 'true')
    const rest = list.filter((c) => c.role !== 'true')
    list = rng.shuffle([...mustKeep, ...rest.slice(0, 24 - mustKeep.length)])
  }
  const candidates = list.map((c, i) => ({
    prk: `c${i}`,
    titleFa: c.titleFa,
    titleEn: c.titleEn || null,
    priceToman: c.priceToman,
    sellerCount: c.sellerCount,
    available: c.available !== false,
    label: c.label,
    negType: c.negType,
    role: c.role,
  }))
  const hasSame = candidates.some((c) => c.label === 'same')
  const hasAmbig = candidates.some((c) => c.label === 'ambig')
  let expected
  if (hasAmbig) expected = 'review'
  else if (hasSame) expected = 'approve'
  else expected = 'reject'
  return {
    upId: up.id,
    family: up.fam,
    kind: up.kind,
    coded: Boolean(up.code),
    statedCode: stated.code,
    target: { productName: tr.titleFa, sku, anchorPriceToman: anchor, category: null },
    candidates,
    expected,
  }
}

/** split بر اساس هش شناسه‌ی محصول: ۶۰٪ dev ، ۴۰٪ test (با «شیفت سبک» برای test). */
function splitOf(upId) {
  return hashStr(upId) % 5 < 3 ? 'dev' : 'test'
}

function generateCorpus({ seed = 20261022, perProduct = 12 } = {}) {
  const cases = []
  let n = 0
  for (const up of CATALOG) {
    const split = splitOf(up.id)
    for (let k = 0; k < perProduct; k++) {
      const rng = makeRng(hashStr(`${seed}:${up.id}:${k}`))
      const c = buildCase(up, rng, { shift: split === 'test' })
      cases.push({ id: `S-${String(++n).padStart(4, '0')}`, split, ...c })
    }
  }
  return cases
}

module.exports = { generateCorpus, splitOf }

if (require.main === module) {
  const fs = require('fs')
  const path = require('path')
  const corpus = generateCorpus()
  fs.writeFileSync(path.join(__dirname, 'corpus.json'), JSON.stringify(corpus))
  const by = {}
  for (const c of corpus) by[`${c.split}/${c.expected}`] = (by[`${c.split}/${c.expected}`] || 0) + 1
  console.log('cases', corpus.length, by)
  console.log('avg candidates', (corpus.reduce((s, c) => s + c.candidates.length, 0) / corpus.length).toFixed(1))
  for (const c of corpus.slice(0, 3)) {
    console.log('\nTARGET:', c.target.productName, '| sku', c.target.sku, '| anchor', c.target.anchorPriceToman, '| expected', c.expected, '| statedCode', c.statedCode)
    for (const x of c.candidates.slice(0, 8)) console.log(`  [${x.label}/${x.negType || '-'}] ${x.titleFa} | ${x.priceToman}`)
  }
}
