/**
 * محیط مرورگر شبیه‌سازی‌شده برای تست store.ts: localStorage، window با رویداد واقعی،
 * و ساعت دستی برای setTimeout (debounce ۶۰۰ms، retry ۵s، ...) بدون انتظار واقعی.
 * باید قبل از import کردن store.ts ایمپورت شود.
 */
const mem = new Map<string, string>();
export const localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  get length() {
    return mem.size;
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
};
const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.localStorage = localStorage;
win.setInterval = () => 0;
const g = globalThis as Record<string, unknown>;
g.window = win;
g.localStorage = localStorage;
g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };

let now = 0;
let seq = 0;
export const timers = new Map<number, { at: number; fn: () => void }>();
g.setTimeout = ((fn: () => void, ms = 0) => {
  const id = ++seq;
  timers.set(id, { at: now + ms, fn });
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
