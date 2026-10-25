/* ============================================================
 * Capacitor app-shell worker — فقط وقتی از اپ اندروید ثبت می‌شود.
 *
 * استراتژی: Network First, Cache Fallback
 *   ۱) همیشه اول شبکه (تا بعد از دیپلوی، نسخهٔ تازه دیده شود)
 *   ۲) اگر شبکه واقعاً fail شود از کش
 *   ۳) اگر سرور به‌جای برنامه خطای قطعی بدهد (5xx/402/429 — مثلاً Vercel
 *      متوقف شده) فقط برای ناوبری سند و فایل‌های هش‌دار /assets/ از کش.
 *      پاسخ serverFn و 404 مثل قبل دست‌نخورده برمی‌گردد.
 *   ۴) اگر ناوبری سند NAV_TIMEOUT_MS طول بکشد (اتصال معلق) و پوستهٔ کش‌شده
 *      باشد، همان نشان داده می‌شود؛ درخواست شبکه در پس‌زمینه ادامه می‌دهد
 *      و کش را برای دفعهٔ بعد تازه می‌کند.
 *   ۵) فایل‌های هش‌دار /assets/ اگر در کش باشند از کش (نام = محتوا؛
 *      نسخهٔ کش‌شده دقیقاً همان فایل است). HTML همیشه Network First است.
 *
 * درخواست‌های داده به دامنهٔ دیگری می‌روند و این worker به آن‌ها دست نمی‌زند.
 *
 * ناوبری سند (باز شدن هر مسیر): هرگز به WebView «Webpage not available»
 * برنگردد — یا پوستهٔ کش‌شده یا HTML فارسی داخلی.
 *
 * این همان مشکلی را تکرار نمی‌کند که PWA قبلی را حذف کرد:
 *   - برای HTML، Cache First نیست
 *   - روی سایت/مرورگر ثبت نمی‌شود (register فقط با isCapacitor)
 *   - کش نسخه‌دار است و با آپدیت SW کش قدیمی پاک می‌شود
 *   - خودِ اسکریپت SW با updateViaCache:'none' همیشه از شبکه چک می‌شود
 *
 * کار کامل بدون اینترنت (KAMIX_WARM_ASSETS):
 *   بعد از باز شدن با اینترنت، فهرست /kamix-offline-assets.json (همهٔ
 *   فایل‌های هش‌دار برنامه: صفحه‌ها، اسکنر، PDF، فونت) خوانده و هر فایلی که
 *   هنوز در کش نیست دانلود می‌شود، تا صفحه‌ای که قبلاً باز نشده هم آفلاین باز
 *   شود. فقط وقتی همهٔ فایل‌های نسخهٔ فعلی در کش نشستند، فایل‌های قدیمیِ
 *   بی‌استفاده پاک می‌شوند (فایلی که پوستهٔ کش‌شده به آن نیاز دارد هرگز پاک نمی‌شود).
 * ============================================================ */
const SHELL_CACHE_VERSION = "v1";
const CACHE_NAME = "kamix-capacitor-shell-" + SHELL_CACHE_VERSION;
const HEALTH_PARAM = "kamix-health";
const SHELL_PATH = "/__kamix_app_shell__";
const NAV_TIMEOUT_MS = 8000;
const OFFLINE_MANIFEST_PATH = "/kamix-offline-assets.json";
const WARM_CONCURRENCY = 3;
let warmInFlight = null;
const ASSET_REF_RE = /\/assets\/[A-Za-z0-9._-]+\.(?:js|css|wasm|woff2?|svg)/g;

