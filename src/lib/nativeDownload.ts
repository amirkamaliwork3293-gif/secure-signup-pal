/**
 * ذخیره یا اشتراک فایل — یک مسیر برای وب و اپ اندروید Capacitor.
 *
 * اپ این پروژه سایت زنده را داخل WebView بارگذاری می‌کند؛ پلاگین‌های نیتیو
 * (`Filesystem` / `Share`) از طریق `window.Capacitor.Plugins` تزریق می‌شوند
 * (همان مسیری که `shareText` و ذخیره PDF فاکتور از قبل از آن استفاده می‌کنند).
 * import مستقیم `@capacitor/filesystem` در باندل وب ممکن نیست چون آن بسته‌ها
 * فقط در workflow ساخت APK نصب می‌شوند، نه در وابستگی‌های سایت.
 *
 * اندروید: نوشتن در `Directory.Cache` (بدون مجوز storage) + Share Sheet
 * تا کاربر خودش «ذخیره در فایل‌ها / Downloads» یا ارسال را انتخاب کند.
 * مرورگر: همان دانلود مستقیم `<a download>` که از قبل کار می‌کرد.
 */
import { isCapacitor } from "@/lib/isWebView";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type NativeFs = {
  writeFile: (opts: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<{ uri: string }>;
};

type NativeShare = {
  share: (opts: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }) => Promise<unknown>;
};

function nativeFilePlugins(): { fs: NativeFs; share: NativeShare } | null {
  if (typeof window === "undefined") return null;
  const plugins = (
    window as unknown as {
      Capacitor?: { Plugins?: { Filesystem?: NativeFs; Share?: NativeShare } };
    }
  ).Capacitor?.Plugins;
  const fs = plugins?.Filesystem;
  const share = plugins?.Share;
  if (fs && typeof fs.writeFile === "function" && share && typeof share.share === "function") {
    return { fs, share };
  }
  return null;
}

function stripDataUrlPrefix(base64: string): string {
  const comma = base64.indexOf(",");
  return comma >= 0 ? base64.slice(comma + 1) : base64;
}

/** UTF-8 → base64 (پشتیبانی از فارسی). معادل Blob متنی قبلی. */
export function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function downloadInBrowser(base64Data: string, filename: string, mimeType: string): void {
  const byteChars = atob(base64Data);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function writeCacheAndShare(
  native: { fs: NativeFs; share: NativeShare },
  files: { filename: string; base64Data: string }[],
): Promise<void> {
  const uris: string[] = [];
  for (const f of files) {
    const write = await native.fs.writeFile({
      path: f.filename,
      data: f.base64Data,
      directory: "CACHE",
    });
    if (write?.uri) uris.push(write.uri);
  }
  if (!uris.length) throw new Error("native-write-empty");
  try {
    await native.share.share({
      title: files[0]?.filename,
      url: uris[0],
      files: uris,
      dialogTitle: "ذخیره یا ارسال فایل",
    });
  } catch {
    /* کاربر شیت را بست — فایل در Cache نوشته شده است */
  }
}

/**
 * ذخیره فایل از روی رشته base64 (بدون یا با پیشوند data:...;base64,).
 * وب: دانلود مستقیم. اپ Capacitor: Cache + Share. هرگز لینک blob را
 * داخل WebView اپ باز نمی‌کند (آن مسیر کاربر را از برنامه بیرون می‌اندازد).
 */
export async function saveOrShareFile(opts: {
  filename: string;
  mimeType: string;
  base64Data: string;
}): Promise<void> {
  const base64Data = stripDataUrlPrefix(opts.base64Data);
  const native = nativeFilePlugins();

  if (native) {
    await writeCacheAndShare(native, [{ filename: opts.filename, base64Data }]);
    return;
  }

  if (isCapacitor()) {
    throw new Error("native-save-unavailable");
  }

  downloadInBrowser(base64Data, opts.filename, opts.mimeType);
}

/** چند فایل را یکجا بنویس و در اپ با یک Share Sheet باز کن. */
export async function saveOrShareFiles(
  files: { filename: string; mimeType: string; base64Data: string }[],
): Promise<void> {
  if (!files.length) return;
  if (files.length === 1) {
    await saveOrShareFile(files[0]);
    return;
  }

  const native = nativeFilePlugins();
  if (native) {
    await writeCacheAndShare(
      native,
      files.map((f) => ({
        filename: f.filename,
        base64Data: stripDataUrlPrefix(f.base64Data),
      })),
    );
    return;
  }

  if (isCapacitor()) {
    throw new Error("native-save-unavailable");
  }

  await saveOrShareFile(files[0]);
}
