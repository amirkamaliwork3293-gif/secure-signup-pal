/**
 * zxing-core.ts — دیکود پیکسل خام با zxing-wasm. مشترک بین Worker، ترد اصلی و
 * تست Node.
 *
 * عمداً ماژول wasm را آماده نمی‌کند: در مرورگر آدرس فایل از Vite می‌آید
 * (`zxing-wasm-setup.ts`) و در تست Node بافر فایل. همین جدایی باعث می‌شود تست
 * دقیقاً همین تابع پروداکشن را اجرا کند.
 */
import { readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import { fromZxingFormat, ZXING_READ_FORMATS, type CanonicalFormat } from "../formats";
import type { DecodeMode, Point } from "../geometry";

export type { DecodeMode };

/** سازگار با `ImageData` مرورگر؛ در Node یک شیء ساده. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export type ZxingHit = {
  text: string;
  format: CanonicalFormat;
  lineCount: number;
  /** چهار گوشهٔ بارکد در مختصات همین تصویر (بالا-چپ، بالا-راست، پایین-راست، پایین-چپ). */
  corners: Point[];
};

export const READER_OPTIONS: ReaderOptions = {
  formats: [...ZXING_READ_FORMATS],
  /** متن خام. حالت HRI محتوای GS1 را قالب‌بندی می‌کند و کد ذخیره‌شده تطبیق نمی‌خورد. */
  textMode: "Plain",
  /** یک بارکد در هر فریم کافی است و جست‌وجو را کوتاه می‌کند. */
  maxNumberOfSymbols: 1,
  /** پاس سریع؛ نسخه‌های deep پایین‌تر ساخته می‌شوند. */
  tryHarder: false,
  /** بارکد عمودی یا کج. */
  tryRotate: true,
  /**
   * معکوس در پاس جداگانهٔ inverse انجام می‌شود (هم خطی هم دوبعدی را پوشش
   * می‌دهد). روشن بودنش اینجا هزینهٔ هر پاس را دو برابر می‌کرد.
   */
  tryInvert: false,
  /** بارکد بزرگ/نزدیک در تصویر پروضوح. */
  tryDownscale: true,
  /**
   * سخت‌گیر: بارکد خطی باید روی دو خط اسکن یکسان خوانده شود (تأیید درون‌فریمی).
   * نسخهٔ نرم برای فریم تار است؛ نگاه کنید به `DecodeMode` در `geometry.ts`.
   */
  minLineCount: 2,
  /** روشن بودنش CODE-39 بدون رقم کنترلی اختیاری را رد می‌کند. */
  validateOptionalChecksum: false,
  eanAddOnSymbol: "Ignore",
  binarizer: "LocalAverage",
  returnErrors: false,
};

/**
 * پاس deep: خطوط اسکن متراکم برای بارکد تار، ولی بدون چرخش (هزینه نصف می‌شود؛
 * بارکد عمودی را پاس‌های سریع که چرخش دارند می‌خوانند).
 */
const DEEP: Partial<ReaderOptions> = { tryHarder: true, tryRotate: false };
/** پاس نرم: یک خط کافی است؛ `consensus.ts` تأیید دوم می‌خواهد. */
const LENIENT: Partial<ReaderOptions> = { minLineCount: 1 };

const OPTIONS = {
  fast: READER_OPTIONS,
  fastLenient: { ...READER_OPTIONS, ...LENIENT },
  deep: { ...READER_OPTIONS, ...DEEP },
  deepLenient: { ...READER_OPTIONS, ...DEEP, ...LENIENT },
} satisfies Record<string, ReaderOptions>;

export function optionsFor(mode: DecodeMode): ReaderOptions {
  if (mode.deep) return mode.lenient ? OPTIONS.deepLenient : OPTIONS.deep;
  return mode.lenient ? OPTIONS.fastLenient : OPTIONS.fast;
}

const MIN_SIDE = 16;

/** معکوس کردن رنگ RGB در جا (برای پاس inverse). */
export function invertInPlace(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

/**
 * یک برش را دیکود می‌کند. با `invert` پیکسل‌ها **در جا** معکوس می‌شوند؛
 * صداکننده بافر را بعد از این دوباره استفاده نمی‌کند.
 */
export async function decodePixels(px: Pixels, mode: DecodeMode = {}): Promise<ZxingHit | null> {
  const options = optionsFor(mode);
  if (px.width < MIN_SIDE || px.height < MIN_SIDE) return null;
  if (px.data.length < px.width * px.height * 4) return null;
  if (mode.invert) invertInPlace(px.data);
  // کتابخانه فقط data/width/height را می‌خواند؛ ساختن ImageData واقعی یک کپی اضافه است.
  const results = await readBarcodes(px as unknown as ImageData, options);
  for (const r of results) {
    if (!r.isValid || !r.text) continue;
    const p = r.position;
    return {
      text: r.text,
      format: fromZxingFormat(r.format),
      lineCount: r.lineCount,
      corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((c) => ({
        x: c.x,
        y: c.y,
      })),
    };
  }
  return null;
}
