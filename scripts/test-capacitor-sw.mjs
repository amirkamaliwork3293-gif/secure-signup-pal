/**
 * رفتار public/capacitor-sw.js با شبکه و کش شبیه‌سازی‌شده (بدون مرورگر/شبکهٔ واقعی).
 * اجرا: node scripts/test-capacitor-sw.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ORIGIN = "https://kamixapp.ir";
const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, "../public/capacitor-sw.js"), "utf8");
assert.match(source, /const NAV_TIMEOUT_MS = 8000;/);
// در تست، مهلت ناوبری کوتاه می‌شود تا سریع اجرا شود
const testSource = source.replace("const NAV_TIMEOUT_MS = 8000;", "const NAV_TIMEOUT_MS = 40;");

const keyOf = (input, ignoreSearch) => {
  const u = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  return ignoreSearch ? u.origin + u.pathname : u.href;
};

function makeCache() {
  const entries = new Map();
  return {
    entries,
    async put(req, res) {
      entries.set(keyOf(req, false), {
        body: await res.text(),
        status: res.status,
        headers: [...res.headers],
      });
    },
    async match(req, opts = {}) {
      const want = keyOf(req, !!opts.ignoreSearch);
      for (const [k, v] of entries) {
        if ((opts.ignoreSearch ? keyOf(k, true) : k) === want) {
          return new Response(v.body, { status: v.status, headers: v.headers });
        }
      }
      return undefined;
    },
    async keys() {
      return [...entries.keys()].map((k) => new Request(k));
    },
  };
}

function loadWorker({ fetchImpl }) {
  const listeners = {};
  const cache = makeCache();
  const fetchCalls = [];
  const self = {
    location: new URL(ORIGIN + "/capacitor-sw.js"),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const ctx = {
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: (req) => {
      fetchCalls.push(keyOf(req, false));
      return fetchImpl(req);
    },
    Request,
    Response,
    URL,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(testSource, ctx);

  async function dispatch(url, { navigate = false, method = "GET" } = {}) {
    const request = new Request(new URL(url, ORIGIN).href, { method });
    Object.defineProperty(request, "mode", { value: navigate ? "navigate" : "cors" });
    let responded = null;
    const waited = [];
    listeners.fetch({
      request,
      respondWith: (p) => (responded = p),
      waitUntil: (p) => waited.push(p),
    });
    if (!responded) return { handled: false };
    const response = await responded;
    return { handled: true, response, waited };
  }
  return { dispatch, cache, fetchCalls };
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const js = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/javascript" } });
const tick = () => new Promise((r) => setTimeout(r, 0));

// ۱) آنلاین عادی: پاسخ تازه برمی‌گردد و پوسته کش می‌شود
{
  const w = loadWorker({ fetchImpl: async () => html("NEW") });
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(await r.response.text(), "NEW");
  await tick();
  assert.ok(w.cache.entries.has(ORIGIN + "/__kamix_app_shell__"));
}

// ۲) قطع کامل شبکه: پوستهٔ کش‌شده
{
  let online = true;
  const w = loadWorker({
    fetchImpl: async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return html("SHELL");
    },
  });
  await w.dispatch("/", { navigate: true });
  await tick();
  online = false;
  const r = await w.dispatch("/customers", { navigate: true });
  assert.equal(r.response.status, 200);
  assert.equal(await r.response.text(), "SHELL");
}

// ۳) قطع شبکه بدون کش: HTML فارسی داخلی (نه صفحهٔ خطای WebView)
{
  const w = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(r.response.status, 200);
  assert.match(await r.response.text(), /در حال باز کردن برنامه/);
}

// ۴) توقف Vercel (503/402/500/429) با پوستهٔ کش‌شده: پوسته
for (const status of [503, 402, 500, 429]) {
  let down = false;
  const w = loadWorker({
    fetchImpl: async () => (down ? html("VERCEL ERROR", status) : html("SHELL")),
  });
  await w.dispatch("/", { navigate: true });
  await tick();
  down = true;
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(r.response.status, 200, `status ${status}`);
  assert.equal(await r.response.text(), "SHELL");
}

// ۵) خطای سرور بدون کش: همان پاسخ سرور (رفتار قبلی)
{
  const w = loadWorker({ fetchImpl: async () => html("DOWN", 503) });
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(r.response.status, 503);
}

// ۶) 404 واقعی: دست‌نخورده، حتی وقتی پوسته در کش است
{
  let notFound = false;
  const w = loadWorker({
    fetchImpl: async () => (notFound ? html("NOT FOUND", 404) : html("SHELL")),
  });
  await w.dispatch("/", { navigate: true });
  await tick();
  notFound = true;
  const r = await w.dispatch("/store/missing", { navigate: true });
  assert.equal(r.response.status, 404);
}

// ۷) پاسخ serverFn با خطای سرور: هرگز نسخهٔ کهنهٔ کش‌شده برنمی‌گردد
{
  let down = false;
  const w = loadWorker({
    fetchImpl: async () =>
      down ? new Response("ERR", { status: 503 }) : new Response('{"v":1}', { status: 200 }),
  });
  await w.dispatch("/_serverFn/abc?x=1");
  await tick();
  down = true;
  const r = await w.dispatch("/_serverFn/abc?x=1");
  assert.equal(r.response.status, 503);
}

// ۸) فایل هش‌دار /assets/ در کش: بدون درخواست شبکه از کش
{
  const w = loadWorker({ fetchImpl: async () => js("CODE-A") });
  const first = await w.dispatch("/assets/index-abc123.js");
  assert.equal(await first.response.text(), "CODE-A");
  await tick();
  const callsBefore = w.fetchCalls.length;
  const second = await w.dispatch("/assets/index-abc123.js");
  assert.equal(await second.response.text(), "CODE-A");
  assert.equal(w.fetchCalls.length, callsBefore, "cached hashed asset must not hit the network");
}

// ۹) فایل هش‌دار نبود در کش + 404 (فایل نسخهٔ قدیمی): پاسخ واقعی سرور، کش نمی‌شود
{
  const w = loadWorker({ fetchImpl: async () => js("missing", 404) });
  const r = await w.dispatch("/assets/old-zzz.js");
  assert.equal(r.response.status, 404);
  await tick();
  assert.equal(w.cache.entries.size, 0);
}

// ۱۰) فایل غیرهش‌دار (manifest) همچنان Network First است
{
  let version = "M1";
  const w = loadWorker({ fetchImpl: async () => new Response(version, { status: 200 }) });
  await w.dispatch("/manifest.webmanifest");
  await tick();
  version = "M2";
  const r = await w.dispatch("/manifest.webmanifest");
  assert.equal(await r.response.text(), "M2");
}

// ۱۱) اتصال معلق با پوستهٔ کش‌شده: بعد از مهلت، پوسته؛ شبکه در پس‌زمینه کش را تازه می‌کند
{
  let mode = "ok";
  let releaseHang;
  const w = loadWorker({
    fetchImpl: () => {
      if (mode === "ok") return Promise.resolve(html("OLD-SHELL"));
      return new Promise((resolve) => (releaseHang = () => resolve(html("NEW-SHELL"))));
    },
  });
  await w.dispatch("/", { navigate: true });
  await tick();
  mode = "hang";
  const t0 = Date.now();
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(await r.response.text(), "OLD-SHELL");
  assert.ok(Date.now() - t0 >= 35, "must wait the navigation timeout first");
  assert.equal(r.waited.length, 1, "background network kept alive with waitUntil");
  releaseHang();
  await r.waited[0];
  await tick();
  const fresh = await w.cache.match(ORIGIN + "/__kamix_app_shell__");
  assert.equal(await fresh.text(), "NEW-SHELL");
}

// ۱۲) اتصال کند بدون کش: منتظر شبکه می‌ماند (رفتار قبلی)
{
  const w = loadWorker({
    fetchImpl: () => new Promise((resolve) => setTimeout(() => resolve(html("SLOW-BUT-OK")), 120)),
  });
  const r = await w.dispatch("/", { navigate: true });
  assert.equal(await r.response.text(), "SLOW-BUT-OK");
}

// ۱۳) اتصال معلق که بعد از مهلت قطع می‌شود و کش ندارد: HTML داخلی
{
  const w = loadWorker({
    fetchImpl: () =>
      new Promise((_, reject) => setTimeout(() => reject(new TypeError("Failed to fetch")), 80)),
  });
  const r = await w.dispatch("/", { navigate: true });
  assert.match(await r.response.text(), /در حال باز کردن برنامه/);
}

// ۱۴) مسیرهایی که worker دست نمی‌زند
{
  const w = loadWorker({ fetchImpl: async () => html("X") });
  assert.equal((await w.dispatch("/favicon.ico?kamix-health=1")).handled, false);
  assert.equal((await w.dispatch("/kamali-accounting.apk")).handled, false);
  assert.equal((await w.dispatch("/api/x")).handled, false);
  assert.equal((await w.dispatch("/_serverFn/abc", { method: "POST" })).handled, false);
  assert.equal((await w.dispatch("https://abc.supabase.co/rest/v1/x")).handled, false);
}

console.log("capacitor-sw: all checks passed");
