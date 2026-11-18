import assert from "node:assert/strict";
import {
  buildReviewRows,
  linkRowToProduct,
  mapScanUnit,
  reviewRowsToPurchaseItems,
  reviewRowsTotal,
  sanitizeScanResult,
  suggestSellPrice,
  toNumber,
  toToman,
} from "./invoice-scan.ts";
import type { Product } from "./store.ts";

const units = [{ name: "عدد" }, { name: "کیلوگرم" }, { name: "گرم" }, { name: "کارتن" }];

const prod = (p: Partial<Product>): Product => ({
  id: p.id ?? "p1",
  name: p.name ?? "کالا",
  price: p.price ?? 0,
  category: p.category ?? "عمومی",
  code: p.code ?? "",
  stock: p.stock ?? 0,
  unit: p.unit,
  buyPrice: p.buyPrice,
});

// ─── اعداد ──────────────────────────────────────────────────────────────────
assert.equal(toNumber("۱۲٬۵۰۰"), 12500);
assert.equal(toNumber("12,500"), 12500);
assert.equal(toNumber("۲٫۵"), 2.5);
assert.equal(toNumber("2/5"), 2.5);
assert.equal(toNumber("۱۲۰,۰۰۰ ریال"), 120000);
assert.equal(toNumber(42), 42);
assert.equal(toNumber(""), undefined);
assert.equal(toNumber("abc"), undefined);
assert.equal(toNumber(Number.NaN), undefined);
assert.equal(toNumber(null), undefined);

// ─── پاک‌سازی خروجی مدل ──────────────────────────────────────────────────────
const raw = sanitizeScanResult({
  currency: "ریال",
  supplierName: "  پخش   البرز ",
  supplierPhone: "۰۹۱۲۱۲۳۴۵۶۷",
  items: [
    {
      name: "شیر کم چرب ۱ لیتری",
      code: "۶۲۶۰۱۰۰",
      quantity: "۱۲",
      unitPrice: "۲۵۰٬۰۰۰",
      lineTotal: "3,000,000",
      confidence: "high",
    },
    { name: "جمع کل", quantity: 1, lineTotal: 3000000 },
    { name: "مالیات بر ارزش افزوده", lineTotal: 300000 },
    { name: "", quantity: 1 },
    { name: "پنیر", quantity: -3, unitPrice: 1e20, confidence: "weird" },
    "garbage",
    null,
  ],
  total: "3,300,000",
});
assert.equal(raw.currency, "rial");
assert.equal(raw.supplierName, "پخش البرز");
assert.equal(raw.supplierPhone, "09121234567");
assert.equal(raw.items.length, 2, "summary/empty/garbage rows are dropped");
assert.equal(raw.items[0].code, "6260100");
assert.equal(raw.items[0].quantity, 12);
assert.equal(raw.items[0].unitPrice, 250000);
assert.equal(raw.items[0].lineTotal, 3000000);
assert.equal(raw.items[1].quantity, undefined, "negative qty rejected");
assert.equal(raw.items[1].unitPrice, undefined, "absurd price rejected");
assert.equal(raw.items[1].confidence, "medium");
assert.equal(raw.total, 3300000);

// ورودی نامعتبر هرگز خطا نمی‌دهد
assert.deepEqual(sanitizeScanResult(null).items, []);
assert.deepEqual(sanitizeScanResult("x").items, []);
assert.equal(sanitizeScanResult({ items: "no" }).currency, "unknown");
// کالایی که اسمش با «جمع» شروع می‌شود ولی ردیف جمع نیست، حذف نمی‌شود
assert.equal(sanitizeScanResult({ items: [{ name: "جمعه بازار" }] }).items.length, 1);

// ─── واحد و پول ─────────────────────────────────────────────────────────────
assert.equal(mapScanUnit("کیلو", units), "کیلوگرم");
assert.equal(mapScanUnit("KG", units), "کیلوگرم");
assert.equal(mapScanUnit("گرم", units), "گرم");
assert.equal(mapScanUnit("کارتن", units), "کارتن");
assert.equal(mapScanUnit("بسته", units), "عدد");
assert.equal(mapScanUnit(undefined, units), "عدد");
assert.equal(toToman(250000, "rial"), 25000);
assert.equal(toToman(250000, "toman"), 250000);
assert.equal(suggestSellPrice(25000, 30), 32500);
assert.equal(suggestSellPrice(0, 30), 0);
assert.ok(suggestSellPrice(123456, 30) % 1000 === 0, "rounded to a market-friendly number");
assert.ok(suggestSellPrice(123456, 30) >= 123456 * 1.3);