const NAV_FALLBACK_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>KAMIX</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Tahoma,sans-serif;background:#f8fafc;color:#0f172a}
main{text-align:center;padding:24px;max-width:22rem}
</style>
</head>
<body>
<main>
<p id="m">در حال باز کردن برنامه…</p>
</main>
<script>
(function(){
  var p=location.pathname||"/";
  if(p!=="/" && p.indexOf("/__kamix")!==0){
    location.replace("/");
    return;
  }
  var el=document.getElementById("m");
  if(el) el.textContent="برای دیدن اطلاعات ذخیره‌شده، یک‌بار با اینترنت وارد اپ شوید.";
})();
</script>
</body>
</html>`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/", { cache: "reload" });
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          await rememberShell(cache, res);
        }
      } catch {
        /* نصب هنگام آفلاین — چیزی برای precache نیست */
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => {
              if (key === CACHE_NAME) return false;
              return (
                key.startsWith("kamix-capacitor-shell-") ||
                key === "kamali-v1" ||
                key.startsWith("kamali-")
              );
            })
            .map((key) => caches.delete(key)),
        );
      } catch {
        /* noop */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "KAMIX_WARM_ASSETS") {
    if (!warmInFlight) {
      warmInFlight = warmOfflineAssets().finally(() => {
        warmInFlight = null;
      });
    }
    event.waitUntil(warmInFlight.catch(() => {}));
    return;
  }
  if (!data || data.type !== "KAMIX_WARM_SHELL") return;
  const urls = Array.isArray(data.urls) ? data.urls : [];
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const raw of urls) {
        if (typeof raw !== "string") continue;
        let url;
        try {
          url = new URL(raw, self.location.origin);
        } catch {
          continue;
        }
        if (url.origin !== self.location.origin) continue;
        if (url.searchParams.has(HEALTH_PARAM)) continue;
        try {
          const res = await fetch(url.href, { credentials: "same-origin" });
          if (res && res.ok) {
            await cache.put(url.href, res.clone());
            await rememberShell(cache, res);
          }
        } catch {
          /* آفلاین */
        }
      }
    })(),
  );
});

/** اول صفحه‌ها و کد اصلی، بعد کتابخانه‌های سنگین (اکسل/PDF/اسکنر) و فونت‌ها */
const HEAVY_ASSET_RE = /(?:xlsx|jspdf|html2canvas|zxing|purify|\.wasm$|\.woff2?$)/i;
function warmPriority(path) {
  if (/\.css$/.test(path)) return 0;
  if (/\.js$/.test(path) && !HEAVY_ASSET_RE.test(path)) return 1;
  return 2;
}

async function postToClients(message) {
  try {
    const list = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    for (const c of list) c.postMessage(message);
  } catch {
    /* noop */
  }
}

async function warmOfflineAssets() {
  let manifest;
  try {
    const res = await fetch(OFFLINE_MANIFEST_PATH, { cache: "no-store" });
    if (!res || !res.ok) return;
    manifest = await res.json();
  } catch {
    return; // آفلاین یا فهرست موجود نیست — دفعهٔ بعد
  }
  const files = Array.isArray(manifest && manifest.files)
    ? manifest.files.filter((f) => typeof f === "string" && f.startsWith("/"))
    : [];
  if (files.length === 0) return;
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const cache = await caches.open(CACHE_NAME);
  const queue = files.slice().sort((a, b) => warmPriority(a) - warmPriority(b));
  const total = files.length;
  let done = 0;
  let failed = 0;
  let lastReport = 0;
  const report = (final) =>
    postToClients({
      type: "KAMIX_OFFLINE_PROGRESS",
      version,
      done,
      total,
      failed,
      complete: final && failed === 0 && done === total,
      finished: final,
    });
  await report(false);
  async function worker() {
    while (queue.length > 0) {
      const path = queue.shift();
      const href = self.location.origin + path;
      try {
        if (!(await cache.match(href, { ignoreSearch: true }))) {
          const res = await fetch(href, { credentials: "same-origin" });
          if (res && res.ok) await cache.put(href, res);
          else failed += 1;
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (done - lastReport >= 5) {
        lastReport = done;
        void report(false);
      }
    }
  }
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  if (failed === 0) await pruneStaleAssets(cache, new Set(files)).catch(() => {});
  await report(true);
}

function assetRefs(html) {
  const out = new Set();
  const found = html.match(ASSET_REF_RE);
  if (found) for (const ref of found) out.add(ref);
  return out;
}

/**
 * پاک‌سازی محتاطانه: فایل /assets/ فقط وقتی پاک می‌شود که نه در فهرست نسخهٔ
 * فعلی باشد و نه هیچ HTML کش‌شده‌ای به آن ارجاع دهد. صفحهٔ HTML قدیمی (غیر از
 * پوسته) که به فایل‌های نسخهٔ فعلی ارجاع نمی‌دهد حذف می‌شود؛ به‌جایش پوسته
 * نشان داده می‌شود.
 */
async function pruneStaleAssets(cache, current) {
  // پوسته باید از همین نسخه باشد؛ وگرنه (دیپلوی وسط کار) فعلاً چیزی پاک نکن تا
  // فایل‌های تنبل پوستهٔ قدیمی برای باز شدن آفلاین بمانند.
  const shell = await cache.match(SHELL_PATH);
  if (!shell) return;
  const shellRefs = assetRefs(await shell.clone().text());
  if (shellRefs.size === 0 || [...shellRefs].some((r) => !current.has(r))) return;
  const requests = await cache.keys();
  const keep = new Set(current);
  const shellKeys = new Set([SHELL_PATH, "/"]);
  for (const req of requests) {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      continue;
    }
    if (url.pathname.startsWith("/assets/")) continue;
    const res = await cache.match(req);
    if (!res) continue;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html")) continue;
    const refs = assetRefs(await res.clone().text());
    const stale = refs.size > 0 && [...refs].some((r) => !current.has(r));
    if (stale && !shellKeys.has(url.pathname)) {
      await cache.delete(req);
      continue;
    }
    for (const r of refs) keep.add(r);
  }
  for (const req of requests) {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      continue;
    }
    if (!url.pathname.startsWith("/assets/")) continue;
    if (!keep.has(url.pathname)) await cache.delete(req);
  }
}

function shouldHandle(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.searchParams.has(HEALTH_PARAM)) return false;
  if (url.pathname === OFFLINE_MANIFEST_PATH) return false;
  if (url.pathname.endsWith(".apk")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === SHELL_PATH) return false;
  return true;
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

async function rememberShell(cache, response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) return;
  await cache.put(SHELL_PATH, response.clone()).catch(() => {});
  await cache.put("/", response.clone()).catch(() => {});
}

async function matchFromCache(request, url, wantHtml) {
  const cache = await caches.open(CACHE_NAME);
  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;
  const pathOnly = await cache.match(url.origin + url.pathname, { ignoreSearch: true });
  if (pathOnly) return pathOnly;
  if (!wantHtml) return null;
  const shell = await cache.match(SHELL_PATH);
  if (shell) return shell;
  const root = await cache.match("/");
  if (root) return root;
  const originRoot = await cache.match(url.origin + "/");
  if (originRoot) return originRoot;
  const keys = await cache.keys();
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type.includes("text/html")) return res;
  }
  return null;
}

function navigationFallbackResponse() {
  return new Response(NAV_FALLBACK_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** پاسخ HTTP هست ولی سرور در دسترس نیست (توقف/سقف مصرف/خطای سرور). */
function isServerOutage(response) {
  if (!response) return false;
  const status = response.status;
  return status === 402 || status === 429 || status >= 500;
}

/** نام فایل هش‌دار است؛ نسخهٔ کش‌شده دقیقاً همان محتواست. */
function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/");
}

const SLOW = Symbol("slow");

function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(SLOW), ms));
}

async function fetchAndRemember(request, isNavigate) {
  const fresh = await fetch(isNavigate ? new Request(request, { cache: "reload" }) : request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone()).catch(() => {});
    if (isNavigate) rememberShell(cache, fresh.clone()).catch(() => {});
  }
  return fresh;
}

async function networkFirst(request, url, keepAlive) {
  const isNavigate = isNavigationRequest(request);
  const hashed = isHashedAsset(url);
  if (hashed) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
    } catch {
      /* کش در دسترس نیست — از شبکه */
    }
  }
  try {
    const network = fetchAndRemember(request, isNavigate);
    let fresh;
    if (isNavigate) {
      const early = await Promise.race([network, delay(NAV_TIMEOUT_MS)]);
      if (early === SLOW) {
        const cached = await matchFromCache(request, url, true);
        if (cached) {
          // شبکه در پس‌زمینه ادامه می‌دهد تا کش برای دفعهٔ بعد تازه شود
          keepAlive(network.catch(() => {}));
          return cached;
        }
        fresh = await network;
      } else {
        fresh = early;
      }
    } else {
      fresh = await network;
    }
    if (fresh && !fresh.ok && isServerOutage(fresh) && (isNavigate || hashed)) {
      const cached = await matchFromCache(request, url, isNavigate);
      if (cached) return cached;
    }
    return fresh;
  } catch {
    const cached = await matchFromCache(request, url, isNavigate);
    if (cached) return cached;
    if (isNavigate) return navigationFallbackResponse();
    throw new Error("kamix-sw-cache-miss");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!shouldHandle(request, url)) return;
  event.respondWith(
    networkFirst(request, url, (promise) => {
      try {
        event.waitUntil(promise);
      } catch {
        /* noop */
      }
    }),
  );
});
