/**
 * frame-source.ts — بریدن کادر اسکن از فریم ویدیو.
 *
 * `createImageBitmap(video, crop)` روی چند سامسونگ (از جمله A55) **throw نمی‌کند**
 * ولی بیت‌مپ سیاه/شفاف می‌دهد. پیش‌نمایش زنده می‌ماند چون Surface جداگانه است.
 * نسخهٔ قبل فقط در صورت throw به canvas می‌رفت؛ اینجا:
 *
 *   1. canvas.drawImage(video) + getImageData     ← مسیر پیش‌فرض، سازگارترین
 *   2. ImageCapture.grabFrame() از خودِ تراک      ← وقتی کپی ویدیو سیاه است
 *
 * فریم یکنواخت (واریانس نزدیک صفر) مسیر را عوض می‌کند، نه throw.
 */
import { coverMappedRect, fitDecodeSize, type ScanRect } from "./geometry";
import { isBlankRgba } from "./pixels";

export type FrameGrab =
  | { kind: "bitmap"; bitmap: ImageBitmap }
  | { kind: "pixels"; data: Uint8ClampedArray; width: number; height: number };

type ImageCaptureLike = { grabFrame: () => Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const BLANK_SWITCH_AFTER = 3;

export class FrameSource {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private capture: ImageCaptureLike | null = null;
  private captureTrack: MediaStreamTrack | null = null;
  private captureFailed = false;
  private preferCapture = false;
  private blankStreak = 0;

  async grab(
    video: HTMLVideoElement,
    rect: ScanRect,
    _wantBitmap: boolean,
  ): Promise<FrameGrab | null> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const src = coverMappedRect(vw, vh, video.clientWidth, video.clientHeight, rect);
    const fit = fitDecodeSize(src.sw, src.sh);

    if (this.preferCapture && !this.captureFailed) {
      const fromTrack = await this.grabViaImageCapture(video, src, fit);
      if (fromTrack && !isBlankGrab(fromTrack)) {
        this.blankStreak = 0;
        return fromTrack;
      }
      if (fromTrack) this.noteBlank();
    }

    const fromVideo = this.grabPixels(video, src, fit);
    if (fromVideo && !isBlankGrab(fromVideo)) {
      this.blankStreak = 0;
      return fromVideo;
    }
    if (fromVideo) this.noteBlank();

    if (!this.preferCapture && !this.captureFailed) {
      const fromTrack = await this.grabViaImageCapture(video, src, fit);
      if (fromTrack && !isBlankGrab(fromTrack)) {
        this.preferCapture = true;
        this.blankStreak = 0;
        return fromTrack;
      }
    }

    return fromVideo;
  }

  private noteBlank(): void {
    this.blankStreak += 1;
    if (this.blankStreak >= BLANK_SWITCH_AFTER && !this.captureFailed) {
      this.preferCapture = true;
    }
  }

  private async grabViaImageCapture(
    video: HTMLVideoElement,
    src: { sx: number; sy: number; sw: number; sh: number },
    fit: { dw: number; dh: number },
  ): Promise<FrameGrab | null> {
    const cap = this.ensureCapture(video);
    if (!cap) return null;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await cap.grabFrame();
      const ctx = this.ensureCanvas(fit.dw, fit.dh);
      if (!ctx || !bitmap.width || !bitmap.height) return null;
      const sx = (src.sx / Math.max(1, video.videoWidth)) * bitmap.width;
      const sy = (src.sy / Math.max(1, video.videoHeight)) * bitmap.height;
      const sw = (src.sw / Math.max(1, video.videoWidth)) * bitmap.width;
      const sh = (src.sh / Math.max(1, video.videoHeight)) * bitmap.height;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, fit.dw, fit.dh);
      const img = ctx.getImageData(0, 0, fit.dw, fit.dh);
      return { kind: "pixels", data: img.data, width: fit.dw, height: fit.dh };
    } catch {
      this.captureFailed = true;
      this.capture = null;
      return null;
    } finally {
      if (bitmap) {
        try {
          bitmap.close();
        } catch {
          /* ignore */
        }
      }
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

  private ensureCapture(video: HTMLVideoElement): ImageCaptureLike | null {
    if (this.captureFailed) return null;
    const track = trackFromVideo(video);
    if (!track) return null;
    if (this.capture && this.captureTrack === track) return this.capture;
    const Ctor = imageCaptureCtor();
    if (!Ctor) {
      this.captureFailed = true;
      return null;
    }
    try {
      this.capture = new Ctor(track);
      this.captureTrack = track;
      return this.capture;
    } catch {
      this.captureFailed = true;
      this.capture = null;
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
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
    this.capture = null;
    this.captureTrack = null;
  }
}

function trackFromVideo(video: HTMLVideoElement): MediaStreamTrack | null {
  const src = video.srcObject;
  if (src instanceof MediaStream) return src.getVideoTracks()[0] ?? null;
  return null;
}

function imageCaptureCtor(): ImageCaptureCtor | null {
  const g = globalThis as unknown as { ImageCapture?: ImageCaptureCtor };
  return typeof g.ImageCapture === "function" ? g.ImageCapture : null;
}

function isBlankGrab(grab: FrameGrab): boolean {
  return grab.kind === "pixels" ? isBlankRgba(grab.data) : false;
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
