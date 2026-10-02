/**
 * محیط مرورگر شبیه‌سازی‌شده برای تست store.ts: localStorage، window با رویداد واقعی،
 * و ساعت دستی برای setTimeout (debounce ۶۰۰ms، retry ۵s، ...) بدون انتظار واقعی.
 * باید قبل از import کردن store.ts ایمپورت شود.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * چند دستگاه در یک پروسه: هر دستگاه localStorage جدا دارد. کدی که داخل
 * onDevice(name, fn) اجرا شود — و همهٔ awaitها و تایمرهایی که می‌سازد — حافظهٔ
 * همان دستگاه را می‌بیند. بیرون از onDevice حافظهٔ پیش‌فرض استفاده می‌شود.
 */
const device = new AsyncLocalStorage<string>();
const memories = new Map<string, Map<string, string>>();
function memOf(name = device.getStore() ?? "default"): Map<string, string> {
  let m = memories.get(name);
  if (!m) memories.set(name, (m = new Map()));
  return m;
}
export function onDevice<T>(name: string, fn: () => T): T {
  return device.run(name, fn);
}
/** حافظهٔ یک دستگاه — مثلاً برای شبیه‌سازی پاک شدن داده‌های WebView */
export function deviceStorage(name: string): Map<string, string> {
  return memOf(name);
}
/** اگر setItem پرتاب کند (پر شدن حافظه) — برای تست QuotaExceededError */
export const storageLimits = { maxChars: Infinity };

export const localStorage = {
  getItem: (k: string) => {
    const mem = memOf();
    return mem.has(k) ? mem.get(k)! : null;
  },
  setItem: (k: string, v: string) => {
    const mem = memOf();
    let used = 0;
    for (const [key, val] of mem) if (key !== k) used += key.length + val.length;
    if (used + k.length + String(v).length > storageLimits.maxChars) {
      const err = new Error("QuotaExceededError: the quota has been exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
    mem.set(k, String(v));
  },
  removeItem: (k: string) => void memOf().delete(k),
  clear: () => memOf().clear(),
  get length() {
    return memOf().size;
  },
  key: (i: number) => [...memOf().keys()][i] ?? null,
};
const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.localStorage = localStorage;
win.setInterval = () => 0;
const g = globalThis as Record<string, unknown>;
g.window = win;
g.localStorage = localStorage;
g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };

let now = 0;
/** ساعت جعلی تایمرها (میلی‌ثانیه از شروع تست) */
export const clock = {
  get now() {
    return now;
  },
};
let seq = 0;
export const timers = new Map<number, { at: number; fn: () => void }>();
g.setTimeout = ((fn: () => void, ms = 0) => {
  const id = ++seq;
  const owner = device.getStore();
  timers.set(id, { at: now + ms, fn: owner ? () => device.run(owner, fn) : fn });
  return id;
}) as unknown as typeof setTimeout;
g.clearTimeout = ((id: number) => void timers.delete(id)) as unknown as typeof clearTimeout;

export async function flush() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

export async function advance(ms: number) {
  const until = now + ms;
  await flush();
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, t]) => t.at <= until)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    now = due[1].at;
    due[1].fn();
    await flush();
  }
  now = until;
}
