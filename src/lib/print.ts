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
 *
 * دانلود با لینک blob: یا window.open در WebView صفحه را عوض می‌کند و کاربر
 * از برنامه خارج می‌شود — این مسیرها فقط در مرورگر واقعی استفاده می‌شوند.
 */

import { isWebView } from "@/lib/isWebView";

type PrinterPlugin = {
  print?: (opts: { content: string; name?: string; orientation?: string }) => Promise<void>;
};
type FilesystemPlugin = {
  writeFile?: (opts: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<{ uri: string }>;
};
type SharePlugin = {
  share?: (opts: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }) => Promise<unknown>;
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
    __KAMALI_NATIVE_APP?: boolean;
  }
}

/** اندازه کاغذ چاپ فاکتور — با @page و مقیاس خودکار روی یک صفحه جا می‌شود */
export type PaperSize = "A4" | "A5" | "Letter";

export const PAPER_SIZES: { id: PaperSize; label: string; wMm: number; hMm: number }[] = [
  { id: "A4", label: "A4 — ۲۱۰×۲۹۷ میلی‌متر", wMm: 210, hMm: 297 },
  { id: "A5", label: "A5 — ۱۴۸×۲۱۰ میلی‌متر", wMm: 148, hMm: 210 },
  { id: "Letter", label: "Letter — ۲۱۶×۲۷۹ میلی‌متر", wMm: 215.9, hMm: 279.4 },
];

export function normalizePaperSize(v?: string | null): PaperSize {
  if (v === "A5" || v === "Letter" || v === "A4") return v;
  return "A4";
}

/** CSS اندازه صفحه + اسکریپت مقیاس تا کل فاکتور در یک برگه جا شود */
export function printFitAssets(paper: PaperSize, marginMm = 7): { css: string; script: string } {
  const spec = PAPER_SIZES.find((p) => p.id === paper) ?? PAPER_SIZES[0];
  const cssSize = paper === "Letter" ? "letter" : paper;
  const css = `
  @page { size: ${cssSize} portrait; margin: ${marginMm}mm; }
  html, body { margin: 0 !important; }
  #print-root { width: 100%; }
  @media print {
    body { padding: 0 !important; background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root { box-shadow: none !important; }
  }
  `;
  const script = `<script>
(function(){
  var PAGE_W = ${spec.wMm};
  var PAGE_H = ${spec.hMm};
  var MARGIN = ${marginMm};
  function fit(){
    var root = document.getElementById('print-root');
    if (!root) return;
    root.style.zoom = '1';
    root.style.transform = 'none';
    var availW = (PAGE_W - MARGIN * 2) * 96 / 25.4;
    var availH = (PAGE_H - MARGIN * 2) * 96 / 25.4;
    var w = Math.max(root.scrollWidth, root.offsetWidth);
    var h = Math.max(root.scrollHeight, root.offsetHeight);
    var s = Math.min(1, availW / Math.max(1, w), availH / Math.max(1, h));
    if (s < 0.995) {
      s = Math.max(0.42, s);
      if ('zoom' in root.style) root.style.zoom = String(s);
      else {
        root.style.transformOrigin = 'top center';
        root.style.transform = 'scale(' + s + ')';
      }
    }
  }
  window.addEventListener('load', fit);
  window.addEventListener('beforeprint', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(function(){});
  setTimeout(fit, 250);
  setTimeout(fit, 700);
})();
</script>`;
  return { css, script };
}

/** آیا داخل اپلیکیشن نیتیو (APK) هستیم؟ */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.__KAMALI_NATIVE_APP) return true;
    return !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** WebView اپ یا Capacitor — اینجا blob/window.open صفحه را خراب می‌کند */
export function isAppShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (isNativeApp() || isWebView()) return true;
    const ua = navigator.userAgent || "";
    // WebView سیستمی اندروید — لینک دانلود صفحه را عوض می‌کند
    if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return true;
    return false;
  } catch {
    return isNativeApp();
  }
}

function nativePlugins() {
  if (typeof window === "undefined") return undefined;
  return window.Capacitor?.Plugins;
}

function nativePrinter() {
  const p = nativePlugins()?.Printer;
  return p && typeof p.print === "function" ? p : null;
}

/** آیا پل نیتیو برای نوشتن فایل و اشتراک وجود دارد؟ */
export function canNativeFileShare(): boolean {
  const plugins = nativePlugins();
  return !!(plugins?.Filesystem?.writeFile && plugins?.Share?.share);
}

let printInFlight = false;

/** چاپ HTML کامل (شامل <html>...). خروجی: آیا چاپ آغاز شد؟ */
export async function printHtml(html: string, title = "چاپ"): Promise<boolean> {
  if (printInFlight) return true;
  printInFlight = true;
  try {
    const printer = nativePrinter();
    if (printer) {
      try {
        await printer.print!({ content: html, name: title, orientation: "portrait" });
        return true;
      } catch (e) {
        console.warn("[print] native print failed", e);
      }
    }

    // در پوسته اپ، window.open صفحه WebView را عوض می‌کند — فقط iframe.
    if (isAppShell()) {
      return await iframePrint(html, { allowWindowFallback: false });
    }

    return await iframePrint(html, { allowWindowFallback: true });
  } finally {
    printInFlight = false;
  }
}

