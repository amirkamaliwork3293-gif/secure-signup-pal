/**
 * تست «مبلغ به حروف» در واحد نمایش: عدد، حروف و برچسب واحد (تومان/ریال) باید
 * همیشه یکی باشند — در چاپ A4، فیش حرارتی و فاکتور خرید.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-amount-words-unit.ts
 */

import assert from "node:assert/strict";

const mem = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as { document?: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: "visible",
};
if (typeof CustomEvent === "undefined") {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}
(globalThis as { window?: unknown }).window = {
  localStorage,
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
};
(globalThis as { localStorage?: unknown }).localStorage = localStorage;

const { amountToPersianWords } = await import("../src/lib/amount-words.ts");
const store = await import("../src/lib/store.ts");
const { amountInDisplayUnit, settings, formatAmount, currencyLabel } = store;
const { invoiceTotals } = await import("../src/lib/invoice-math.ts");

// ── تابع مشترک، با واحد صریح ────────────────────────────────────────────────
{
  const t = amountInDisplayUnit(125_000, "toman");
  assert.equal(t.label, "تومان");
  assert.equal(t.words, "صد و بیست و پنج هزار");
  assert.equal(t.wordsText, "صد و بیست و پنج هزار تومان");
  assert.equal(t.digits, "۱۲۵٬۰۰۰");

  const r = amountInDisplayUnit(125_000, "rial");
  assert.equal(r.label, "ریال");
  assert.equal(r.words, "یک میلیون و دویست و پنجاه هزار", "rial words = toman × 10");
  assert.equal(r.wordsText, "یک میلیون و دویست و پنجاه هزار ریال");
  assert.equal(r.digits, "۱٬۲۵۰٬۰۰۰");
}
{
  assert.equal(amountInDisplayUnit(0, "toman").wordsText, "صفر تومان");
  assert.equal(amountInDisplayUnit(0, "rial").wordsText, "صفر ریال");
  // ورودی نامعتبر صفر حساب می‌شود و برنامه را نمی‌شکند
  assert.equal(amountInDisplayUnit(Number.NaN, "rial").digits, "۰");
}
{
  // عدد بزرگ: ۹۶٬۲۹۴٬۹۶۰ تومان = ۹۶۲٬۹۴۹٬۶۰۰ ریال
  const r = amountInDisplayUnit(96_294_960, "rial");
  assert.equal(r.words, "نهصد و شصت و دو میلیون و نهصد و چهل و نه هزار و ششصد");
  const big = amountInDisplayUnit(12_345_678_901, "rial");
  assert.equal(big.words, amountToPersianWords(123_456_789_010));
  assert.ok(big.words.includes("میلیارد"));
  // خارج از بازه‌ی حروف: سطر حروف خالی است (نه حروف اشتباه)
  assert.equal(amountInDisplayUnit(2e14, "rial").wordsText, "");
}

// ── سند فاکتور در حالت ریال: عدد و حروف و واحد یکی باشند ───────────────────
settings.save({ ...settings.get(), currencyUnit: "rial" });
assert.equal(currencyLabel(), "ریال");

const { invoicePayCardHtml, buildThermalInvoiceHTML, buildDefaultInvoiceHTML } =
  await import("../src/lib/invoice-document.ts");
const inv = {
  id: "w1",
  createdAt: Date.parse("2026-03-21T10:00:00Z"),
  items: [
    { productId: "a", name: "پنیر", price: 185_000, quantity: 2 },
    { productId: "b", name: "روغن", price: 420_000, quantity: 1 },
  ],
  total: 0,
  paymentMethod: "credit" as const,
  paidAmount: 100_000,
  discountPercent: 5,
  taxPercent: 9,
};
const t = invoiceTotals(inv);
// ۷۹۰٬۰۰۰ − ۵٪ = ۷۵۰٬۵۰۰ ؛ مالیات ۹٪ = ۶۷٬۵۴۵ ؛ جمع = ۸۱۸٬۰۴۵ تومان
assert.equal(t.total, 818_045);
const rialWords = amountToPersianWords(8_180_450);
const card = invoicePayCardHtml(inv);
assert.ok(card.includes(formatAmount(t.total)), "grand digits in rial");
assert.ok(card.includes("۸٬۱۸۰٬۴۵۰"));
assert.ok(card.includes(`${rialWords} ریال`), "words are the rial amount");
assert.ok(!card.includes(amountToPersianWords(818_045)), "no toman words under a rial label");

const thermal = buildThermalInvoiceHTML(inv, {
  ...(await import("../src/lib/receipt.ts")).normalizeReceiptSettings({}),
  show: {
    ...(await import("../src/lib/receipt.ts")).normalizeReceiptSettings({}).show,
    amountWords: true,
  },
});
assert.ok(thermal.includes(`${rialWords} ریال`), "thermal words in rial");

// ── مهر «تسویه شد» دیگر روی فاکتور چاپ نمی‌شود (فقط نمایش) ────────────────
const cash = { ...inv, id: "w2", paymentMethod: "cash" as const, paidAmount: undefined };
const cashHtml = buildDefaultInvoiceHTML(cash, 13, "A4", "print");
assert.ok(!cashHtml.includes("تسویه شد"));
assert.ok(!cashHtml.includes("تسویه شده"));
assert.ok(buildDefaultInvoiceHTML(inv, 13, "A4", "print").includes("دارای مانده"));

console.log("amount-words-unit: all ok");
