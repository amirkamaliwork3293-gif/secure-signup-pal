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
  return !SELF_VERIFYING_OUTPUT_FORMATS.has(normalizeOutputFormat(outputFormat));
}

/**
 * نام فرمت BarcodeDetector بومی (`ean_13`) با خروجی zxing (`EAN13`) یکی نیست.
 * بدون این نگاشت، EAN/CODE-128 بومی اشتباهاً «نیاز به تأیید دوم» می‌گرفت.
 */
const FORMAT_ALIASES: Record<string, string> = {
  ean_13: "EAN13",
  ean13: "EAN13",
  ean_8: "EAN8",
  ean8: "EAN8",
  upc_a: "UPCA",
  upca: "UPCA",
  upc_e: "UPCE",
  upce: "UPCE",
  code_128: "Code128",
  code128: "Code128",
  code_39: "Code39",
  code39: "Code39",
  itf: "ITF",
  interleaved2of5: "ITF",
  qr_code: "QRCode",
  qrcode: "QRCode",
  data_matrix: "DataMatrix",
  datamatrix: "DataMatrix",
  pdf_417: "PDF417",
  pdf417: "PDF417",
  aztec: "Aztec",
  codabar: "Codabar",
};

export function normalizeOutputFormat(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const key = s.toLowerCase().replace(/-/g, "_");
  return FORMAT_ALIASES[key] ?? s;
}

/** فرمت‌هایی که به سازندهٔ BarcodeDetector بومی می‌دهیم (نام استاندارد وب). */
export const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "qr_code",
  "code_39",
  "itf",
  "data_matrix",
] as const;

export const CORE_NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "qr_code",
  "code_39",
] as const;