function inferIframeSize(html: string): { width: string; height: string } {
  if (/size:\s*80mm/i.test(html)) return { width: "80mm", height: "240mm" };
  if (/size:\s*A5/i.test(html)) return { width: "148mm", height: "210mm" };
  if (/size:\s*letter/i.test(html)) return { width: "215.9mm", height: "279.4mm" };
  return { width: "210mm", height: "297mm" };
}

function iframePrint(html: string, opts: { allowWindowFallback: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", "print-frame");
      const size = inferIframeSize(html);
      Object.assign(iframe.style, {
        position: "fixed",
        right: "0",
        bottom: "0",
        width: size.width,
        height: size.height,
        border: "0",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "-1",
      });
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            /* ignore */
          }
        }, 60_000); // پس از بسته‌شدن دیالوگ چاپ، با تاخیر امن حذف می‌شود
      };

      let fired = false;
      const doPrint = () => {
        if (fired) return;
        fired = true;
        // فونت از گوگل لود نمی‌شود؛ کمی صبر برای layout کافی است
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
            if (opts.allowWindowFallback) resolve(fallbackWindowPrint(html));
            else resolve(false);
          }
        }, 220);
      };

      iframe.onload = doPrint;
      iframe.srcdoc = html;
      // اگر onload به هر دلیل اجرا نشد
      setTimeout(doPrint, 1200);
    } catch (e) {
      console.warn("[print] iframe setup failed", e);
      if (opts.allowWindowFallback) resolve(fallbackWindowPrint(html));
      else resolve(false);
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
    setTimeout(() => {
      try {
        win.print();
      } catch {
        /* ignore */
      }
    }, 280);
    return true;
  } catch {
    return false;
  }
}

/** دانلود یک فایل از Blob — فقط مرورگر وب. در اپ/WebView هرگز صدا زده نشود. */
export function downloadBlob(blob: Blob, filename: string): boolean {
  if (typeof document === "undefined") return false;
  if (isAppShell()) {
    console.warn("[print] skip blob download inside app webview");
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
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
  const plugins = nativePlugins();
  const fs = plugins?.Filesystem;
  const share = plugins?.Share;

  // اول پل نیتیو — هم Capacitor و هم WebViewای که پلاگین دارد
  if (fs?.writeFile) {
    try {
      const res = await fs.writeFile({ path: filename, data, directory: "CACHE" });
      if (share?.share) {
        await share
          .share({
            title: filename,
            files: [res.uri],
            dialogTitle: "ذخیره در گالری یا ارسال",
          })
          .catch(() => {
            /* کاربر پنجره را بست — فایل نوشته شده است */
          });
      }
      return true;
    } catch (e) {
      console.warn("[print] native save failed", e);
    }
  }

  // داخل اپ بدون پلاگین: لینک دانلود WebView را می‌بندد — انجام نده
  if (isAppShell()) return false;

  // وب: تبدیل base64 به Blob و دانلود معمولی
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return downloadBlob(new Blob([bytes], { type: mime }), filename);
  } catch {
    return false;
  }
}

/** چند فایل (مثلاً صفحات فاکتور) را یکجا در اپ به اشتراک بگذار */
export async function saveBase64Files(
  files: { base64: string; filename: string; mime: string }[],
): Promise<boolean> {
  if (!files.length) return false;
  if (files.length === 1) {
    return saveBase64File(files[0].base64, files[0].filename, files[0].mime);
  }
  const plugins = nativePlugins();
  const fs = plugins?.Filesystem;
  const share = plugins?.Share;
  if (fs?.writeFile && share?.share) {
    try {
      const uris: string[] = [];
      for (const f of files) {
        const data = f.base64.includes(",") ? f.base64.split(",")[1] : f.base64;
        const res = await fs.writeFile({ path: f.filename, data, directory: "CACHE" });
        if (res?.uri) uris.push(res.uri);
      }
      if (uris.length) {
        await share
          .share({
            title: files[0].filename,
            files: uris,
            dialogTitle: "ذخیره در گالری یا ارسال",
          })
          .catch(() => {});
        return true;
      }
    } catch (e) {
      console.warn("[print] native multi-save failed", e);
    }
  }
  return saveBase64File(files[0].base64, files[0].filename, files[0].mime);
}

/** ذخیره PDF ساخته‌شده با jsPDF — وب: دانلود، اپ: ذخیره + اشتراک */
export async function savePdf(
  pdf: { output: (type: "datauristring") => string },
  filename: string,
): Promise<boolean> {
  return saveBase64File(pdf.output("datauristring"), filename, "application/pdf");
}

/** پیام استاندارد وقتی ذخیره/چاپ در نسخه قدیمی اپ ممکن نیست */
export const OLD_APP_MESSAGE =
  "این قابلیت در نسخه قدیمی اپلیکیشن در دسترس نیست — لطفاً نسخه جدید APK را از سایت دانلود و نصب کنید.";
