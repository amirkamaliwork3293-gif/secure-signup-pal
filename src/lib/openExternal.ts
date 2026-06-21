/**
 * باز کردن لینک‌های بیرونی به‌شکلی که هم در مرورگر و هم داخل WebView اپ (Capacitor)
 * درست کار کند. لینک‌هایی مثل `sms:`، `https://wa.me/...` و صفحه عمومی فروشگاه
 * باید داخل اپ اندروید هم باز شوند، نه فقط در مرورگر.
 *
 * در Capacitor، `window.open(url, "_system")` لینک را با مرورگر/اپ پیش‌فرض سیستم
 * باز می‌کند (به‌جای تلاش برای بارگذاری داخل WebView که برای schemeهایی مثل
 * `sms:` شکست می‌خورد). در مرورگر معمولی از یک anchor موقت استفاده می‌کنیم.
 */
function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : true);
}

export function openExternal(url: string): void {
  if (typeof window === "undefined") return;

  // داخل اپ اندروید: باز کردن با اپ پیش‌فرض سیستم (پیامک/واتساپ/مرورگر)
  if (isCapacitor()) {
    try {
      window.open(url, "_system");
      return;
    } catch {
      // اگر باز نشد، به مسیر معمول می‌افتیم
    }
  }

  // مرورگر معمولی: برای schemeهای اپ (sms:/tel:/whatsapp:) از location استفاده
  // می‌کنیم تا کاربر به اپ مربوطه هدایت شود؛ برای http(s) یک تب جدید باز می‌کنیم.
  const isAppScheme = /^(sms|tel|mailto|whatsapp|geo):/i.test(url);
  if (isAppScheme) {
    window.location.href = url;
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * نرمال‌سازی شماره موبایل ایران به فرمت بین‌المللی برای لینک واتساپ (wa.me).
 * مثال: «۰۹۱۲۱۲۳۴۵۶۷» یا «09121234567» → «989121234567».
 */
export function toIntlPhone(phone: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let digits = "";
  for (const ch of String(phone)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) digits += String(fi);
    else if (ai >= 0) digits += String(ai);
    else if (ch >= "0" && ch <= "9") digits += ch;
  }
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12) {
    /* already intl */
  } else if (digits.startsWith("0")) digits = "98" + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("9")) digits = "98" + digits;
  return digits;
}
