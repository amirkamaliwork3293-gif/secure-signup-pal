/* ============================================================
 * Capacitor app-shell worker — فقط وقتی از اپ اندروید ثبت می‌شود.
 *
 * استراتژی: Network First, Cache Fallback
 *   ۱) همیشه اول شبکه (تا بعد از دیپلوی، نسخهٔ تازه دیده شود)
 *   ۲) فقط اگر شبکه واقعاً fail شود (نه کند، نه HTTP error) از کش
 *
 * این همان مشکلی را تکرار نمی‌کند که PWA قبلی را حذف کرد:
 *   - Cache First نیست
 *   - روی سایت/مرورگر ثبت نمی‌شود (register فقط با isCapacitor)
 *   - کش نسخه‌دار است و با آپدیت SW کش قدیمی پاک می‌شود
 *   - خودِ اسکریپت SW با updateViaCache:'none' همیشه از شبکه چک می‌شود
 * ============================================================ */
/* eslint-disable no-restricted-globals */
const SHELL_CACHE_VERSION = "v1";
const CACHE_NAME = "kamix-capacitor-shell-" + SHELL_CACHE_VERSION;
const HEALTH_PARAM = "kamix-health";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/", { cache: "reload" });
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", res.clone());
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

function shouldHandle(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.searchParams.has(HEALTH_PARAM)) return false;
  if (url.pathname.endsWith(".apk")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

async function networkFirst(request, url) {
  const isNavigate = request.mode === "navigate" || request.destination === "document";
  try {
    const fresh = await fetch(isNavigate ? new Request(request, { cache: "reload" }) : request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isNavigate) {
      const start = await caches.match("/");
      if (start) return start;
      const index = await caches.match(url.origin + "/");
      if (index) return index;
    }
    throw err;
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
