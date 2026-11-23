/**
 * استخراج قیمت/اعمال‌خودکار یک محصول فروشگاه برای ایمپورتر (۴.۲.۱).
 *
 * محصول متغیر (productType: "variable") قیمت واقعی را در variants دارد و `Product.price` برایش الزامی نیست؛ قبلاً ایمپورتر
 * `price` سطح محصول (=۰) را می‌خواند و `auto_apply` را (با costPrice>0) روشن می‌گذاشت، در حالی که pricing-sync فروشگاه
 * فقط `price` سطح محصول را می‌نویسد و قیمت مشتری/فید ترب از «تنوع کانونیکال» (ارزان‌ترین تنوع موجود) می‌آید.
 * اینجا: قیمت پایهٔ محصول متغیر = قیمت ارزان‌ترین تنوع موجود (مثل getCanonicalVariant فروشگاه) برای رصد و `autoApply=false`.
 */
"use strict";

function deriveImportPrice(p) {
  const costPrice = Math.max(0, Math.round(Number(p && p.costPrice) || 0));
  const discount = Math.max(0, Number(p && p.discount) || 0);
  const isVariable = !!p && p.productType === "variable";

  let basePrice;
  if (isVariable) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const priced = variants
      .map((v) => ({ price: Math.round(Number(v && v.price) || 0), stock: Number(v && v.stock) || 0 }))
      .filter((v) => v.price > 0);
    const available = priced.filter((v) => v.stock > 0);
    const pool = available.length ? available : priced;
    basePrice = pool.length ? Math.min(...pool.map((v) => v.price)) : 0;
  } else {
    basePrice = Math.max(0, Math.round(Number(p && p.price) || 0));
  }
  const finalPrice = discount > 0 ? Math.round(basePrice * (1 - discount / 100)) : basePrice;
  // محصول بدون قیمت خرید یا متغیر: هرگز خودکار اعمال نمی‌شود (فقط رصد/پیشنهاد)
  const autoApply = costPrice > 0 && !isVariable;
  return { costPrice, basePrice, finalPrice, discount, autoApply, isVariable };
}

module.exports = { deriveImportPrice };
