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
  RECEIPT_TABLE_FROM,
  receiptDocument,
  receiptItemsHtml,
  receiptPageWidthMm,
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

// ── receipt size (scalePct) ──
assert.equal(d.scalePct, 100, "default size is 100%");
assert.equal(normalizeReceiptSettings({ scalePct: 1000 }).scalePct, 300);
assert.equal(normalizeReceiptSettings({ scalePct: 5 }).scalePct, 50);
assert.equal(normalizeReceiptSettings({ scalePct: "x" }).scalePct, 100);
{
  // settings saved before this option existed → output unchanged
  const legacy = { ...DEFAULT_RECEIPT } as Partial<typeof DEFAULT_RECEIPT>;
  delete legacy.scalePct;
  assert.equal(
    receiptDocument({ title: "t", body: "b", s: normalizeReceiptSettings(legacy) }),
    receiptDocument({ title: "t", body: "b", s: { ...DEFAULT_RECEIPT } }),
  );
  const big = normalizeReceiptSettings({ scalePct: 200 });
  const html = receiptDocument({ title: "t", body: "b", s: big });
  assert.ok(html.includes('data-kamix-receipt="160"'), "page width scales");
  assert.ok(html.includes("width:144mm"), "printable width scales");
  assert.ok(html.includes("font-size:26px"), "font scales");
  assert.equal(receiptPageWidthMm(big), 160);
  // calibration ruler always prints at real size
  assert.ok(buildReceiptCalibrationHTML(big).includes('data-kamix-receipt="80"'));
}

// ── item layout: two lines vs compact table ──
{
  assert.equal(d.itemLayout, "auto", "auto by default");
  assert.equal(normalizeReceiptSettings({ itemLayout: "weird" }).itemLayout, "auto");
  const row = (i: number) => ({
    name: `کالا ${i} <b>`,
    qty: "۲",
    unitPrice: "۱۰٬۰۰۰",
    total: "۲۰٬۰۰۰",
    was: i === 0 ? "۱۲٬۰۰۰" : undefined,
    tag: i === 0 ? "٪۱۰ تخفیف" : undefined,
  });
  const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));
  const few = receiptItemsHtml(rows(RECEIPT_TABLE_FROM - 1), d);
  assert.ok(!few.includes("<table") && few.includes('class="it"'), "few items → two lines");
  const many = receiptItemsHtml(rows(RECEIPT_TABLE_FROM), d);
  assert.ok(many.includes('<table class="tb">'), "many items → table");
  assert.equal((many.match(/<tr>/g) ?? []).length, RECEIPT_TABLE_FROM + 1, "header + one row each");
  assert.ok(
    !many.includes(">فی<") && !many.includes('class="p"') && !many.includes("<s>"),
    "no unit-price column",
  );
  assert.ok(many.includes('<th class="t">مبلغ</th>'));
  const widths = (h: string) => [...h.matchAll(/width:(\d+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths(many), [62, 14, 24], "short amounts: name gets most of the row");
  assert.ok(!many.includes('em"'), "short amounts keep full size");
  const big = receiptItemsHtml(
    rows(8).map((r) => ({ ...r, total: "۱۲۳٬۴۵۶٬۷۸۹٬۰۰۰" })),
    d,
  );
  const [nameW, , totalW] = widths(big);
  assert.ok(
    totalW > 24 && totalW <= 46 && nameW + 14 + totalW === 100,
    "long amounts widen the column",
  );
  assert.ok(!big.includes("<wbr>"), "amounts never break");
  const huge = receiptItemsHtml(
    rows(8).map((r) => ({ ...r, total: "۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹" })),
    normalizeReceiptSettings({ paperMm: 58 }),
  );
  const em = Number(huge.match(/font-size:([\d.]+)em/)?.[1]);
  assert.ok(em >= 0.6 && em < 1, `only the amount column shrinks for huge amounts (${em})`);
  assert.ok(many.includes("٪۱۰ تخفیف") && many.includes("&lt;b&gt;"), "tags shown, names escaped");
  assert.ok(
    !receiptItemsHtml(rows(20), normalizeReceiptSettings({ itemLayout: "lines" })).includes(
      "<table",
    ),
  );
  assert.ok(
    receiptItemsHtml(rows(1), normalizeReceiptSettings({ itemLayout: "table" })).includes("<table"),
  );
  assert.equal(receiptItemsHtml([], d), "", "no items → empty (caller shows placeholder)");
  const narrow = receiptItemsHtml(rows(8), normalizeReceiptSettings({ paperMm: 58 }));
  assert.ok(!narrow.includes(">فی<") && !narrow.includes("فی "), "58mm: no unit price either");
  assert.equal(widths(narrow)[1], 17, "58mm: wider qty share");
  // settings saved before this option → auto
  const legacy = { ...DEFAULT_RECEIPT } as Partial<typeof DEFAULT_RECEIPT>;
  delete legacy.itemLayout;
  assert.equal(normalizeReceiptSettings(legacy).itemLayout, "auto");
}

// ── split into A4-shaped pages (splitA4) ──
{
  assert.equal(d.splitA4, false, "off by default");
  assert.equal(normalizeReceiptSettings({ splitA4: "yes" }).splitA4, false);
  const legacy = { ...DEFAULT_RECEIPT } as Partial<typeof DEFAULT_RECEIPT>;
  delete legacy.splitA4;
  const plain = receiptDocument({ title: "t", body: "b", s: normalizeReceiptSettings(legacy) });
  assert.equal(plain.includes("data-split-a4"), false, "off → no marker");
  assert.ok(withReceiptPageHeight(plain, 900).includes("size: 80mm 900mm"), "off → one long page");

  const split = receiptDocument({
    title: "t",
    body: "b",
    s: normalizeReceiptSettings({ splitA4: true, scalePct: 250 }),
  });
  // 200mm wide → A4-shaped pages are 282mm tall (200 × 297/210)
  assert.ok(withReceiptPageHeight(split, 900).includes("size: 200mm 282mm"), "long → A4 pages");
  assert.ok(withReceiptPageHeight(split, 150).includes("size: 200mm 150mm"), "short → own height");
  assert.equal(
    buildReceiptCalibrationHTML(normalizeReceiptSettings({ splitA4: true })).includes(
      "data-split-a4",
    ),
    false,
    "calibration never split",
  );
}

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
