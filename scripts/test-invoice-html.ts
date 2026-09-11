/**
 * تست سند فاکتور: نمایش و چاپ جدا هستند، داده حفظ می‌شود، HTML امن است.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-invoice-html.ts
 */
import assert from "node:assert/strict";
import {
  buildDefaultInvoiceHTML,
  buildShareText,
  buildThermalInvoiceHTML,
  invoiceAmountLines,
  invoiceBaseFontSize,
} from "../src/lib/invoice-document.ts";
import { buildInvoiceHTML, corporateTemplate } from "../src/lib/invoice-template.ts";
import { invoiceTotals } from "../src/lib/invoice-math.ts";
import { formatAmount, type Invoice } from "../src/lib/store.ts";

const inv: Invoice = {
  id: "kx9a2b",
  createdAt: Date.parse("2026-03-21T10:00:00Z"),
  items: [
    {
      productId: "1",
      name: "پنیر <محلی>",
      price: 185000,
      quantity: 2,
      unit: "کیلوگرم",
      discountPercent: 10,
      originalPrice: 205000,
    },
    { productId: "2", name: 'روغن "زیتون"', price: 420000, quantity: 1 },
  ],
  total: 0,
  customer: { firstName: "علی", lastName: "محمدی", phone: "09120000000" },
  shopName: "فروشگاه نمونه",
  shopAddress: "تهران",
  shopPhone: "02100000000",
  paymentMethod: "credit",
  paidAmount: 100000,
  notes: "تحویل درب مغازه",
  discountPercent: 5,
  taxPercent: 9,
  customFields: { fieldA: "مقدار سفارشی" },
};

const totals = invoiceTotals(inv);
const lines = invoiceAmountLines(inv);
const grand = lines.find((l) => l.kind === "grand");
assert.ok(grand);
assert.ok(grand!.value.includes(formatAmount(totals.total)));
assert.ok(lines.some((l) => l.kind === "due"));
assert.ok(invoiceBaseFontSize(13, "screen") >= 16);
assert.ok(invoiceBaseFontSize(13, "print") >= 12);
assert.ok(invoiceBaseFontSize(13, "screen") > invoiceBaseFontSize(13, "print"));

const screen = buildDefaultInvoiceHTML(inv, 13, "A4", "screen");
const print = buildDefaultInvoiceHTML(inv, 13, "A4", "print");
const a5 = buildDefaultInvoiceHTML(inv, 13, "A5", "print");

assert.equal(
  screen.includes("root.style.zoom"),
  false,
  "پیش‌نمایش نباید فاکتور را با zoom کوچک کند",
);
assert.equal(print.includes("root.style.zoom"), false, "چاپ نباید فاکتور را با zoom کوچک کند");
assert.equal(screen.includes("transform = 'scale"), false);
assert.equal(print.includes("Math.max(0.42"), false);
assert.ok(screen.includes("max-width: 920px"), "پیش‌نمایش باید عرض خوانا داشته باشد");
assert.ok(print.includes("@page"), "چاپ باید اندازه کاغذ داشته باشد");
assert.ok(a5.includes("A5") || a5.includes("size: A5") || a5.toLowerCase().includes("a5"));

for (const html of [screen, print]) {
  assert.ok(html.includes("فروشگاه نمونه"));
  assert.ok(html.includes("علی محمدی"));
  assert.ok(html.includes("09120000000"));
  assert.ok(html.includes("تحویل درب مغازه"));
  assert.ok(html.includes("پنیر &lt;محلی&gt;"), "نام کالا باید escape شود");
  assert.ok(html.includes("روغن &quot;زیتون&quot;"));
  assert.equal(html.includes("<محلی>"), false);
  assert.ok(html.includes("KX9A2B") || html.includes("kx9a2b".toUpperCase()));
  assert.ok(html.includes("مشخصات فروشنده"));
  assert.ok(html.includes("مشخصات خریدار"));
  assert.ok(html.includes("جمع کل"));
}

const share = buildShareText(inv);
assert.ok(share.includes("فروشگاه نمونه"));
assert.ok(share.includes("علی محمدی"));
assert.ok(share.includes("تحویل درب مغازه"));
assert.ok(share.includes("جمع کل"));

const thermal = buildThermalInvoiceHTML(inv);
assert.ok(thermal.includes("80mm"));
assert.ok(thermal.includes("فروشگاه نمونه"));
assert.ok(thermal.includes("پنیر &lt;محلی&gt;"));

const tpl = corporateTemplate();
tpl.enabled = true;
const idField = tpl.blocks.flatMap((b) => b.fields).find((f) => f.key === "shop.name");
if (idField) idField.id = "fieldA";
const custom = buildInvoiceHTML(inv, 13, tpl, "A4", "screen");
assert.ok(custom.includes("صورتحساب") || custom.includes(tpl.title));
assert.ok(custom.includes("فروشگاه نمونه") || custom.includes("مقدار سفارشی"));
assert.ok(custom.includes("مقدار سفارشی"));
assert.equal(custom.includes("root.style.zoom"), false);

console.log("all invoice html / display-print checks passed");
