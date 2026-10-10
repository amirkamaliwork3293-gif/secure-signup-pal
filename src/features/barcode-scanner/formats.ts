/**
 * formats.ts — یک جدول واحد برای همهٔ فرمت‌های بارکد.
 *
 * دو موتور خواندن داریم (BarcodeDetector بومی و zxing-wasm) که نام فرمت را
 * متفاوت برمی‌گردانند (`ean_13` در برابر `EAN13`). همه اینجا به یک نام کانونی
 * نگاشته می‌شوند تا دروازهٔ پذیرش (`consensus.ts`) فقط یک زبان بفهمد.
 *
 * «قوت» هر فرمت تعیین می‌کند یک خوانش کافی است یا تأیید دوم لازم است:
 *   - strong: رقم کنترلی اجباری یا تصحیح خطای Reed-Solomon دارد.
 *   - weak:   رقم کنترلی ندارد (CODE-39، ITF، Codabar)؛ برش ناقص یا انعکاس نور
 *             می‌تواند متن غلط ولی «معتبر» بسازد، پس دو خوانش یکسان لازم است.
 */

export type CanonicalFormat =
  | "ean13"
  | "ean8"
  | "upca"
  | "upce"
  | "code128"
  | "code93"
  | "code39"
  | "itf"
  | "codabar"
  | "databar"
  | "qr"
  | "datamatrix"
  | "pdf417"
  | "aztec"
  | "unknown";

type FormatInfo = {
  /** نام فرمت در خروجی zxing (`ReadResult.format`). */
  zxing: readonly string[];
  /** نام فرمت در `BarcodeDetector` بومی. */
  native: readonly string[];
  strength: "strong" | "weak";
  /** بارکد خطی (یک‌بعدی) است؟ برای تفسیر `lineCount` در zxing. */
  linear: boolean;
  /** کوتاه‌ترین متن قابل قبول. خوانش کوتاه‌تر تقریباً همیشه نویز است. */
  minLength: number;
  /** برچسب نمایشی کوتاه. */
  label: string;
};

export const FORMATS: Record<Exclude<CanonicalFormat, "unknown">, FormatInfo> = {
  ean13: {
    zxing: ["EAN13", "ISBN"],
    native: ["ean_13"],
    strength: "strong",
    linear: true,
    minLength: 13,
    label: "EAN-13",
  },
  ean8: {
    zxing: ["EAN8"],
    native: ["ean_8"],
    strength: "strong",
    linear: true,
    minLength: 8,
    label: "EAN-8",
  },
  upca: {
    zxing: ["UPCA"],
    native: ["upc_a"],
    strength: "strong",
    linear: true,
    minLength: 12,
    label: "UPC-A",
  },
  upce: {
    zxing: ["UPCE"],
    native: ["upc_e"],
    strength: "strong",
    linear: true,
    minLength: 8,
    label: "UPC-E",
  },
  code128: {
    zxing: ["Code128"],
    native: ["code_128"],
    strength: "strong",
    linear: true,
    minLength: 1,
    label: "Code 128",
  },
  code93: {
    zxing: ["Code93"],
    native: ["code_93"],
    strength: "strong",
    linear: true,
    minLength: 1,
    label: "Code 93",
  },
  code39: {
    zxing: ["Code39", "Code39Std", "Code39Ext", "Code32", "PZN"],
    native: ["code_39"],
    strength: "weak",
    linear: true,
    minLength: 3,
    label: "Code 39",
  },
  itf: {
    zxing: ["ITF", "ITF14"],
    native: ["itf"],
    strength: "weak",
    linear: true,
    minLength: 6,
    label: "ITF",
  },
  codabar: {
    zxing: ["Codabar"],
    native: ["codabar"],
    strength: "weak",
    linear: true,
    minLength: 4,
    label: "Codabar",
  },
  databar: {
    zxing: [
      "DataBar",
      "DataBarOmni",
      "DataBarStk",
      "DataBarStkOmni",
      "DataBarLtd",
      "DataBarExp",
      "DataBarExpStk",
    ],
    native: [],
    strength: "strong",
    linear: true,
    minLength: 1,
    label: "DataBar",
  },
  qr: {
    zxing: ["QRCode", "QRCodeModel1", "QRCodeModel2", "MicroQRCode", "RMQRCode"],
    native: ["qr_code"],
    strength: "strong",
    linear: false,
    minLength: 1,
    label: "QR",
  },
  datamatrix: {
    zxing: ["DataMatrix"],
    native: ["data_matrix"],
    strength: "strong",
    linear: false,
    minLength: 1,
    label: "DataMatrix",
  },
  pdf417: {
    zxing: ["PDF417", "CompactPDF417", "MicroPDF417"],
    native: ["pdf417"],
    strength: "strong",
    linear: false,
    minLength: 1,
    label: "PDF417",
  },
  aztec: {
    zxing: ["Aztec", "AztecCode", "AztecRune"],
    native: ["aztec"],
    strength: "strong",
    linear: false,
    minLength: 1,
    label: "Aztec",
  },
};

