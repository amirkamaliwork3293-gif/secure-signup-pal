/**
 * تشخیص اجرای برنامه داخل اپلیکیشن اندروید (WebView / Capacitor).
 * وقتی داخل اپ باشیم، صفحه‌ی معرفی (Landing) نمایش داده نمی‌شود و کاربر
 * مستقیم صفحه‌ی ورود را می‌بیند. در مرورگر معمولی، صفحه‌ی معرفی نمایش داده می‌شود.
 */

const APP_FLAG_KEY = "kamix_is_app";

function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : true);
}

function uaLooksLikeWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // فقط برچسب سفارشی خودِ اپ کامیکس را معتبر می‌دانیم.
  // توجه: امضای عمومی Android WebView (";wv)") عمداً چک نمی‌شود، چون
  // مرورگرهای درون‌برنامه‌ای اینستاگرام/فیسبوک/لینکدین و... هم از همین
  // WebView سیستمی استفاده می‌کنند و باعث تشخیص اشتباهِ «داخل اپ کامیکس»
  // می‌شدند (نتیجه‌اش: رد شدن اشتباهیِ صفحه‌ی معرفی برای بازدیدکننده‌های
  // لینک بایوی اینستاگرام).
  return /KAMIX(App)?/i.test(ua);
}

/**
 * true یعنی داخل اپلیکیشن/وب‌ویو هستیم → فقط صفحه‌ی ورود نمایش داده شود.
 * روش‌های تشخیص: Capacitor، پارامتر آدرس (?app=1)، فلگ ذخیره‌شده، و UA وب‌ویو.
 */
export function isWebView(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    const appParam = params.get("app");
    if (appParam === "1" || appParam === "android" || appParam === "true") {
      try { localStorage.setItem(APP_FLAG_KEY, "1"); } catch {}
      return true;
    }
    if (localStorage.getItem(APP_FLAG_KEY) === "1") return true;
  } catch {}

  return isCapacitor() || uaLooksLikeWebView();
}