// ─── ساخت ردیف‌های بازبینی و تطبیق با انبار ─────────────────────────────────
const catalog: Product[] = [
  prod({ id: "milk", name: "شیر کم‌چرب", code: "6260100", price: 40000, unit: "عدد" }),
  prod({ id: "rice", name: "برنج هاشمی", price: 200000, unit: "کیلوگرم" }),
  prod({ id: "tea", name: "چای کله مورچه ۵۰۰ گرمی", price: 300000 }),
];
const scan = sanitizeScanResult({
  currency: "rial",
  items: [
    {
      name: "شیر",
      code: "6260100",
      quantity: 12,
      unitPrice: 250000,
      lineTotal: 3000000,
      confidence: "high",
    },
    { name: "برنج هاشمی", quantity: 10, unit: "کیلو", lineTotal: 15000000, confidence: "high" },
    {
      name: "چای کله مورچه",
      quantity: 5,
      unitPrice: 2000000,
      lineTotal: 9000000,
      confidence: "low",
    },
    { name: "ماکارونی", unitPrice: 300000, lineTotal: 1500000 },
    { name: "برنج هاشمی", quantity: 2, unitPrice: 1500000 },
  ],
});
const rows = buildReviewRows(scan, {
  products: catalog,
  unitDefs: units,
  currency: "rial",
  marginPercent: 30,
});
assert.equal(rows.length, 5);

// کد → کالای موجود
assert.equal(rows[0].productId, "milk");
assert.equal(rows[0].matchedBy, "code");
assert.equal(rows[0].buyPrice, 25000, "rial → toman");
assert.equal(rows[0].sellPrice, 40000, "existing product keeps its current sell price");
assert.deepEqual(rows[0].warnings, []);

// نام دقیق + محاسبهٔ قیمت واحد از جمع ردیف + واحد کیلو
assert.equal(rows[1].productId, "rice");
assert.equal(rows[1].matchedBy, "name");
assert.equal(rows[1].unit, "کیلوگرم");
assert.equal(rows[1].buyPrice, 150000);

// نام مشابه → فقط پیشنهاد، وصل خودکار نه
assert.equal(rows[2].productId, "");
assert.equal(rows[2].suggestionId, "tea");
assert.ok(
  rows[2].warnings.some((w) => w.includes("جمع ردیف")),
  "qty×price ≠ line total flagged",
);
assert.ok(
  rows[2].warnings.some((w) => w.includes("خوانایی")),
  "low confidence flagged",
);

// تعداد از جمع ردیف
assert.equal(rows[3].quantity, 5);
assert.equal(rows[3].productId, "");
assert.equal(rows[3].sellPrice, suggestSellPrice(30000, 30));

// تکرار یک کالا
assert.ok(rows[4].warnings.some((w) => w.includes("تکرار")));
assert.ok(rows[1].warnings.some((w) => w.includes("تکرار")));

// قبول پیشنهاد
const linked = linkRowToProduct(rows[2], catalog[2]);
assert.equal(linked.productId, "tea");
assert.equal(linked.name, catalog[2].name);
assert.equal(linked.sellPrice, 300000);

// ─── تبدیل به اقلام فاکتور خرید ─────────────────────────────────────────────
const edited = rows.map((r, i) => {
  if (i === 0) return { ...r, sellPrice: 45000, sellEdited: true }; // قیمت فروش جدید
  if (i === 4) return { ...r, include: false }; // حذف ردیف تکراری
  return r;
});
const items = reviewRowsToPurchaseItems(edited, catalog, "عمومی");
assert.equal(items.length, 4);
assert.equal(items[0].productId, "milk");
assert.equal(items[0].updateSellPrice, true);
assert.equal(items[0].sellPrice, 45000);
assert.equal(items[0].code, undefined, "existing product with a code keeps its own code");
assert.equal(items[1].productId, "rice");
assert.equal(items[1].updateSellPrice, undefined, "unchanged sell price is not re-applied");
assert.equal(items[1].sellPrice, undefined);
assert.equal(items[2].productId, "", "unaccepted suggestion → new product");
assert.equal(items[2].category, "عمومی");
assert.equal(items[3].name, "ماکارونی");
assert.equal(items[3].quantity, 5);
assert.ok((items[3].sellPrice ?? 0) > 0);

// ردیف بدون نام یا مقدار صفر ثبت نمی‌شود
assert.equal(
  reviewRowsToPurchaseItems(
    [
      { ...rows[3], name: "  " },
      { ...rows[3], quantity: 0 },
    ],
    catalog,
    "",
  ).length,
  0,
);
assert.equal(reviewRowsTotal(edited), 12 * 25000 + 10 * 150000 + 5 * 200000 + 5 * 30000);

// فاکتور به تومان: بدون تقسیم
const tomanRows = buildReviewRows(scan, {
  products: catalog,
  unitDefs: units,
  currency: "toman",
  marginPercent: 0,
});
assert.equal(tomanRows[0].buyPrice, 250000);

console.log("invoice-scan tests passed");
