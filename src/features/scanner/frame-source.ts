/**
 * frame-source.ts — بریدن کادر اسکن از فریم ویدیو.
 *
 * دو مسیر، و انتخاب بین‌شان **یک بار** انجام می‌شود نه در هر فریم:
 *
 *   createImageBitmap(video, crop) → transfer به Worker   ← مسیر سریع، بدون کپی
 *   canvas + getImageData → بافر RGBA                     ← WebView بدون ImageBitmap
 *
 * اگر اندازهٔ منبع زیر سقف بودجه باشد، عمداً resample نمی‌کنیم: کوچک‌کردن،
 * میله‌های باریک بارکد کوچک را از بین می‌برد.
 */
import { cropSourceRect, fitDecodeSize, type ScanRect } from "./geometry";

export type FrameGrab =
  | { kind: "bitmap"; bitmap: ImageBitmap }
  | { kind: "pixels"; data: Uint8ClampedArray; width: number; height: number };

export class FrameSource {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** قابلیت مرورگر؛ اولین throw آن را برای همیشه خاموش می‌کند. */
  private bitmapSupported = typeof createImageBitmap === "function";

  /**
   * `wantBitmap` را دیکودر در هر فریم تعیین می‌کند — فقط Worker با OffscreenCanvas
   * از ImageBitmap سود می‌برد، و اگر دیکودر وسط کار به ترد اصلی تنزل کند این
   * پرچم خودش عوض می‌شود.
   */
  async grab(
    video: HTMLVideoElement,
    rect: ScanRect,
    wantBitmap: boolean,
  ): Promise<FrameGrab | null> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const src = cropSourceRect(vw, vh, rect);
    const fit = fitDecodeSize(src.sw, src.sh);

    if (wantBitmap && this.bitmapSupported) {
      const bitmap = await this.grabBitmap(video, src, fit);
      if (bitmap) return { kind: "bitmap", bitmap };
      // throw یعنی این ورودی پشتیبانی نمی‌شود، نه کندی — یک بار خاموش و تمام.
      this.bitmapSupported = false;
    }

    return this.grabPixels(video, src, fit);
  }

  private async grabBitmap(
    video: HTMLVideoElement,
    src: { sx: number; sy: number; sw: number; sh: number },
    fit: { dw: number; dh: number },
  ): Promise<ImageBitmap | null> {
    const needsResize = fit.dw !== src.sw || fit.dh !== src.sh;
    try {
      if (!needsResize) {
        return await createImageBitmap(video, src.sx, src.sy, src.sw, src.sh);
      }
      return await createImageBitmap(video, src.sx, src.sy, src.sw, src.sh, {
        resizeWidth: fit.dw,
        resizeHeight: fit.dh,
        resizeQuality: "high",
      });
    } catch {
      return null;
    }
  }

  private grabPixels(
    video: HTMLVideoElement,
    src: { sx: number; sy: number; sw: number; sh: number },
    fit: { dw: number; dh: number },
  ): FrameGrab | null {
    const ctx = this.ensureCanvas(fit.dw, fit.dh);
    if (!ctx) return null;
    try {
      ctx.drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, fit.dw, fit.dh);
      const img = ctx.getImageData(0, 0, fit.dw, fit.dh);
      return { kind: "pixels", data: img.data, width: fit.dw, height: fit.dh };
    } catch {
      return null;
    }
  }

  private ensureCanvas(w: number, h: number): CanvasRenderingContext2D | null {
    if (typeof document === "undefined") return null;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true, alpha: false });
    }
    if (!this.canvas || !this.ctx) return null;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    return this.ctx;
  }

  dispose(): void {
    // کانواس صفر در صفر، حافظهٔ بافر را همان‌جا آزاد می‌کند.
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

/** بستن امنِ ImageBitmap — فریمی که دور انداخته می‌شود نباید حافظه نگه دارد. */
export function closeGrab(grab: FrameGrab | null): void {
  if (grab?.kind === "bitmap") {
    try {
      grab.bitmap.close();
    } catch {
      /* از قبل بسته یا transfer شده */
    }
  }
}
