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

/**
 * محدودیت‌های استاندارد آپلود تصویر در کل برنامه — همه‌ی مسیرهای آپلود باید از
 * همین‌ها استفاده کنند تا مصرف Storage و پهنای‌باند (Cached Egress) قابل پیش‌بینی بماند.
 * جزئیات و دلیل انتخاب این اعداد: docs/STORAGE_AND_BANDWIDTH.md
 */
export const IMAGE_LIMITS = {
  /** تصاویر محتوایی: نمونه‌کار، عکس منو، استوری و رسانه‌ی صفحه‌ی معرفی */
  content: { maxDim: 1280, quality: 0.8, maxMB: 3 },
  /** لوگو/آواتار — همیشه کوچک نمایش داده می‌شود، پس ابعاد کوچک‌تر */
  logo: { maxDim: 512, quality: 0.85, maxMB: 1 },
  /** رسید پرداخت — باید متن و مبلغ آن خوانا بماند، پس ابعاد و کیفیت بالاتر */
  receipt: { maxDim: 1600, quality: 0.85, maxMB: 3 },
} as const;

export type ImageKind = keyof typeof IMAGE_LIMITS;

/**
 * cacheControl استاندارد برای آپلود در Supabase Storage (بر حسب ثانیه).
 * - ONE_YEAR: فایل‌هایی که مسیرشان یکتاست و هرگز جایگزین نمی‌شوند (عکس منو،
 *   نمونه‌کار، رسانه‌ی صفحه‌ی معرفی) — کش طولانی هیچ‌وقت بیات نمی‌شود.
 * - ONE_WEEK: فایل‌هایی که روی مسیر ثابت جایگزین می‌شوند (لوگوی فروشگاه)؛
 *   لینک آن‌ها پارامتر ?v=timestamp دارد پس با آپلود جدید کش خودکار می‌شکند.
 */
export const CACHE_ONE_YEAR = 31_536_000;
export const CACHE_ONE_WEEK = 604_800;

/** سقف حجم فایل خامِ ورودی (قبل از فشرده‌سازی) — جلوگیری از آپلود فایل‌های غول‌آسا/ویدیو */
const RAW_INPUT_MAX_MB = 20;

/**
 * آماده‌سازی استاندارد یک تصویر برای آپلود: فشرده‌سازی + اعمال سقف حجم.
 * اگر فایل حتی بعد از فشرده‌سازی از سقف رد شد (مثلاً فرمتی که مرورگر نمی‌تواند
 * پردازش کند مثل HEIC خیلی سنگین) خطای فارسی پرتاب می‌شود تا کالر پیام مناسب بدهد.
 */
export async function prepareImageUpload(file: File, kind: ImageKind): Promise<File> {
  const type = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (type === "image/svg+xml" || ext === "svg" || ext === "svgz") {
    throw new Error("فایل SVG مجاز نیست. لطفاً یک عکس (jpg، png یا webp) انتخاب کنید.");
  }
  const { maxDim, quality, maxMB } = IMAGE_LIMITS[kind];
  assertMaxFileSize(file, RAW_INPUT_MAX_MB);
  const cap = maxMB * 1024 * 1024;

  let out = await compressImage(file, { maxDim, quality, maxBytes: cap });
  if (out.size > cap) {
    // تلاش دوم با ابعاد/کیفیت کمتر — برای عکس‌های خیلی بزرگ گوشی‌های جدید
    out = await compressImage(out, { maxDim: Math.round(maxDim * 0.75), quality: 0.6, maxBytes: cap });
  }
  if (out.size > cap) {
    throw new Error(
      `حجم این فایل حتی پس از فشرده‌سازی بیشتر از ${maxMB} مگابایت است. لطفاً عکس کوچک‌تری انتخاب کنید.`,
    );
  }
  return out;
}