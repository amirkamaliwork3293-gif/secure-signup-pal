/**
 * formats.ts — تنها منبع فهرست فرمت‌های بارکد.
 *
 * دو فهرست جدا لازم است چون نام ورودی و خروجی zxing یکی نیست:
 * ورودی `"EAN-13"` را می‌گیرد و خروجی `"EAN13"` برمی‌گرداند.
 */

/** فرمت‌هایی که به zxing می‌گوییم دنبالشان بگردد (نام ورودی، با خط تیره). */
export const READER_FORMATS = [
  "EAN-13",
  "EAN-8",
  "UPC-A",
  "UPC-E",
  "Code128",
  "Code39",
  "ITF",
  "QRCode",
  "DataMatrix",
] as const;

/**
 * فرمت‌هایی که ساختارشان خودش خوانش را تأیید می‌کند و یک فریم برای پذیرش کافی است:
 * ماتریسی‌ها تصحیح خطای Reed–Solomon دارند و EAN/UPC/CODE-128 رقم کنترلی الزامی.
 *
 * نام‌ها همان چیزی هستند که zxing در خروجی می‌دهد (بدون خط تیره).
 */
const SELF_VERIFYING_OUTPUT_FORMATS = new Set([
  "QRCode",
  "MicroQRCode",
  "rMQRCode",
  "DataMatrix",
  "Aztec",
  "PDF417",
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
  "Code128",
]);

/**
 * آیا این فرمت برای پذیرش به دو خوانش یکسان نیاز دارد؟
 *
 * CODE-39 و ITF رقم کنترلی الزامی ندارند، پس یک خوانش تنها می‌تواند نتیجهٔ
 * برش ناقص یا انعکاس نور باشد. فرمت ناشناس هم محتاطانه تأیید دوم می‌خواهد.
 */
export function needsConfirmation(outputFormat: string): boolean {
  return !SELF_VERIFYING_OUTPUT_FORMATS.has(outputFormat);
}
