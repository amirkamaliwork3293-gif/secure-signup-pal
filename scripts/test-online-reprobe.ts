/**
 * اپ اندروید نباید با یک بار جواب ندادن تست اتصال برای همیشه «آفلاین» بماند.
 * اجرا: npx tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-online-reprobe.ts
 */
import assert from "node:assert/strict";

const g = globalThis as Record<string, unknown>;
const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.Capacitor = { isNativePlatform: () => true };
win.alert = () => {};
g.window = win;
g.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(g, "navigator", { value: { onLine: true }, configurable: true });

// شبکه: تعداد مشخصی تلاش ناموفق، بعد موفق
let failNext = 0;
let probes = 0;
g.fetch = async () => {
  probes += 1;
  if (failNext > 0) {
    failNext -= 1;
    throw new TypeError("Failed to fetch");
  }
  return new Response("ok");
};

// تایمرهای تلاش مجدد را دستی جلو می‌بریم
const pending: Array<() => void> = [];
const realSetTimeout = setTimeout;
g.setTimeout = ((fn: () => void, ms?: number) => {
  if ((ms ?? 0) >= 1000 && (ms ?? 0) !== 2500) {
    pending.push(fn);
    return pending.length;
  }
  return realSetTimeout(fn, ms);
}) as unknown as typeof setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 20));
async function runRetries() {
  while (pending.length) {
    pending.shift()!();
    await tick();
  }
}

const mod = await import("../src/lib/online-status.ts");
let confirmed = 0;
win.addEventListener(mod.ONLINE_CONFIRMED_EVENT, () => (confirmed += 1));

// ۱) اولین تست اتصال ناموفق است (اینترنت کند هنگام باز شدن برنامه)
failNext = 1;
mod.initOnlineMonitoring();
await tick();
assert.equal(probes, 1);
assert.equal(
  mod.isCapacitorOfflineReadOnly(),
  false,
  "one failed check must not put the app in offline read-only mode",
);
assert.equal(pending.length, 1, "a retry must be scheduled after a failed check");

// ۲) تلاش مجدد موفق است → آنلاین
await runRetries();
assert.equal(mod.getOnlineKind(), "online");
assert.equal(mod.isCapacitorOfflineReadOnly(), false);

// ۳) واقعاً قطع: دو تست ناموفق پشت سر هم → آفلاین، ولی تلاش ادامه دارد
win.dispatchEvent(new Event("offline"));
assert.equal(mod.isCapacitorOfflineReadOnly(), true, "offline event must switch to read-only");
failNext = 3;
await runRetries(); // هر تلاش ناموفق، تلاش بعدی را زمان‌بندی می‌کند تا بالاخره وصل شود
assert.equal(mod.getOnlineKind(), "online", "the app must leave offline mode on its own");
assert.equal(mod.isCapacitorOfflineReadOnly(), false);
assert.equal(confirmed, 1, "going back online must be announced once (sync restarts on it)");

// ۴) نوشتنِ ردشده در حالت آفلاین خودش یک بررسی تازه راه می‌اندازد
win.dispatchEvent(new Event("offline"));
pending.length = 0;
const before = probes;
assert.equal(mod.requireOnlineWrite(), false);
await tick();
assert.ok(probes > before, "a blocked write must trigger a fresh connectivity check");
assert.equal(mod.requireOnlineWrite(), true, "after the check succeeds, writing works again");

console.log("online re-probe tests passed");
process.exit(0);
