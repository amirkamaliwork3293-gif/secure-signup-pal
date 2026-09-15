/**
 * decode.worker.ts — دیکود بارکد خارج از ترد اصلی.
 *
 * پیام `ready` **بعد از** یک دیکود آزمایشی فرستاده می‌شود، نه به‌محض اجرای
 * اسکریپت. یعنی این پیام واقعاً ثابت می‌کند که wasm دانلود و کامپایل شده و
 * دیکود کار می‌کند. اگر نرسید، ترد اصلی به دیکود محلی تنزل می‌کند — یک بار،
 * در شروع، نه با watchdog در هر فریم (که مشکل نسخهٔ قبل بود).
 *
 * همین دیکود آزمایشی، wasm را هم گرم می‌کند تا اولین فریم واقعی کاربر هزینهٔ
 * کامپایل را ندهد.
 */
import { prepareWasm } from "./prepare";
import { decodePixels, type Pixels } from "./zxing";
import type { DecodeRequest, WorkerResponse } from "./protocol";

const ctx = self as unknown as {
  postMessage: (msg: WorkerResponse) => void;
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
};

prepareWasm();

let canvas: OffscreenCanvas | null = null;
let canvas2d: OffscreenCanvasRenderingContext2D | null = null;

function offscreenAvailable(): boolean {
  try {
    return typeof OffscreenCanvas === "function" && !!new OffscreenCanvas(2, 2).getContext("2d");
  } catch {
    return false;
  }
}

function pixelsFromBitmap(bitmap: ImageBitmap): Pixels | null {
  const width = bitmap.width | 0;
  const height = bitmap.height | 0;
  if (width < 1 || height < 1) return null;
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      canvas2d = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
    }
    if (!canvas2d) return null;
    canvas2d.drawImage(bitmap, 0, 0);
    const img = canvas2d.getImageData(0, 0, width, height);
    return { data: img.data, width, height };
  } catch {
    return null;
  }
}

function pixelsFromRequest(req: DecodeRequest): Pixels | null {
  if (req.buffer && req.width && req.height) {
    return { data: new Uint8ClampedArray(req.buffer), width: req.width, height: req.height };
  }
  if (req.bitmap) return pixelsFromBitmap(req.bitmap);
  return null;
}

ctx.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  let text: string | null = null;
  let format: string | null = null;
  try {
    const px = pixelsFromRequest(req);
    if (px) {
      const hit = await decodePixels(px);
      if (hit) {
        text = hit.text;
        format = hit.format;
      }
    }
  } catch {
    // یک فریم خراب نباید Worker را بکشد؛ نتیجهٔ خالی برمی‌گردانیم.
  } finally {
    // ImageBitmap منتقل‌شده مالکیتش اینجاست — بستنش وظیفهٔ همین Worker است.
    if (req.bitmap) {
      try {
        req.bitmap.close();
      } catch {
        /* از قبل بسته */
      }
    }
    ctx.postMessage({ type: "result", id: req.id, text, format });
  }
};

/** گرم‌کردن و اثبات سلامت: یک فریم سفید کوچک که هیچ‌وقت چیزی نمی‌خواند. */
(async () => {
  try {
    const probe: Pixels = {
      data: new Uint8ClampedArray(32 * 32 * 4).fill(255),
      width: 32,
      height: 32,
    };
    await decodePixels(probe);
    ctx.postMessage({ type: "ready", offscreen: offscreenAvailable() });
  } catch (err) {
    ctx.postMessage({ type: "fail", reason: err instanceof Error ? err.message : "wasm" });
  }
})();
