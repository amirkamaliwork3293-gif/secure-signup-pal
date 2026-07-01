/**
 * فشرده‌سازی تصویر پیش از آپلود — کاهش حجم مصرفی ذخیره‌سازی و ترافیک.
 * - حداکثر ابعاد: 1280 پیکسل در بزرگ‌ترین ضلع
 * - خروجی: JPEG با کیفیت ۰٫۸ (در صورت پشتیبانی مرورگر)
 * - اگر خروجی از ورودی سنگین‌تر شد یا مرورگر پشتیبانی نکرد، همان فایل اصلی برگردانده می‌شود.
 */
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number; maxBytes?: number } = {},
): Promise<File> {
  const maxDim = opts.maxDim ?? 1280;
  const quality = opts.quality ?? 0.8;
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024; // سقف نهایی ۳ مگابایت

  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    if (!blob) return file;
    if (blob.size >= file.size && file.size <= maxBytes) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** بررسی سقف حجم فایل ورودی (قبل از فشرده‌سازی). خطا با پیام فارسی پرتاب می‌کند. */
export function assertMaxFileSize(file: File, maxMB = 10): void {
  if (file.size > maxMB * 1024 * 1024) {
    throw new Error(`حجم فایل بیش از حد مجاز است (حداکثر ${maxMB} مگابایت).`);
  }
}