/**
 * فرمت‌هایی که از zxing خواسته می‌شوند. «Symbology» ها (مثلاً `EANUPC`) همهٔ
 * زیرشاخه‌ها را پوشش می‌دهند و فهرست کوتاه می‌ماند.
 */
export const ZXING_READ_FORMATS = [
  "EANUPC",
  "Code128",
  "Code93",
  "Code39",
  "ITF",
  "Codabar",
  "DataBar",
  "QRCode",
  "DataMatrix",
  "PDF417",
  "Aztec",
] as const;

/** فرمت‌هایی که از BarcodeDetector بومی خواسته می‌شوند (اشتراک با پشتیبانی دستگاه). */
export const NATIVE_READ_FORMATS: readonly string[] = Object.values(FORMATS).flatMap(
  (f) => f.native,
);

const BY_ZXING = new Map<string, CanonicalFormat>();
const BY_NATIVE = new Map<string, CanonicalFormat>();
for (const [key, info] of Object.entries(FORMATS)) {
  for (const n of info.zxing) BY_ZXING.set(n, key as CanonicalFormat);
  for (const n of info.native) BY_NATIVE.set(n, key as CanonicalFormat);
}

export function fromZxingFormat(name: string): CanonicalFormat {
  return BY_ZXING.get(name) ?? "unknown";
}

export function fromNativeFormat(name: string): CanonicalFormat {
  return BY_NATIVE.get(name) ?? "unknown";
}

export function formatInfo(format: CanonicalFormat): FormatInfo | null {
  return format === "unknown" ? null : FORMATS[format];
}

export function formatLabel(format: CanonicalFormat): string {
  return formatInfo(format)?.label ?? "بارکد";
}

/**
 * رقم کنترلی GTIN (EAN-8، UPC-A، EAN-13، GTIN-14). موتورها خودشان بررسی می‌کنند؛
 * این بررسی دوم ارزان است و جلوی نتیجهٔ خراب از یک موتور معیوب را می‌گیرد.
 */
export function isValidGtin(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  const body = digits.length - 1;
  for (let i = 0; i < body; i++) {
    const d = digits.charCodeAt(body - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(body) - 48;
}

/** بسط UPC-E (۸ رقم) به UPC-A (۱۲ رقم) برای بررسی رقم کنترلی. */
export function expandUpcE(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0];
  const d = upce.slice(1, 7);
  const check = upce[7];
  const last = d[5];
  let body: string;
  if (last <= "2") body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === "3") body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === "4") body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  return `${ns}${body}${check}`;
}

/**
 * آیا این متن برای این فرمت معقول است؟ خوانش‌های نامعقول قبل از رسیدن به
 * دروازهٔ پذیرش دور ریخته می‌شوند.
 */
export function isPlausible(format: CanonicalFormat, text: string): boolean {
  if (!text || text.length > 4096) return false;
  const info = formatInfo(format);
  if (!info) return text.length >= 3;
  if (text.length < info.minLength) return false;
  switch (format) {
    case "ean13":
    case "ean8":
    case "upca":
      return isValidGtin(text);
    case "upce": {
      if (/^\d{12,13}$/.test(text)) return isValidGtin(text);
      const expanded = expandUpcE(text);
      return expanded !== null && isValidGtin(expanded);
    }
    case "itf":
      return /^\d+$/.test(text) && text.length % 2 === 0;
    default:
      return true;
  }
}
