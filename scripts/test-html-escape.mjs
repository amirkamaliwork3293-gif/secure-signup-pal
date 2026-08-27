/**
 * بررسی سلامت فرار دادن HTML — مسیر امنیتی چاپ فاکتور/فیش.
 * اجرا:  node scripts/test-html-escape.mjs
 *
 * چرا این تست وجود دارد؟ نسخه‌ی قبلیِ escape فقط & < > را پوشش می‌داد و
 * نقل‌قول‌ها را رها می‌کرد؛ چون خروجی داخل srcdoc یک iframe هم‌مبدأ رندر
 * می‌شود، همان یک نقص کافی بود تا نام یک کالا (مثلاً از فایل اکسل یک
 * تامین‌کننده) به اجرای اسکریپت در نشست کاربر تبدیل شود.
 */
import assert from "node:assert/strict";
import { escapeHtml, safeCssColor } from "../src/lib/html-escape.ts";

// ─── هر پنج کاراکتر حساس ────────────────────────────────────────────────
assert.equal(escapeHtml("&"), "&amp;");
assert.equal(escapeHtml("<"), "&lt;");
assert.equal(escapeHtml(">"), "&gt;");
assert.equal(escapeHtml('"'), "&quot;");
assert.equal(escapeHtml("'"), "&#39;");

// ─── فرار از جایگاه متن ─────────────────────────────────────────────────
assert.equal(
  escapeHtml("<script>alert(1)</script>"),
  "&lt;script&gt;alert(1)&lt;/script&gt;",
);

// ─── فرار از جایگاه صفت (نقصی که نسخه‌ی قبلی داشت) ──────────────────────
const payload = 'x" onerror="alert(1)';
const attr = `<img src="${escapeHtml(payload)}">`;
assert.ok(!/onerror=/.test(attr.replace(/&quot;/g, "")) || !attr.includes('" onerror'),
  "نباید بتوان از مقدار صفت بیرون پرید");
assert.ok(attr.includes("&quot;"), "نقل‌قول باید escape شود");
assert.equal(attr, '<img src="x&quot; onerror=&quot;alert(1)">');

// ─── ورودی‌های تهی ──────────────────────────────────────────────────────
assert.equal(escapeHtml(null), "");
assert.equal(escapeHtml(undefined), "");
assert.equal(escapeHtml(0), "0");

// ─── متن فارسی باید دست‌نخورده بماند ────────────────────────────────────
assert.equal(escapeHtml("شیر پرچرب کاله"), "شیر پرچرب کاله");

// ─── رنگ CSS: فقط هگز معتبر ─────────────────────────────────────────────
assert.equal(safeCssColor("#1e3a8a"), "#1e3a8a");
assert.equal(safeCssColor("#fff"), "#fff");
// تلاش برای بستن بلوک <style> و تزریق اسکریپت
assert.equal(safeCssColor("red}</style><script>alert(1)</script><style>{"), "#1e3a8a");
assert.equal(safeCssColor("javascript:alert(1)"), "#1e3a8a");
assert.equal(safeCssColor(""), "#1e3a8a");
assert.equal(safeCssColor(null), "#1e3a8a");
assert.equal(safeCssColor("expression(alert(1))"), "#1e3a8a");

console.log("✓ html-escape: همه‌ی بررسی‌ها موفق");
