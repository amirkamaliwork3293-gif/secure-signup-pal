/**
 * index.ts — نمای بیرونی دیکودر.
 *
 * یک تصمیم در شروع، نه در هر فریم:
 *
 *   Worker (wasm گرم‌شده، سلامت اثبات‌شده)   ← مسیر عادی
 *     ↓ در ۳ ثانیه `ready` نداد
 *   دیکود روی ترد اصلی                       ← WebView قدیمی بدون module worker
 *
 * اگر Worker وسط کار قفل کند (فقط با کرش wasm ممکن است)، **یک بار** و برای همیشه
 * به ترد اصلی تنزل می‌کنیم. نسخهٔ قبل به جای این، در هر فریم watchdog می‌گذاشت و
 * Worker را بازیافت می‌کرد؛ همان رفتار غیرقطعی که این بازنویسی حذفش کرد.
 */
import type { FrameGrab } from "../frame-source";
import type { DecodeRequest, WorkerResponse } from "./protocol";

/** Worker باید تا این مدت سلامتش را اعلام کند. شامل دانلود و کامپایل wasm است. */
const HANDSHAKE_TIMEOUT_MS = 3000;
/** دیکود سالم ۱ تا ۷ میلی‌ثانیه است؛ این سقف یعنی Worker واقعاً مرده. */
const DECODE_TIMEOUT_MS = 2500;

export type DecodeHit = { text: string; format: string };

export class Decoder {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (hit: DecodeHit | null) => void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private workerOffscreen = false;
  private disposed = false;

  /** آیا فریم را به‌شکل ImageBitmap بدهیم؟ در حالت ترد اصلی همیشه نه. */
  get acceptsBitmap(): boolean {
    return this.worker !== null && this.workerOffscreen;
  }

  get mode(): "worker" | "main" {
    return this.worker ? "worker" : "main";
  }

  /** Worker را می‌سازد و منتظر اثبات سلامتش می‌ماند. شکست یعنی حالت ترد اصلی. */
  async start(): Promise<void> {
    const worker = spawnWorker();
    if (!worker) return;

    const healthy = await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(handshakeTimer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(ok);
      };
      const handshakeTimer = setTimeout(() => done(false), HANDSHAKE_TIMEOUT_MS);
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "ready") {
          this.workerOffscreen = e.data.offscreen;
          done(true);
        } else if (e.data.type === "fail") {
          done(false);
        }
      };
      worker.onerror = () => done(false);
    });

    if (this.disposed || !healthy) {
      terminate(worker);
      return;
    }

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(e.data);
    worker.onerror = () => this.demote();
    this.worker = worker;
  }

  /**
   * یک فریم را دیکود می‌کند. صداکننده تضمین می‌کند هم‌زمان فقط یکی در پرواز است؛
   * اگر باز هم دو تا بیاید، دومی بی‌صدا `null` می‌گیرد و فریمش دور ریخته می‌شود.
   */
  async decode(grab: FrameGrab): Promise<DecodeHit | null> {
    if (this.disposed) return null;
    if (this.worker) return this.decodeInWorker(this.worker, grab);
    return this.decodeOnMainThread(grab);
  }

  private decodeInWorker(worker: Worker, grab: FrameGrab): Promise<DecodeHit | null> {
    if (this.pending) return Promise.resolve(null);

    const id = this.nextId++;
    const { payload, transfer } = toRequest(id, grab);

    return new Promise<DecodeHit | null>((resolve) => {
      this.pending = { id, resolve };
      this.timer = setTimeout(() => {
        // Worker جواب نداد: یک‌بار برای همیشه به ترد اصلی می‌رویم.
        this.demote();
      }, DECODE_TIMEOUT_MS);

      try {
        worker.postMessage(payload, transfer);
      } catch {
        this.settle(id, null);
      }
    });
  }

  private async decodeOnMainThread(grab: FrameGrab): Promise<DecodeHit | null> {
    // در این حالت صداکننده پیکسل می‌فرستد. ImageBitmap فقط در همان یک فریمِ
    // گذارِ تنزل ممکن است برسد — می‌بندیم و فریم را رد می‌کنیم.
    if (grab.kind === "bitmap") {
      try {
        grab.bitmap.close();
      } catch {
        /* از قبل بسته */
      }
      return null;
    }
    const [{ prepareWasm }, { decodePixels }] = await Promise.all([
      import("./prepare"),
      import("./zxing"),
    ]);
    if (this.disposed) return null;
    prepareWasm();
    try {
      return await decodePixels(grab);
    } catch {
      return null;
    }
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    if (msg.type !== "result") return;
    this.settle(msg.id, msg.text ? { text: msg.text, format: msg.format ?? "" } : null);
  }

  private settle(id: number, hit: DecodeHit | null): void {
    if (!this.pending || this.pending.id !== id) return;
    const { resolve } = this.pending;
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    resolve(hit);
  }

  /** گذار یک‌طرفه به دیکود ترد اصلی. */
  private demote(): void {
    if (!this.worker) return;
    console.warn("[scanner] decode worker unresponsive — falling back to main-thread decoding");
    terminate(this.worker);
    this.worker = null;
    this.workerOffscreen = false;
    if (this.pending) this.settle(this.pending.id, null);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve(null);
    }
    if (this.worker) {
      terminate(this.worker);
      this.worker = null;
    }
  }
}

function toRequest(
  id: number,
  grab: FrameGrab,
): { payload: DecodeRequest; transfer: Transferable[] } {
  if (grab.kind === "bitmap") {
    return { payload: { id, bitmap: grab.bitmap }, transfer: [grab.bitmap] };
  }
  // بافر را کپی می‌کنیم چون ImageData.data به کانواسِ بازاستفاده‌شده وصل است و
  // transfer کردنش کانواس را از کار می‌انداخت.
  // ArrayBuffer تازه می‌سازیم نه `.buffer.slice()`: نوع `.buffer` می‌تواند
  // SharedArrayBuffer باشد و SharedArrayBuffer قابل transfer نیست.
  const bytes = grab.data;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return {
    payload: { id, buffer, width: grab.width, height: grab.height },
    transfer: [buffer],
  };
}

/**
 * الگوی `new Worker(new URL(...), ...)` باید دقیقاً همین شکل و در یک عبارت باشد.
 * اگر URL در متغیر جدا شود، Vite آن را به‌عنوان Worker باندل نمی‌کند و فایل خام
 * .ts داخل باندل می‌رود (رگرسیون واقعیِ نسخهٔ قبل: Worker با SyntaxError می‌مرد).
 */
function spawnWorker(): Worker | null {
  try {
    return new Worker(new URL("./decode.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

function terminate(worker: Worker): void {
  worker.onmessage = null;
  worker.onerror = null;
  try {
    worker.terminate();
  } catch {
    /* از قبل مرده */
  }
}
