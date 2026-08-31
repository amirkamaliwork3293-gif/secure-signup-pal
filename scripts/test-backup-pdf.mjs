/**
 * سند پشتیبان PDF: فرار HTML، لوگوی امن، قالب سلول و ساختار چاپ.
 * اجرا: node --experimental-strip-types scripts/test-backup-pdf.mjs
 */
import assert from "node:assert/strict";
import { escapeHtml } from "../src/lib/html-escape.ts";
import {
  backupHeaderIsMoney,
  backupHeaderIsPercent,
  backupHeaderIsCount,
  backupHeaderIsCode,
} from "../src/lib/backup-export.ts";
import {
  formatBackupPdfCell,
  safeBackupLogoUrl,
  buildBackupPrintHtml,
} from "../src/lib/backup-pdf.ts";

assert.equal(backupHeaderIsPercent("درصد تخفیف"), true);
assert.equal(backupHeaderIsMoney("درصد تخفیف"), false);
assert.equal(backupHeaderIsMoney("مبلغ تخفیف"), true);
assert.equal(backupHeaderIsMoney("قیمت فروش"), true);
assert.equal(backupHeaderIsCount("تعداد اقلام"), true);
assert.equal(backupHeaderIsCode("شماره کارت"), true);
assert.equal(backupHeaderIsCode("تلفن مشتری"), true);

const empty = formatBackupPdfCell("نام", "");
assert.equal(empty.text, "—");
assert.equal(empty.kind, "text");

const money = formatBackupPdfCell("قیمت فروش", 12500);
assert.equal(money.kind, "money");
assert.ok(money.text.includes("۱۲") || money.text.includes("12") || /[۰-۹]/.test(money.text));

const percent = formatBackupPdfCell("درصد تخفیف", 10);
assert.equal(percent.kind, "percent");
assert.ok(percent.text.includes("٪"));

const code = formatBackupPdfCell("تلفن", "0912");
assert.equal(code.kind, "code");
assert.equal(code.text, "۰۹۱۲");

assert.equal(safeBackupLogoUrl("https://kamixapp.ir/logo.png"), "https://kamixapp.ir/logo.png");
assert.equal(safeBackupLogoUrl("http://example.com/a.jpg"), "http://example.com/a.jpg");
assert.ok(safeBackupLogoUrl("data:image/png;base64,aaa"));
assert.equal(safeBackupLogoUrl("javascript:alert(1)"), null);
assert.equal(safeBackupLogoUrl("data:text/html,<script>"), null);
assert.equal(safeBackupLogoUrl("vbscript:x"), null);
assert.equal(safeBackupLogoUrl(""), null);
assert.equal(safeBackupLogoUrl(null), null);

const payload = "<script>alert(1)</script>";
const attr = 'x" onerror="alert(1)';
const html = buildBackupPrintHtml(
  [
    {
      name: "خلاصه",
      rows: [
        {
          بخش: "تاریخ تهیه نسخه پشتیبان",
          "تعداد رکورد": "",
          "شرح مبلغ": "۱۴۰۵/۰۶/۰۹",
          مبلغ: "",
        },
        {
          بخش: "محصولات و انبار",
          "تعداد رکورد": 2,
          "شرح مبلغ": "ارزش موجودی انبار (به قیمت فروش)",
          مبلغ: 50000,
        },
      ],
    },
    {
      name: "محصولات",
      rows: [{ نام: payload, کد: attr, "قیمت فروش": 1000, توضیحات: "شیر پرچرب" }],
    },
  ],
  {
    shopName: 'فروشگاه "نمونه"',
    shopAddress: "<b>آدرس</b>",
    shopPhone: "021-1",
    logoUrl: "javascript:alert(1)",
    generatedAtLabel: "۱۴۰۵/۰۶/۰۹ — ۱۲:۰۰",
    currency: "تومان",
  },
);

assert.ok(html.includes('lang="fa"'));
assert.ok(html.includes('dir="rtl"'));
assert.ok(html.includes("size: A4 landscape"));
assert.ok(!html.includes("javascript:alert"));
assert.ok(!html.includes("<script>alert(1)</script>"));
assert.ok(html.includes(escapeHtml(payload)));
assert.ok(html.includes("&quot; onerror=&quot;"), "نقل‌قول XSS باید escape شود");
assert.ok(!html.includes('onerror="alert'), "نباید بتوان از سلول جدول بیرون پرید");
assert.ok(html.includes(escapeHtml('فروشگاه "نمونه"')));
assert.ok(html.includes(escapeHtml("<b>آدرس</b>")));
assert.ok(!html.includes("<b>آدرس</b>"));
assert.ok(html.includes('تلفن: <span dir="ltr">021-1</span>'), "شماره تلفن باید چپ‌به‌راست بماند");
assert.ok(html.includes("محصولات"));
assert.ok(html.includes("نسخه پشتیبان"));
assert.ok(html.includes("کامیکس"));
assert.ok(!/\bzoom\s*:/.test(html), "نباید کل سند را به یک صفحه مقیاس کند");
assert.ok(html.includes("thead"), "سرستون باید برای تکرار در صفحات چاپ باشد");
assert.ok(!html.includes('class="logo"'), "لوگوی نامعتبر نباید تگ img بسازد");

const withLogo = buildBackupPrintHtml(
  [{ name: "هزینه‌ها", rows: [{ عنوان: "اجاره", مبلغ: 200 }] }],
  {
    shopName: "کافه",
    logoUrl: "https://kamixapp.ir/og-image.png",
    generatedAtLabel: "امروز",
    currency: "تومان",
  },
);
assert.ok(withLogo.includes('class="logo"'));
assert.ok(withLogo.includes("https://kamixapp.ir/og-image.png"));
assert.ok(withLogo.includes("هزینه‌ها"));

console.log("ok: backup pdf print document");
