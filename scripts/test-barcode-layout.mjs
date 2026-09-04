/**
 * چیدمان چاپ بارکد: عدد آزاد، شبکه ستون×ردیف، اندازه کاغذ/لیبل.
 * اجرا: node --experimental-strip-types scripts/test-barcode-layout.mjs
 */
import assert from "node:assert/strict";
import {
  buildLabelsPrintHTML,
  cellPosition,
  commitBoundedNumber,
  DEFAULT_LAYOUT,
  expandCopies,
  gridMetrics,
  hasProductBarcode,
  layoutFitMessage,
  pageSlices,
  parseFaNumber,
  sanitizeLayout,
} from "../src/lib/barcode-layout.ts";

// ─── باگ قدیمی: خالی کردن فیلد به ۱ تبدیل می‌شد ───────────────────────────
assert.equal(Math.max(1, Number("")), 1, "سند باگ قبلی: Number('') می‌شود ۰ و Math.max آن را ۱ می‌کند");
assert.equal(commitBoundedNumber("", 1, 6, 3, true), 3, "فیلد خالی باید مقدار قبلی را نگه دارد، نه ۱");
assert.equal(commitBoundedNumber("5", 1, 6, 1, true), 5, "باید بتوان ۵ نوشت بدون اینکه اول ۱ باشد");
assert.equal(commitBoundedNumber("۲", 1, 12, 1, true), 2, "رقم فارسی ۲");
assert.equal(commitBoundedNumber("۱۲", 1, 20, 1, true), 12, "عدد فارسی ۱۲");
assert.equal(commitBoundedNumber("99", 1, 12, 4, true), 12, "سقف ستون");
assert.equal(commitBoundedNumber("0", 1, 12, 4, true), 1, "صفر به حداقل می‌رسد");
assert.equal(commitBoundedNumber("-1.5", -10, 10, 0, false), -1.5);
assert.equal(parseFaNumber("۳.۵"), 3.5);

// ─── شبکه A4: ۳ ستون × ۸ ردیف با لیبل ۶۰×۳۵ ─────────────────────────────
const a4 = sanitizeLayout({
  ...DEFAULT_LAYOUT,
  mode: "a4",
  paper: "A4",
  cols: 3,
  rows: 8,
  labelWidthMm: 60,
  labelHeightMm: 35,
  gapMm: 2,
});
const a4m = gridMetrics(a4);
assert.equal(a4m.cols, 3);
assert.equal(a4m.rows, 8);
assert.equal(a4m.perPage, 24);
assert.equal(a4m.totalW, 3 * 60 + 2 * 2);
assert.equal(a4m.pageW, 210);
assert.equal(a4m.pageH, 297);
assert.equal(a4m.fits, true);
assert.equal(a4m.marginX, 13);
assert.equal(a4m.marginY, 1.5);
assert.equal(layoutFitMessage(a4m), null);

const pos5 = cellPosition(5, a4m); // ششمین خانه: ستون ۲، ردیف ۱ (۰-مبنا)
assert.equal(pos5.col, 2);
assert.equal(pos5.row, 1);
assert.ok(Math.abs(pos5.x - (a4m.marginX + 2 * (60 + 2))) < 0.01);
assert.ok(Math.abs(pos5.y - (a4m.marginY + 1 * (35 + 2))) < 0.01);

const pages25 = pageSlices(25, 24);
assert.equal(pages25.length, 2);
assert.deepEqual(pages25[0], { start: 0, end: 24 });
assert.deepEqual(pages25[1], { start: 24, end: 25 });

const urls = Array.from({ length: 25 }, (_, i) => `data:image/png;base64,${i}`);
const htmlA4 = buildLabelsPrintHTML(urls, a4);
assert.match(htmlA4, /grid-template-columns:\s*repeat\(3,\s*60mm\)/);
assert.match(htmlA4, /grid-auto-rows:\s*35mm/);
assert.match(htmlA4, /@page \{\s*size: A4 portrait; margin: 0;/);
assert.equal((htmlA4.match(/<section class="page">/g) || []).length, 2);
assert.doesNotMatch(htmlA4, /flex-wrap/);
assert.doesNotMatch(htmlA4, /dir="rtl"/);
assert.match(htmlA4, /print-color-adjust:\s*exact/);

// ─── اگر ستون×اندازه از کاغذ بزرگ‌تر شود باید هشدار بدهد ────────────────
const wide = gridMetrics(sanitizeLayout({ mode: "a4", paper: "A4", cols: 5, rows: 2, labelWidthMm: 60, labelHeightMm: 35, gapMm: 2 }));
assert.equal(wide.fits, false);
assert.ok(layoutFitMessage(wide)?.includes("عرض"));

// ─── لیبل‌زن: ۲ ستون ۵۰mm با فاصله ۲ → صفحه ۱۰۲×۳۰ ───────────────────────
const roll = sanitizeLayout({
  mode: "label",
  cols: 2,
  rows: 1,
  labelWidthMm: 50,
  labelHeightMm: 30,
  gapMm: 2,
  copies: 1,
});
const rm = gridMetrics(roll);
assert.equal(rm.pageW, 102);
assert.equal(rm.pageH, 30);
assert.equal(rm.perPage, 2);
const htmlRoll = buildLabelsPrintHTML(["data:image/png;base64,aa", "data:image/png;base64,bb", "data:image/png;base64,cc"], roll);
assert.match(htmlRoll, /@page \{ size: 102mm 30mm; margin: 0; \}/);
assert.match(htmlRoll, /grid-template-columns:\s*repeat\(2,\s*50mm\)/);
assert.equal((htmlRoll.match(/<section class="page">/g) || []).length, 2);

const sheet2x2 = gridMetrics(sanitizeLayout({
  mode: "label",
  cols: 2,
  rows: 2,
  labelWidthMm: 40,
  labelHeightMm: 30,
  gapMm: 2,
}));
assert.equal(sheet2x2.pageW, 82);
assert.equal(sheet2x2.pageH, 62);
assert.equal(sheet2x2.perPage, 4);

// ─── تکرار هر بارکد ─────────────────────────────────────────────────────
assert.deepEqual(expandCopies(["a", "b"], 3), ["a", "a", "a", "b", "b", "b"]);

// ─── محصول بدون بارکد ───────────────────────────────────────────────────
assert.equal(hasProductBarcode(""), false);
assert.equal(hasProductBarcode("   "), false);
assert.equal(hasProductBarcode("PABC"), true);

// ─── sanitize مقادیر خراب ───────────────────────────────────────────────
const junk = sanitizeLayout({ cols: 0, rows: -4, copies: 500, labelWidthMm: 3, gapMm: 99, mode: "a4" });
assert.equal(junk.cols, 1);
assert.equal(junk.rows, 1);
assert.equal(junk.copies, 99);
assert.equal(junk.labelWidthMm, 15);
assert.equal(junk.gapMm, 20);
assert.equal(junk.paper, "A4");

console.log("✓ barcode-layout: همه‌ی بررسی‌ها موفق");
