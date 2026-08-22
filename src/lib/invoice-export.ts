/**
 * ذخیره / اشتراک تصویر فاکتور — فقط مسیرهای امن.
 *
 * در WebView اپ، لینک blob و window.open صفحه را می‌بندد. بنابراین:
 *   • اگر پل Capacitor (Filesystem + Share) باشد → فایل JPEG نوشته و شیت اشتراک باز می‌شود
 *     (کاربر می‌تواند «ذخیره در گالری» یا ارسال برای مشتری را انتخاب کند)
 *   • اگر مرورگر واقعی باشد → دانلود JPEG
 *   • اگر اپ بدون پلاگین باشد → unsupported؛ UI تصویر را داخل برنامه نشان می‌دهد
 *     تا با نگه‌داشتن روی تصویر در گالری ذخیره شود — دکمه دانلودی که اپ را می‌بندد اضافه نمی‌شود
 */
import { canNativeFileShare, downloadBlob, isAppShell, saveBase64Files } from "@/lib/print";
import { invoiceDocumentTitle, type Invoice } from "@/lib/store";

export type ImageExportResult = "shared" | "downloaded" | "unsupported" | "error";

export function canSaveInvoiceFile(): boolean {
  return canNativeFileShare() || !isAppShell();
}

function jpegBlobFromDataUrl(dataUrl: string): Blob | null {
  try {
    const data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  } catch {
    return null;
  }
}

export async function exportInvoiceImages(inv: Invoice): Promise<{
  result: ImageExportResult;
  dataUrls: string[];
}> {
  try {
    const { buildInvoiceImageDataUrls } = await import("@/lib/invoice-pdf");
    const dataUrls = await buildInvoiceImageDataUrls(inv);
    if (!dataUrls.length) return { result: "error", dataUrls: [] };

    const title = invoiceDocumentTitle(inv).replace(/\s+/g, "-");
    const files = dataUrls.map((base64, i) => ({
      base64,
      filename: `${title}-${inv.id.toUpperCase()}${dataUrls.length > 1 ? `-${i + 1}` : ""}.jpg`,
      mime: "image/jpeg",
    }));

    if (canNativeFileShare()) {
      const ok = await saveBase64Files(files);
      return { result: ok ? "shared" : "unsupported", dataUrls };
    }

    if (isAppShell()) {
      return { result: "unsupported", dataUrls };
    }

    const blob = jpegBlobFromDataUrl(files[0].base64);
    if (!blob) return { result: "error", dataUrls };
    const ok = downloadBlob(blob, files[0].filename);
    return { result: ok ? "downloaded" : "error", dataUrls };
  } catch (e) {
    console.warn("[invoice-export] image export failed", e);
    return { result: "error", dataUrls: [] };
  }
}
