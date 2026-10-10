/**
 * zxing.worker.ts — دیکود در ترد جدا تا رابط کاربری حتی روی گوشی ضعیف روان بماند.
 *
 * ابتدا wasm را بارگذاری می‌کند و با یک دیکود آزمایشی سلامتش را ثابت می‌کند؛
 * فقط بعد از آن `ready` می‌فرستد. هر خطا به `fail` تبدیل می‌شود تا ترد اصلی به
 * حالت پشتیبان برود.
 */
import { decodePixels } from "./zxing-core";
import { loadZxing } from "./zxing-setup";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const scope = self as unknown as {
  postMessage: (msg: WorkerResponse) => void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

async function boot(): Promise<void> {
  try {
    await loadZxing();
    // دیکود یک تصویر سفید: ثابت می‌کند wasm واقعاً اجرا می‌شود، نه فقط بارگذاری شده.
    const size = 32;
    await decodePixels({
      data: new Uint8ClampedArray(size * size * 4).fill(255),
      width: size,
      height: size,
    });
    scope.postMessage({ type: "ready" });
  } catch (err) {
    scope.postMessage({ type: "fail", message: String((err as Error)?.message ?? err) });
  }
}

scope.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "decode") return;
  let hit = null;
  try {
    const data = new Uint8ClampedArray(msg.buffer);
    hit = await decodePixels({ data, width: msg.width, height: msg.height }, msg.mode);
  } catch {
    hit = null;
  }
  scope.postMessage({ type: "result", id: msg.id, hit });
};

void boot();
