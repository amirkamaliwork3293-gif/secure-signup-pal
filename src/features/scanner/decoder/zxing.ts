/**
 * zxing.ts — صدا زدن خوانندهٔ zxing روی پیکسل خام.
 *
 * این فایل عمداً ماژول wasm را **آماده نمی‌کند**: آماده‌سازی به محیط وابسته است
 * (در مرورگر یک URL از Vite، در تست Node بافر فایل). همین جدایی باعث می‌شود
 * `scripts/test-scanner.ts` بتواند دقیقاً همین تابع پروداکشن را در Node تست کند.
 */
import { readBarcodes } from "zxing-wasm/reader";
import { READER_OPTIONS } from "./options";

/** شکل ورودی، سازگار با `ImageData` مرورگر. */
export type Pixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type DecodedBarcode = {
  text: string;
  /** نام فرمت به شکلی که zxing برمی‌گرداند، مثل `"EAN13"` یا `"Code128"`. */
  format: string;
};

/** کوچک‌تر از این، هیچ بارکدی جا نمی‌شود؛ صدا زدن wasm بی‌فایده است. */
const MIN_SIDE = 16;

export async function decodePixels(px: Pixels): Promise<DecodedBarcode | null> {
  if (px.width < MIN_SIDE || px.height < MIN_SIDE) return null;

  // امضای کتابخانه `ImageData` می‌خواهد، ولی در عمل فقط `data`/`width`/`height`
  // را می‌خواند (مسیر pixmap). `colorSpace` هرگز خوانده نمی‌شود، پس ساختن یک
  // ImageData واقعی فقط یک کپی اضافهٔ بی‌فایده در هر فریم بود.
  const results = await readBarcodes(px as unknown as ImageData, READER_OPTIONS);
  for (const r of results) {
    if (r.isValid && r.text) return { text: r.text, format: r.format };
  }
  return null;
}
