'use strict'
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const toFaDigits = (s) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)])
const NUM_WORDS_FA = { 1: 'یک', 2: 'دو', 3: 'سه', 4: 'چهار', 5: 'پنج', 6: 'شش', 7: 'هفت', 8: 'هشت', 9: 'نه', 10: 'ده', 12: 'دوازده', 16: 'شانزده', 24: 'بیست و چهار', 32: 'سی و دو' }
module.exports = { toFaDigits, NUM_WORDS_FA, FA_DIGITS }
