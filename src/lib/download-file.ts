// ============================================================
// downloadFile — دانلود امن فایل در مرورگر و WebView اندروید (APK)
// در WebView معمولی، روش معمول URL.createObjectURL + anchor.click()
// کار نمی‌کند چون DownloadListener نیتیو وجود ندارد.
// این تابع چند روش جایگزین را امتحان می‌کند:
//   1) Web Share API با files (روی اندروید مدرن کار می‌کند)
//   2) anchor.click روی blob URL (مرورگر دسکتاپ/موبایل عادی)
//   3) باز کردن data URL در پنجره جدید (fallback نهایی)
// ============================================================

function isAndroidWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Capacitor / wv (Android WebView)
  return /wv\)/.test(ua) || /; wv/.test(ua) || /Capacitor/i.test(ua);
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function downloadFile(
  data: Blob | ArrayBuffer | Uint8Array,
  filename: string,
  mime?: string,
): Promise<void> {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data instanceof Uint8Array ? data : new Uint8Array(data)], {
          type: mime || "application/octet-stream",
        });

  // 1) Web Share API با فایل — بهترین گزینه روی WebView اندروید
  try {
    const navAny = navigator as any;
    if (navAny?.canShare && typeof File !== "undefined") {
      const file = new File([blob], filename, { type: blob.type || mime || "application/octet-stream" });
      if (navAny.canShare({ files: [file] })) {
        await navAny.share({ files: [file], title: filename });
        return;
      }
    }
  } catch {
    /* ادامه به روش بعدی */
  }

  // 2) anchor.click روی blob URL — مرورگرهای عادی
  if (!isAndroidWebView()) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    } catch {
      /* ادامه به fallback */
    }
  }

  // 3) Fallback: data URL در پنجره جدید (در WebView اغلب جواب می‌دهد)
  try {
    const dataUrl = await blobToDataURL(blob);
    const w = window.open(dataUrl, "_blank");
    if (!w) {
      // اگر popup بسته شد، با location مستقیم
      window.location.href = dataUrl;
    }
  } catch (e) {
    alert("ذخیره فایل در این دستگاه پشتیبانی نمی‌شود.");
    throw e;
  }
}