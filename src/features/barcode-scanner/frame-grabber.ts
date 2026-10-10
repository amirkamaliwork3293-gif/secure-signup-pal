/**
 * frame-grabber.ts — برش یک ناحیه از فریم زندهٔ دوربین به پیکسل خام RGBA.
 *
 * مسیر عادی: `drawImage(video)` روی canvas و `getImageData`.
 *
 * دام شناخته‌شده: روی بعضی گوشی‌های سامسونگ کپی ویدیو روی canvas ابعاد درست
 * ولی پیکسل‌های صفر (سیاه) می‌دهد، در حالی که پیش‌نمایش زنده است. پس هر فریم
 * سریع نمونه‌برداری می‌شود؛ بعد از BLANK_STREAK فریم یکنواخت پیاپی، منبع به
 * `ImageCapture.grabFrame()` (مستقیم از تراک دوربین) تغییر می‌کند.
 */
import type { CropPlan } from "./geometry";
import type { Pixels } from "./engines/zxing-core";

const BLANK_STREAK = 3;

/** واریانس روشنایی نمونه‌ای از پیکسل‌ها. نزدیک صفر یعنی فریم یکنواخت (سیاه/سفید کامل). */
export function sampledLumaVariance(data: Uint8ClampedArray, samples = 256): number {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  const step = Math.max(1, Math.floor(pixels / samples));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels; i += step) {
    const o = i * 4;
    const y = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
    sum += y;
    sumSq += y * y;
    n++;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function isBlankFrame(data: Uint8ClampedArray): boolean {
  return sampledLumaVariance(data) < 1.5;
}

type ImageCaptureLike = { grabFrame(): Promise<ImageBitmap> };

export class FrameGrabber {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private blankStreak = 0;
  private capture: ImageCaptureLike | null = null;
  private useCapture = false;

  constructor(private readonly track: MediaStreamTrack | null) {}

  get source(): "video" | "track" {
    return this.useCapture ? "track" : "video";
  }

  private context(width: number, height: number) {
    if (!this.canvas) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true, alpha: false }) as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    return this.ctx;
  }

  private draw(image: CanvasImageSource, plan: CropPlan): Pixels | null {
    const { source, output } = plan;
    const ctx = this.context(output.width, output.height);
    if (!ctx) return null;
    // درون‌یابی برای کوچک‌سازی نرم است و برای بزرگ‌نمایی (پاس micro) لبه‌ها را
    // صاف نگه می‌دارد؛ هر دو برای باینری‌سازی zxing بهتر از nearest-neighbor‌اند.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      output.width,
      output.height,
    );
    const img = ctx.getImageData(0, 0, output.width, output.height);
    return { data: img.data, width: img.width, height: img.height };
  }

  /** یک برش از فریم فعلی. null یعنی این فریم قابل استفاده نیست. */
  async grab(video: HTMLVideoElement, plan: CropPlan): Promise<Pixels | null> {
    if (this.useCapture && this.capture) {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await this.capture.grabFrame();
        return this.draw(bitmap, plan);
      } catch {
        // grabFrame شکست خورد؛ برگشت به مسیر ویدیو.
        this.useCapture = false;
        return null;
      } finally {
        bitmap?.close();
      }
    }

    let px: Pixels | null;
    try {
      px = this.draw(video, plan);
    } catch {
      return null;
    }
    if (!px) return null;

    if (isBlankFrame(px.data)) {
      this.blankStreak += 1;
      if (this.blankStreak >= BLANK_STREAK) this.tryEnableCapture();
      return null;
    }
    this.blankStreak = 0;
    return px;
  }

  private tryEnableCapture(): void {
    this.blankStreak = 0;
    if (this.capture || !this.track) {
      if (this.capture) this.useCapture = true;
      return;
    }
    const Ctor = (
      globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }
    ).ImageCapture;
    if (typeof Ctor !== "function") return;
    try {
      this.capture = new Ctor(this.track);
      this.useCapture = true;
    } catch {
      this.capture = null;
    }
  }

  dispose(): void {
    this.capture = null;
    this.ctx = null;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
  }
}
