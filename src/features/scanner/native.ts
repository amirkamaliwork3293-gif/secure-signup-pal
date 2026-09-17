/**
 * native.ts — BarcodeDetector بومی (ML Kit روی کروم/سامسونگ/WebView اندروید).
 *
 * این مسیر فریم را از خودِ عنصر ویدیو می‌خواند، نه از canvas/ImageBitmap.
 * روی گوشی‌هایی که پیش‌نمایش زنده است ولی کپی فریم سیاه است (A55 و چند
 * میان‌ردهٔ سامسونگ) همین موتور تنها چیزی است که بارکد را می‌بیند.
 *
 * عمداً هم‌زمان با ZXing و غیرمسدودکننده است: آویزان شدن ML Kit نباید حلقه
 * را بکشد. بعد از دو تایم‌اوت پیاپی خاموش می‌شود تا ZXing تنها بماند.
 */
import { CORE_NATIVE_FORMATS, NATIVE_FORMATS, normalizeOutputFormat } from "./formats";

export type NativeHit = { text: string; format: string };

type NativeBarcode = { rawValue?: string; format?: string };
type NativeDetectorApi = { detect: (src: HTMLVideoElement) => Promise<NativeBarcode[]> };

export const NATIVE_HANG_LIMIT = 2;
export const NATIVE_WARMUP_CALLS = 3;
export const NATIVE_WARMUP_MS = 4000;
export const NATIVE_DETECT_MS = 1000;

export function nativeDetectBudgetMs(callIndex: number): number {
  return callIndex < NATIVE_WARMUP_CALLS ? NATIVE_WARMUP_MS : NATIVE_DETECT_MS;
}

export function nextNativeHangState(
  timedOut: boolean,
  hangCount: number,
  limit = NATIVE_HANG_LIMIT,
): { hangCount: number; disable: boolean } {
  if (!timedOut) return { hangCount: 0, disable: false };
  const next = hangCount + 1;
  return { hangCount: next, disable: next >= Math.max(1, limit | 0) };
}

export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ value: fallback, timedOut: true });
    }, Math.max(1, ms | 0));
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ value: fallback, timedOut: false });
      },
    );
  });
}

function barcodeDetectorCtor(): (new (opts?: { formats?: string[] }) => NativeDetectorApi) | null {
  const g = globalThis as unknown as {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetectorApi;
  };
  return g.BarcodeDetector ?? null;
}

export function createNativeDetector(): NativeDetectorApi | null {
  const BD = barcodeDetectorCtor();
  if (!BD) return null;
  const attempts: Array<{ formats?: string[] } | undefined> = [
    { formats: [...NATIVE_FORMATS] },
    { formats: [...CORE_NATIVE_FORMATS] },
    undefined,
  ];
  for (const opts of attempts) {
    try {
      return opts ? new BD(opts) : new BD();
    } catch {
      /* بعضی موتورها اگر حتی یک فرمت لیست‌شده پشتیبانی نشود throw می‌کنند. */
    }
  }
  return null;
}

export function nativeHitFromCodes(codes: NativeBarcode[]): NativeHit | null {
  for (const c of codes) {
    const text = String(c.rawValue ?? "").trim();
    if (!text) continue;
    return { text, format: normalizeOutputFormat(c.format ?? "") };
  }
  return null;
}

export class NativeScanner {
  private detector: NativeDetectorApi | null = null;
  private inFlight = false;
  private hangCount = 0;
  private calls = 0;
  private disposed = false;

  get active(): boolean {
    return this.detector !== null && !this.disposed;
  }

  start(): boolean {
    this.detector = createNativeDetector();
    return this.detector !== null;
  }

  /**
   * یک detect روی خودِ ویدیو، بدون انتظار. نتیجه از `onHit` می‌آید.
   * اگر در پرواز باشد یا خاموش شده باشد، هیچ کاری نمی‌کند.
   */
  kick(video: HTMLVideoElement, onHit: (hit: NativeHit) => void): void {
    const det = this.detector;
    if (!det || this.disposed || this.inFlight) return;
    this.inFlight = true;
    const call = this.calls++;
    const budget = nativeDetectBudgetMs(call);
    let raw: Promise<NativeBarcode[]>;
    try {
      raw = det.detect(video);
    } catch {
      this.detector = null;
      this.inFlight = false;
      return;
    }
    void (async () => {
      try {
        const { value, timedOut } = await raceTimeout(raw, budget, [] as NativeBarcode[]);
        if (this.disposed) return;
        if (timedOut) {
          const hang = nextNativeHangState(true, this.hangCount);
          this.hangCount = hang.hangCount;
          if (hang.disable) {
            this.detector = null;
            console.warn("[scanner] native BarcodeDetector hung — continuing with ZXing only");
          }
          void raw.then(
            (codes) => {
              if (this.disposed) return;
              const hit = nativeHitFromCodes(codes);
              if (hit) onHit(hit);
            },
            () => {},
          );
          return;
        }
        this.hangCount = 0;
        const hit = nativeHitFromCodes(value);
        if (hit) onHit(hit);
      } catch {
        this.detector = null;
      } finally {
        this.inFlight = false;
      }
    })();
  }

  dispose(): void {
    this.disposed = true;
    this.detector = null;
    this.inFlight = false;
  }
}
