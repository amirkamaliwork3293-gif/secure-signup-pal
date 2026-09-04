/* ============================================================
 * Capacitor app-shell worker — فقط وقتی از اپ اندروید ثبت می‌شود.
 *
 * استراتژی: Network First, Cache Fallback
 *   ۱) همیشه اول شبکه (تا بعد از دیپلوی، نسخهٔ تازه دیده شود)
 *   ۲) فقط اگر شبکه واقعاً fail شود (نه کند، نه HTTP error) از کش
 *
 * ناوبری سند (باز شدن هر مسیر): هرگز به WebView «Webpage not available»
 * برنگردد — یا پوستهٔ کش‌شده یا HTML فارسی داخلی.
 *
 * این همان مشکلی را تکرار نمی‌کند که PWA قبلی را حذف کرد:
 *   - Cache First نیست
 *   - روی سایت/مرورگر ثبت نمی‌شود (register فقط با isCapacitor)
 *   - کش نسخه‌دار است و با آپدیت SW کش قدیمی پاک می‌شود
 *   - خودِ اسکریپت SW با updateViaCache:'none' همیشه از شبکه چک می‌شود
 * ============================================================ */
const SHELL_CACHE_VERSION = "v1";
const CACHE_NAME = "kamix-capacitor-shell-" + SHELL_CACHE_VERSION;
const HEALTH_PARAM = "kamix-health";
const SHELL_PATH = "/__kamix_app_shell__";

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

function shouldHandle(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.searchParams.has(HEALTH_PARAM)) return false;
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

async function networkFirst(request, url) {
  const isNavigate = isNavigationRequest(request);
  try {
    const fresh = await fetch(isNavigate ? new Request(request, { cache: "reload" }) : request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone()).catch(() => {});
      if (isNavigate) rememberShell(cache, fresh.clone()).catch(() => {});
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
  event.respondWith(networkFirst(request, url));
});
