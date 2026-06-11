/**
 * zxing.worker.ts — دیکود بارکد در Web Worker
 *
 * دیکود ZXing سنگین‌ترین کار اسکنر است؛ اجرای آن داخل Worker یعنی ترد اصلی
 * (پیش‌نمایش دوربین و UI) هرگز قفل نمی‌شود و اسکنر حتی روی گوشی‌های ضعیف
 * روان می‌ماند.
 *
 * ورودی:  { id, width, height, lum: Uint8ClampedArray (luminance), thorough }
 * خروجی: { id, text: string | null }
 */
import {
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";

const FAST_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, false],
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.DATA_MATRIX,
    ],
  ],
]);

const THOROUGH_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
      BarcodeFormat.ITF, BarcodeFormat.CODABAR,
      BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
    ],
  ],
]);

const fastReader = new MultiFormatReader();
fastReader.setHints(FAST_HINTS);
const thoroughReader = new MultiFormatReader();
thoroughReader.setHints(THOROUGH_HINTS);

type DecodeRequest = {
  id: number;
  width: number;
  height: number;
  lum: Uint8ClampedArray;
  thorough: boolean;
};

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, width, height, lum, thorough } = e.data;
  let text: string | null = null;
  const reader = thorough ? thoroughReader : fastReader;
  try {
    const src = new RGBLuminanceSource(lum, width, height);
    const bmp = new BinaryBitmap(new HybridBinarizer(src));
    text = reader.decode(bmp).getText();
  } catch {
    text = null;
  } finally {
    reader.reset();
  }
  (self as unknown as Worker).postMessage({ id, text });
};
