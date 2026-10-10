/**
 * native.ts — موتور بومی `BarcodeDetector` (ML Kit روی اندروید، Vision روی macOS).
 *
 * چرا در کنار zxing: روی اندروید از شتاب سخت‌افزاری استفاده می‌کند، فریم را
 * مستقیم از پایپ‌لاین دوربین می‌خواند (به کپی canvas وابسته نیست؛ روی بعضی
 * سامسونگ‌ها کپی canvas سیاه است) و بارکد کج/تار را خوب می‌خواند.
 *
 * هر دو موتور موازی کار می‌کنند و هر کدام زودتر خواند برنده است.
 *
 * محافظت‌ها:
 *   - حداکثر یک `detect` در پرواز؛ نتیجهٔ دیررس دور ریخته نمی‌شود.
 *   - اولین فراخوانی (گرم‌شدن مدل) تا WARMUP_TIMEOUT_MS وقت دارد.
 *   - بعد از HANG_LIMIT آویزان‌شدن پیاپی، موتور خاموش می‌شود و zxing تنها می‌ماند.
 */
import { fromNativeFormat, NATIVE_READ_FORMATS, type CanonicalFormat } from "../formats";
import type { Point } from "../geometry";

type DetectedBarcodeLike = {
  rawValue: string;
  format: string;
  cornerPoints?: ReadonlyArray<{ x: number; y: number }>;
};

type BarcodeDetectorLike = {
  detect(
    source: CanvasImageSource | ImageBitmap | ImageData | Blob,
  ): Promise<DetectedBarcodeLike[]>;
};

type BarcodeDetectorCtor = {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

export type NativeHit = { text: string; format: CanonicalFormat; corners: Point[] };

const WARMUP_TIMEOUT_MS = 5_000;
const DETECT_TIMEOUT_MS = 2_000;
export const HANG_LIMIT = 2;

/** سازندهٔ BarcodeDetector اگر مرورگر داشته باشد. */
function detectorCtor(): BarcodeDetectorCtor | null {
  const g = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof g.BarcodeDetector === "function" ? g.BarcodeDetector : null;
}

/** یک نمونهٔ آشکارساز با فرمت‌های مشترک بین ما و دستگاه، یا null. */
export async function createNativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = detectorCtor();
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const formats = NATIVE_READ_FORMATS.filter((f) => supported.includes(f));
    // بعضی پیاده‌سازی‌ها فهرست خالی می‌دهند و در عمل کار نمی‌کنند (لینوکس بدون backend).
    if (formats.length === 0) return null;
    return new Ctor({ formats });
  } catch {
    return null;
  }
}

/** اولین بارکد معتبر از خروجی `detect`. خالص؛ تست‌شده. */
export function pickNativeHit(
  codes: readonly DetectedBarcodeLike[] | null | undefined,
): NativeHit | null {
  if (!codes) return null;
  for (const c of codes) {
    if (!c || typeof c.rawValue !== "string" || !c.rawValue) continue;
    const corners = (c.cornerPoints ?? []).map((p) => ({ x: p.x, y: p.y }));
    return { text: c.rawValue, format: fromNativeFormat(c.format), corners };
  }
  return null;
}

/** وعده را با سقف زمانی می‌پیچد؛ در صورت تمام شدن وقت `"timeout"` برمی‌گرداند. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class NativeEngine {
  private hangs = 0;
  private warmedUp = false;
  private busy = false;
  private dead = false;

  private constructor(private readonly detector: BarcodeDetectorLike) {}

  static async create(): Promise<NativeEngine | null> {
    const detector = await createNativeDetector();
    return detector ? new NativeEngine(detector) : null;
  }

  get available(): boolean {
    return !this.dead && !this.busy;
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** یک تلاش روی منبع داده‌شده. اگر مشغول یا خاموش است، null. */
  async detect(
    source: CanvasImageSource | ImageBitmap | ImageData | Blob,
  ): Promise<NativeHit | null> {
    if (this.dead || this.busy) return null;
    this.busy = true;
    try {
      const budget = this.warmedUp ? DETECT_TIMEOUT_MS : WARMUP_TIMEOUT_MS;
      const out = await withTimeout(this.detector.detect(source), budget);
      if (out === "timeout") {
        this.hangs += 1;
        if (this.hangs >= HANG_LIMIT) this.dead = true;
        return null;
      }
      this.warmedUp = true;
      this.hangs = 0;
      return pickNativeHit(out);
    } catch {
      // خطای تک‌فریم (مثلاً ویدیو هنوز آماده نیست) موتور را نمی‌کشد.
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** یک بار برای تصویر ثابت (عکس انتخاب‌شده) بدون محدودیت مشغول بودن. */
  async detectOnce(source: ImageBitmap | Blob | CanvasImageSource): Promise<NativeHit | null> {
    try {
      const out = await withTimeout(this.detector.detect(source), WARMUP_TIMEOUT_MS);
      return out === "timeout" ? null : pickNativeHit(out);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.dead = true;
  }
}
