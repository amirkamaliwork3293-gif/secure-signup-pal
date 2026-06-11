/**
 * print.ts — چاپ سازگار با وب و اپلیکیشن اندروید (Capacitor)
 *
 * چرا؟ در WebView اندروید (نسخه APK) فراخوانی window.print() هیچ کاری انجام
 * نمی‌دهد؛ به همین دلیل دکمه‌های چاپ در اپ کار نمی‌کردند. مسیرهای چاپ:
 *
 *   1. اپ اندروید + پلاگین Printer  → دیالوگ چاپ واقعی اندروید (با گزینه ذخیره PDF)
 *   2. مرورگر وب                      → چاپ از طریق iframe مخفی
 *   3. هیچ‌کدام در دسترس نبود          → false برمی‌گردد تا caller مسیر جایگزین
 *      (دانلود فایل و…) را ارائه کند.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, { print?: (opts: { content: string; name?: string; orientation?: string }) => Promise<void> }>;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

/** آیا داخل اپلیکیشن نیتیو (APK) هستیم؟ */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function nativePrinter() {
  if (typeof window === "undefined") return null;
  const p = window.Capacitor?.Plugins?.Printer;
  return p && typeof p.print === "function" ? p : null;
}

/** چاپ HTML کامل (شامل <html>...). خروجی: آیا چاپ آغاز شد؟ */
export async function printHtml(html: string, title = "چاپ"): Promise<boolean> {
  // مسیر ۱: پلاگین چاپ نیتیو (نسخه APK جدید)
  if (isNativeApp()) {
    const printer = nativePrinter();
    if (printer) {
      try {
        await printer.print!({ content: html, name: title, orientation: "portrait" });
        return true;
      } catch (e) {
        console.warn("[print] native print failed", e);
      }
    }
    // WebView بدون پلاگین: window.print بی‌اثر است — تلاش نکن.
    return false;
  }

  // مسیر ۲: مرورگر وب — iframe مخفی
  return iframePrint(html);
}

function iframePrint(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", "print-frame");
      Object.assign(iframe.style, {
        position: "fixed",
        right: "0",
        bottom: "0",
        width: "1px",
        height: "1px",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch { /* ignore */ }
        }, 60_000); // پس از بسته‌شدن دیالوگ چاپ، با تاخیر امن حذف می‌شود
      };

      let fired = false;
      const doPrint = () => {
        if (fired) return;
        fired = true;
        // فرصت کوتاه برای بارگذاری فونت/تصاویر داخل iframe
        setTimeout(() => {
          try {
            const win = iframe.contentWindow;
            if (!win || typeof win.print !== "function") throw new Error("no print");
            win.focus();
            win.print();
            cleanup();
            resolve(true);
          } catch (e) {
            console.warn("[print] iframe print failed", e);
            cleanup();
            resolve(fallbackWindowPrint(html));
          }
        }, 350);
      };

      iframe.onload = doPrint;
      iframe.srcdoc = html;
      // اگر onload به هر دلیل اجرا نشد
      setTimeout(doPrint, 2000);
    } catch (e) {
      console.warn("[print] iframe setup failed", e);
      resolve(fallbackWindowPrint(html));
    }
  });
}

function fallbackWindowPrint(html: string): boolean {
  try {
    const win = window.open("", "_blank");
    if (!win) return false;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 400);
    return true;
  } catch {
    return false;
  }
}

/** دانلود یک فایل از Blob — در مرورگر وب */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
