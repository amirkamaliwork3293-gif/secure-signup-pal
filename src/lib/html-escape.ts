/**
 * فرار دادن (escape) متن پیش از قرار گرفتن در HTML.
 *
 * چرا یک فایل مشترک؟ قبلاً دو نسخه‌ی جداگانه در InvoiceActions.tsx و
 * invoice-template.ts وجود داشت که **هیچ‌کدام نقل‌قول را escape نمی‌کردند**؛
 * یعنی در جایگاه صفت (`src="${...}"`) می‌شد با یک `"` از صفت بیرون پرید:
 *
 *     shopLogoUrl = 'x" onerror="fetch(...)'
 *     → <img src="x" onerror="fetch(...)" />
 *
 * این نسخه هر پنج کاراکتر حساس HTML را پوشش می‌دهد و هم برای متن و هم برای
 * مقدار صفت امن است. خروجی همه‌ی سازنده‌های HTML چاپی از همین‌جا می‌گذرد.
 */
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]!);
}

/**
 * مقدار امن برای درج در CSS (مثلاً رنگ قالب فاکتور).
 *
 * رنگ فاکتور از یک `<input type="color">` می‌آید، اما در `user_data` ذخیره
 * می‌شود و صاحب حساب می‌تواند مستقیماً از طریق API هر رشته‌ای در آن بنویسد.
 * چون این مقدار داخل بلوک `<style>` درج می‌شود، رشته‌ای مثل
 * `red}</style><script>…` امکان اجرای اسکریپت می‌داد. اینجا فقط رنگ‌های
 * هگزادسیمال معتبر پذیرفته می‌شوند و بقیه به مقدار پیش‌فرض برمی‌گردند.
 */
export function safeCssColor(v: unknown, fallback = "#1e3a8a"): string {
  const s = String(v ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
}
