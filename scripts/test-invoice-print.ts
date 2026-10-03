/**
 * فاز ۵ — طراحی چاپی فاکتور و فیش: کنتراست برای چاپ سیاه‌وسفید، اندازهٔ صفحهٔ معتبر
 * برای فیش، تنظیمات قابل تغییر، چاپ آزمایشی، یکسانی اعداد بین A4/فیش/PDF و قالب‌ها.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-invoice-print.ts
 */
import assert from "node:assert/strict";
import {
  buildDefaultInvoiceHTML,
  buildThermalInvoiceHTML,
  invoiceAmountLines,
  invoicePalette,
  printableAccent,
  relativeLuminance,
} from "../src/lib/invoice-document.ts";
import {
  buildInvoiceHTML,
  corporateTemplate,
  defaultTemplate,
  minimalTemplate,
} from "../src/lib/invoice-template.ts";
import {
  DEFAULT_RECEIPT,
  buildReceiptCalibrationHTML,
  normalizeReceiptSettings,
  withReceiptPageHeight,
} from "../src/lib/receipt.ts";
import type { Invoice } from "../src/lib/store.ts";

const contrast = (hex: string) => 1.05 / (relativeLuminance(hex) + 0.05);

// ── رنگ‌ها روی کاغذ سفید پررنگ‌اند ──
for (const light of ["#c4a574", "#ffcc00", "#7dd3fc", "#f0f0f0", "#ff69b4", "not-a-color"]) {
  assert.ok(contrast(printableAccent(light)) >= 7, `accent ${light} must be darkened`);
}
assert.equal(printableAccent("#1f3a5f"), "#1f3a5f", "a dark accent is kept as-is");
const P = invoicePalette("#ffcc00");
for (const k of [
  "ink",
  "bronze",
  "muted",
  "line",
  "gold",
  "accent",
  "danger",
  "success",
] as const) {
  assert.ok(contrast(P[k]) >= 7, `palette.${k} (${P[k]}) too light for B&W printing`);
}
assert.equal(P.paper, "#ffffff", "white paper — no ivory background");

const inv: Invoice = {
  id: "kx9a2b",
  createdAt: Date.parse("2026-03-21T10:00:00Z"),
  items: [
    {
      productId: "1",
      name: "پنیر <محلی>",
      price: 185000,
      quantity: 1.25,
      unit: "کیلوگرم",
      discountPercent: 10,
      originalPrice: 205000,
    },
    { productId: "2", name: "روغن", price: 420000, quantity: 2 },
  ],
  total: 0,
  customer: { firstName: "علی", lastName: "محمدی", phone: "09120000000" },
  customerFields: [{ label: "کد ملی", value: "0012345678" }],
  shopName: "فروشگاه نمونه",
  shopPhone: "021-66001122",
  paymentMethod: "credit",
  paidAmount: 100000,
  notes: "یادداشت",
  discountPercent: 5,
  taxPercent: 10,
};
const grand = invoiceAmountLines(inv).find((l) => l.kind === "grand")!;

// ── A4/A5 ──
for (const paper of ["A4", "A5", "Letter"] as const) {
  const html = buildDefaultInvoiceHTML(inv, 13, paper, "print");
  assert.ok(/@page \{ size: (A4|A5|letter) portrait;/.test(html), paper);
  assert.ok(html.includes(grand.amount), "same grand total as receipt/PDF");
  assert.ok(html.includes("مشخصات فروشنده") && html.includes("مشخصات خریدار"));
  assert.ok(
    html.includes("کد ملی") && html.includes("0012345678"),
    "pinned customer fields printed",
  );
  assert.ok(html.includes('font-family:"Vazirmatn"'), "print uses the preview font");
  assert.ok(html.includes("/fonts/Vazirmatn-Regular.woff2"), "bundled font face");
  for (const faint of ["#c4a574", "#8a7d70", "#f7f1e6", "rgba(26,20,16,.08)"]) {
    assert.equal(html.includes(faint), false, `faint colour ${faint} must be gone`);
  }
  assert.ok(html.includes("پنیر &lt;محلی&gt;"), "escaped");
}

// ── existing saved designer templates still render ──
for (const make of [defaultTemplate, corporateTemplate, minimalTemplate]) {
  const tpl = make();
  tpl.enabled = true;
  tpl.accent = "#fde68a"; // a light accent saved by a user earlier
  const html = buildInvoiceHTML(inv, 13, tpl, "A4", "print");
  assert.ok(html.includes(grand.amount));
  assert.equal(html.includes("#fde68a"), false, "light template accent is darkened for print");
}

// ── receipt settings ──
const d = normalizeReceiptSettings(undefined);
assert.deepEqual(d, normalizeReceiptSettings(DEFAULT_RECEIPT));
assert.equal(d.paperMm, 80);
assert.equal(d.printableMm, 72);
const small = normalizeReceiptSettings({ paperMm: 58 });
assert.equal(small.printableMm, 48);
assert.equal(small.fontPx, 11);
const junk = normalizeReceiptSettings({
  paperMm: "x",
  printableMm: 999,
  fontPx: -3,
  show: { logo: "yes" },
});
assert.equal(junk.paperMm, 80);
assert.equal(junk.printableMm, 80, "printable never wider than paper");
assert.equal(junk.fontPx, 9);
assert.equal(junk.show.logo, true, "invalid flag keeps default");

// ── receipt document ──
const r = buildThermalInvoiceHTML(inv, d);
assert.equal(/size:\s*80mm\s+auto/.test(r), false, "no invalid `size: 80mm auto`");
assert.ok(/@page \{ size: 80mm \d+mm;/.test(r));
assert.ok(r.includes("width:72mm"), "content laid out at printable width");
assert.ok(r.includes(grand.value));
assert.ok(r.includes("0012345678"));
assert.ok(r.includes("پنیر &lt;محلی&gt;"));
assert.ok(!/#(333|555|666|777|888|999|aaa|bbb|ccc)\b/i.test(r), "receipt is pure black");
const hidden = buildThermalInvoiceHTML(
  inv,
  normalizeReceiptSettings({ show: { customerFields: false, customer: false } }),
);
assert.equal(hidden.includes("0012345678"), false);
assert.equal(hidden.includes("09120000000"), false);
const footer = buildThermalInvoiceHTML(
  inv,
  normalizeReceiptSettings({ footerText: "<b>منتظر شما هستیم</b>" }),
);
assert.ok(footer.includes("&lt;b&gt;منتظر شما هستیم"), "footer text escaped");
const r58 = buildThermalInvoiceHTML(inv, small);
assert.ok(r58.includes("size: 58mm") && r58.includes("width:48mm"));

// page height rewrite (used after measuring the real content height)
const sized = withReceiptPageHeight(r, 183.2);
assert.ok(sized.includes("@page { size: 80mm 184mm;"));
assert.equal(withReceiptPageHeight(r, NaN), r);
assert.ok(withReceiptPageHeight(r58, 120).includes("@page { size: 58mm 120mm;"));

// calibration page
const cal = buildReceiptCalibrationHTML(d, "فروشگاه");
assert.ok(cal.includes("چاپ آزمایشی"));
assert.ok(cal.includes("۷۰") && cal.includes("عرض قابل چاپ"));
assert.ok(cal.includes("data-kamix-receipt"));

console.log("invoice print tests passed");
