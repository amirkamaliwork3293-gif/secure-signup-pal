/**
 * انتخاب نسخهٔ ابری وقتی کاتالوگ محلی خراب شده (فحاشی / نام‌های چینی).
 * اجرا: node --experimental-strip-types scripts/test-catalog-integrity.mjs
 */
import assert from "node:assert/strict";
import {
  catalogLooksVandalized,
  preferCloudValue,
  textLooksVandalized,
} from "../src/lib/catalog-integrity.ts";

const persianProducts = [
  { id: "1", name: "شیر پرچرب کاله" },
  { id: "2", name: "گلس سامسونگ" },
  { id: "3", name: "روغن مایع لادن" },
];

const chineseGarbage = [
  { id: "1", name: "你妈的混蛋" },
  { id: "2", name: "去死吧" },
  { id: "3", name: "垃圾软件" },
  { id: "4", name: "滚蛋" },
  { id: "5", name: "白痴" },
];

const insultProducts = [
  { id: "1", name: "کامیکس جنده" },
  { id: "2", name: "شیر پرچرب" },
];

const insultInvoices = [
  {
    id: "inv-1",
    items: [{ name: "نان" }],
    notes: "کسکش",
    customer: { firstName: "علی", lastName: "رضایی" },
  },
];

const cleanInvoices = [
  {
    id: "inv-1",
    items: [{ name: "نان سنگک" }],
    notes: "تحویل فردا",
    customer: { firstName: "علی", lastName: "رضایی" },
  },
];

assert.equal(textLooksVandalized("شیر پرچرب کاله"), false);
assert.equal(textLooksVandalized("گلس آیفون ۱۳"), false);
assert.equal(textLooksVandalized("你妈的混蛋"), true);
assert.equal(textLooksVandalized("کامیکس جنده"), true);

assert.equal(catalogLooksVandalized(persianProducts, "products"), false);
assert.equal(catalogLooksVandalized(chineseGarbage, "products"), true);
assert.equal(catalogLooksVandalized(insultProducts, "products"), true);
assert.equal(catalogLooksVandalized(insultInvoices, "invoices"), true);
assert.equal(catalogLooksVandalized(cleanInvoices, "invoices"), false);

// سناریوی مهران بهوندی: ابر سالم، گوشی خراب → ابر برنده
assert.equal(preferCloudValue(chineseGarbage, persianProducts, "products"), true);
assert.equal(preferCloudValue(insultProducts, persianProducts, "products"), true);
assert.equal(preferCloudValue(insultInvoices, cleanInvoices, "invoices"), true);

// ابر خراب، گوشی سالم → گوشی بماند تا ذخیره شود
assert.equal(preferCloudValue(persianProducts, chineseGarbage, "products"), false);

// ویرایش آفلاین واقعی: یک کالا اضافه شده، هر دو سالم
const localPlusOne = [...persianProducts, { id: "4", name: "ماست سه‌زال" }];
assert.equal(preferCloudValue(localPlusOne, persianProducts, "products"), false);

// بعد از بازیابی ابر: گوشی تقریباً خالی، ابر پر
const manyCloud = Array.from({ length: 40 }, (_, i) => ({
  id: String(i),
  name: `کالای ${i}`,
}));
assert.equal(preferCloudValue([], manyCloud, "products"), true);
assert.equal(preferCloudValue(manyCloud.slice(0, 10), manyCloud, "products"), true);

// حذف معمولی چند کالا نباید ابر را برنده کند
const slightlyFewer = manyCloud.slice(5);
assert.equal(preferCloudValue(slightlyFewer, manyCloud, "products"), false);

// ابر خالی: چیزی برای گرفتن نیست
assert.equal(preferCloudValue(persianProducts, null, "products"), false);

// قیمت فاکتور عوض شده بدون اسم چینی — ابرِ بازیابی‌شده باید برنده شود
const priced = (id, price) => ({
  id,
  items: [{ productId: "p1", name: "نان", price, quantity: 2 }],
  total: price * 2,
});
const originalInvoices = [priced("a", 10000), priced("b", 20000), priced("c", 30000), priced("d", 40000)];
const randomInvoices = [priced("a", 17), priced("b", 9182), priced("c", 4), priced("d", 555)];
assert.equal(preferCloudValue(randomInvoices, originalInvoices, "invoices"), true);
assert.equal(preferCloudValue(originalInvoices, originalInvoices, "invoices"), false);
// یک فاکتور ویرایش‌شده توسط خود کاربر نباید کل تاریخچه را از ابر بگیرد
const oneEdited = [priced("a", 12000), priced("b", 20000), priced("c", 30000), priced("d", 40000)];
assert.equal(preferCloudValue(oneEdited, originalInvoices, "invoices"), false);

console.log("✓ catalog-integrity: همه‌ی بررسی‌ها موفق");
