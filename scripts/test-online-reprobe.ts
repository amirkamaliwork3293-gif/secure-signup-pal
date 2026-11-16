/**
 * اپ اندروید نباید به‌اشتباه «آفلاین» بماند:
 *  - یک بار جواب ندادن تست اتصال کافی نیست و تلاش دوباره ادامه دارد
 *  - اگر سایت برنامه (kamixapp.ir) نرسد ولی سرور داده برسد، آنلاین است
 *  - هر درخواست واقعیِ موفق به سرور داده، حالت آفلاین را فوراً برمی‌دارد
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

// شبکه
let down = false; // هیچ مقصدی نمی‌رسد
let siteDown = false; // فقط سایت برنامه نمی‌رسد
let probes = 0; // تعداد تست‌ها (هر تست یک درخواست به سایت دارد)
const crossOrigin: string[] = [];
g.fetch = async (url: string) => {
  const u = String(url);
  if (u.startsWith("/")) probes += 1;
  else crossOrigin.push(u);
  if (down) throw new TypeError("Failed to fetch");
  if (siteDown && u.startsWith("/")) throw new TypeError("Failed to fetch");
  return new Response("ok");
};

// تایمرهای «تلاش دوباره» را دستی جلو می‌بریم؛ مهلت خودِ تست اتصال واقعی می‌ماند
const core = await import("../src/lib/online-status-core.ts");
const pending: Array<() => void> = [];
const realSetTimeout = setTimeout;
g.setTimeout = ((fn: () => void, ms?: number) => {
  const d = ms ?? 0;
  if (d >= 1000 && d !== core.HEALTH_TIMEOUT_MS) {
    pending.push(fn);
    return pending.length;
  }
  return realSetTimeout(fn, d);
}) as unknown as typeof setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 20));
async function runRetries(max = 20) {
  for (let i = 0; i < max && pending.length; i++) {
    pending.shift()!();
    await tick();
  }
}

const mod = await import("../src/lib/online-status.ts");
let confirmed = 0;
win.addEventListener(mod.ONLINE_CONFIRMED_EVENT, () => (confirmed += 1));

// ۱) اولین تست اتصال ناموفق است (اینترنت کند هنگام باز شدن برنامه)
down = true;
mod.initOnlineMonitoring();
await tick();
assert.equal(probes, 1);
assert.equal(
  mod.isCapacitorOfflineReadOnly(),
  false,
  "one failed check must not put the app in offline read-only mode",
);
assert.equal(pending.length, 1, "a retry must be scheduled after a failed check");
assert.ok(
  crossOrigin.some((u) => u.endsWith("/auth/v1/health")),
  "the data server must be probed too, not only the app's own site",
);

// ۲) تلاش مجدد موفق است → آنلاین
down = false;
await runRetries();
assert.equal(mod.getOnlineKind(), "online");

// ۳) سایت برنامه از دسترس خارج است ولی سرور داده در دسترس است → آنلاین
win.dispatchEvent(new Event("offline"));
assert.equal(mod.isCapacitorOfflineReadOnly(), true, "offline event must switch to read-only");
siteDown = true;
await runRetries();
assert.equal(
  mod.getOnlineKind(),
  "online",
  "the app must not be 'offline' when only its own website is unreachable",
);
assert.equal(confirmed, 1, "going back online must be announced once (sync restarts on it)");
siteDown = false;

// ۴) واقعاً قطع، چند تست ناموفق، بعد وصل: خودش از حالت آفلاین بیرون می‌آید
win.dispatchEvent(new Event("offline"));
down = true;
await runRetries(3);
assert.equal(mod.isCapacitorOfflineReadOnly(), true);
down = false;
await runRetries();
assert.equal(mod.getOnlineKind(), "online", "the app must leave offline mode on its own");
assert.equal(confirmed, 2);

// ۵) یک درخواست واقعی که به سرور داده رسید، آفلاین را فوراً برمی‌دارد
win.dispatchEvent(new Event("offline"));
pending.length = 0;
win.dispatchEvent(new CustomEvent(core.NETWORK_OK_EVENT));
assert.equal(mod.isCapacitorOfflineReadOnly(), false, "a real successful request proves we are online");
assert.equal(confirmed, 3);

// ۶) نوشتنِ ردشده در حالت آفلاین خودش یک بررسی تازه راه می‌اندازد
win.dispatchEvent(new Event("offline"));
pending.length = 0;
const before = probes;
assert.equal(mod.requireOnlineWrite(), false);
await tick();
assert.ok(probes > before, "a blocked write must trigger a fresh connectivity check");
assert.equal(mod.requireOnlineWrite(), true, "after the check succeeds, writing works again");

console.log("online re-probe tests passed");
process.exit(0);
