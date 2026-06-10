// ============================================================
// Service Worker — حساب‌بان کمالی
// نسخه باید هر بار که فایل‌ها تغییر کنند عوض شود
// ============================================================
const CACHE_NAME = "kamali-v1";

// فایل‌هایی که باید آفلاین کار کنند
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// ── نصب: فایل‌های اصلی را کش کن ──────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  // فوری فعال شو — منتظر بسته شدن تب‌های قدیمی نمان
  self.skipWaiting();
});

// ── فعال‌سازی: کش‌های قدیمی را پاک کن ─────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // بلافاصله همه تب‌ها را کنترل کن
  self.clients.claim();
});

// ── واکشی: Network-first با fallback به کش ───────────────────
self.addEventListener("fetch", (event) => {
  // فقط درخواست‌های GET را مدیریت کن
  if (event.request.method !== "GET") return;

  // درخواست‌های API را از کش رد کن (همیشه از شبکه بگیر)
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.hostname.includes("supabase")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // پاسخ موفق را در کش ذخیره کن
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // اگر شبکه نبود، از کش برگردان
        return caches.match(event.request).then(
          (cached) => cached || caches.match("/")
        );
      })
  );
});
