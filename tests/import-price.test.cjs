// ۴.۲.۱ — ایمپورتر: قیمت پایهٔ محصول متغیر از تنوع کانونیکال می‌آید و auto_apply برایشان خاموش است
const assert = require('node:assert/strict')
const test = require('node:test')
const { deriveImportPrice } = require('../scripts/lib/import-price.cjs')

test('I1. محصول ساده: قیمت/تخفیف/autoApply مثل قبل', () => {
  const r = deriveImportPrice({ productType: 'simple', price: 2600000, discount: 10, costPrice: 2300000 })
  assert.deepEqual(r, { costPrice: 2300000, basePrice: 2600000, finalPrice: 2340000, discount: 10, autoApply: true, isVariable: false })
})

test('I2. بدون قیمت خرید ⇒ autoApply=false', () => {
  assert.equal(deriveImportPrice({ price: 100, costPrice: 0 }).autoApply, false)
  assert.equal(deriveImportPrice({ price: 100 }).autoApply, false)
})

test('I3. محصول متغیر: قیمت پایه = ارزان‌ترین تنوعِ موجود (stock>0) و autoApply=false حتی با قیمت خرید', () => {
  const r = deriveImportPrice({
    productType: 'variable', costPrice: 2000000, discount: 0, // price سطح محصول در مدل برای متغیر الزامی نیست
    variants: [
      { price: 2800000, stock: 4 },
      { price: 2500000, stock: 0 }, // ارزان‌تر ولی ناموجود
      { price: 3100000, stock: 9 },
    ],
  })
  assert.equal(r.isVariable, true)
  assert.equal(r.basePrice, 2800000)
  assert.equal(r.finalPrice, 2800000)
  assert.equal(r.autoApply, false)
})

test('I4. محصول متغیر با همهٔ تنوع‌های ناموجود: ارزان‌ترین قیمت کل؛ بدون تنوع: ۰', () => {
  assert.equal(deriveImportPrice({ productType: 'variable', variants: [{ price: 5, stock: 0 }, { price: 3, stock: 0 }] }).basePrice, 3)
  assert.equal(deriveImportPrice({ productType: 'variable', variants: [] }).basePrice, 0)
  assert.equal(deriveImportPrice({ productType: 'variable' }).basePrice, 0)
})
