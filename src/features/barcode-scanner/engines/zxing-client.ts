/**
 * zxing-client.ts — نمای بیرونی موتور zxing برای ترد اصلی.
 *
 *   Worker (wasm گرم، سلامت اثبات‌شده)   ← مسیر عادی
 *     ↓ در HANDSHAKE_TIMEOUT_MS آماده نشد، یا وسط کار مرد
 *   دیکود روی ترد اصلی                   ← WebView قدیمی بدون module worker
 *
 * تنزل به ترد اصلی یک‌طرفه و یک‌باره است؛ هیچ بازیافت دوره‌ای در کار نیست.
 * کد ترد اصلی با import پویا بارگذاری می‌شود تا در حالت عادی وارد باندل صفحه نشود.
 */
import type { WorkerResponse } from "./protocol";
import type { DecodeMode, Pixels, ZxingHit } from "./zxing-core";

const HANDSHAKE_TIMEOUT_MS = 10_000;
/** دیکود سالم چند ده میلی‌ثانیه است؛ این سقف یعنی Worker گیر کرده. */
const DECODE_TIMEOUT_MS = 3_000;

type MainDecoder = (px: Pixels, mode: DecodeMode) => Promise<ZxingHit | null>;

export class ZxingClient {
  private worker: Worker | null = null;
  private main: MainDecoder | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (hit: ZxingHit | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private disposed = false;
  private starting: Promise<void> | null = null;

  get mode(): "worker" | "main" | "none" {
    return this.worker ? "worker" : this.main ? "main" : "none";
  }

  /** موتور را آماده می‌کند. هرگز reject نمی‌شود؛ در بدترین حالت mode برابر "none" می‌ماند. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.boot();
    return this.starting;
  }

  private async boot(): Promise<void> {
    const worker = spawnWorker();
    if (worker) {
      const ok = await handshake(worker);
      if (this.disposed) {
        worker.terminate();
        return;
      }
      if (ok) {
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
        worker.onerror = () => void this.demote();
        this.worker = worker;
        return;
      }
      worker.terminate();
    }
    await this.loadMain();
  }

  private async loadMain(): Promise<void> {
    if (this.main || this.disposed) return;
    try {
      const [{ decodePixels }, { loadZxing }] = await Promise.all([
        import("./zxing-core"),
        import("./zxing-setup"),
      ]);
      await loadZxing();
      if (!this.disposed) this.main = decodePixels;
    } catch {
      this.main = null;
    }
  }

  private async demote(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    this.settle(null);
    await this.loadMain();
  }

  /** یک فریم را دیکود می‌کند. صداکننده تضمین می‌کند هم‌زمان فقط یکی در پرواز است. */
  decode(px: Pixels, mode: DecodeMode = {}): Promise<ZxingHit | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.worker) {
      if (this.pending) return Promise.resolve(null);
      const worker = this.worker;
      const id = this.nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => void this.demote(), DECODE_TIMEOUT_MS);
        this.pending = { id, resolve, timer };
        try {
          const buffer = px.data.buffer as ArrayBuffer;
          worker.postMessage(
            { type: "decode", id, width: px.width, height: px.height, buffer, mode },
            [buffer],
          );
        } catch {
          void this.demote();
        }
      });
    }
    if (this.main) return this.main(px, mode).catch(() => null);
    return Promise.resolve(null);
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === "result" && this.pending?.id === msg.id) this.settle(msg.hit);
  }

  private settle(hit: ZxingHit | null): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(hit);
  }

  dispose(): void {
    this.disposed = true;
    this.settle(null);
    this.worker?.terminate();
    this.worker = null;
    this.main = null;
  }
}

function spawnWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./zxing.worker.ts", import.meta.url), {
      type: "module",
      name: "barcode-decoder",
    });
  } catch {
    return null;
  }
}

function handshake(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), HANDSHAKE_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data?.type === "ready") done(true);
      else if (e.data?.type === "fail") done(false);
    };
    worker.onerror = () => done(false);
  });
}
