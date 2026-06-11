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

type PrinterPlugin = {
  print?: (opts: { content: string; name?: string; orientation?: string }) => Promise<void>;
};
type FilesystemPlugin = {
  writeFile?: (opts: { path: string; data: string; directory: string; recursive?: boolean }) => Promise<{ uri: string }>;
};
type SharePlugin = {
  share?: (opts: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }) => Promise<unknown>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    Printer?: PrinterPlugin;
    Filesystem?: FilesystemPlugin;
    Share?: SharePlugin;
  } & Record<string, unknown>;
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

// ─── ذخیره فایل (وب + اپ اندروید) ───────────────────────────────────────────
// در WebView اندروید، کلیک روی لینک blob دانلود را آغاز نمی‌کند. به‌جای آن
// فایل با پلاگین Filesystem در حافظه نوشته و با Share سیستمی باز می‌شود تا
// کاربر آن را ذخیره کند یا بفرستد (واتساپ، فایل‌ها و…).

/**
 * ذخیره فایل از روی data-URL یا رشته base64.
 * وب: دانلود مستقیم — اپ اندروید: نوشتن فایل + پنجره اشتراک/ذخیره.
 */
export async function saveBase64File(
  base64: string,
  filename: string,
  mime: string,
): Promise<boolean> {
  const data = base64.includes(",") ? base64.split(",")[1] : base64;

  if (isNativeApp()) {
    const plugins = window.Capacitor?.Plugins;
    const fs = plugins?.Filesystem;
    const share = plugins?.Share;
    if (fs?.writeFile) {
      try {
        const res = await fs.writeFile({ path: filename, data, directory: "CACHE" });
        if (share?.share) {
          await share.share({
            title: filename,
            files: [res.uri],
            dialogTitle: "ذخیره یا ارسال فایل",
          }).catch(() => { /* کاربر پنجره را بست — فایل نوشته شده است */ });
        }
        return true;
      } catch (e) {
        console.warn("[print] native save failed", e);
      }
    }
    return false;
  }

  // وب: تبدیل base64 به Blob و دانلود معمولی
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: mime }), filename);
    return true;
  } catch {
    return false;
  }
}

/** ذخیره PDF ساخته‌شده با jsPDF — وب: دانلود، اپ: ذخیره + اشتراک */
export async function savePdf(pdf: { output: (type: "datauristring") => string }, filename: string): Promise<boolean> {
  return saveBase64File(pdf.output("datauristring"), filename, "application/pdf");
}

/** پیام استاندارد وقتی ذخیره/چاپ در نسخه قدیمی اپ ممکن نیست */
export const OLD_APP_MESSAGE =
  "این قابلیت در نسخه قدیمی اپلیکیشن در دسترس نیست — لطفاً نسخه جدید APK را از سایت دانلود و نصب کنید.";
