/**
 * zxing.worker.ts — دیکود بارکد خارج از ترد اصلی
 *
 * دو ورودی سازگار:
 *   1) ImageBitmap transferable + OffscreenCanvas (کروم جدید)
 *   2) RGBA ArrayBuffer از canvas ترد اصلی — WebView قدیمی بدون OffscreenCanvas
 * خروجی: { id, text: string | null }
 */
import { decodeRgba } from "./zxing-decode";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  }
  if (!ctx) throw new Error("no-2d");
  return ctx;
}

type DecodeRequest = {
  id: number;
  extra?: boolean;
  bitmap?: ImageBitmap;
  width?: number;
  height?: number;
  buffer?: ArrayBuffer;
};

function decodeBitmap(bitmap: ImageBitmap, extra: boolean): string | null {
  const width = bitmap.width | 0;
  const height = bitmap.height | 0;
  if (width < 8 || height < 8) return null;
  const c = ensureCanvas(width, height);
  c.drawImage(bitmap, 0, 0, width, height);
  const imageData = c.getImageData(0, 0, width, height);
  return decodeRgba(imageData.data, width, height, extra);
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, bitmap, extra, width, height, buffer } = e.data;
  let text: string | null = null;
  try {
    if (buffer && width && height) {
      text = decodeRgba(new Uint8ClampedArray(buffer), width, height, !!extra);
    } else if (bitmap) {
      text = decodeBitmap(bitmap, !!extra);
    }
  } catch {
    text = null;
  } finally {
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        /* already transferred / closed */
      }
    }
    (self as unknown as Worker).postMessage({ id, text });
  }
};
