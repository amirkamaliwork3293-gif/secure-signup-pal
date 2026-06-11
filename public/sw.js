// ============================================================
// Self-destructing service worker — نسخه PWA حذف شده است.
// کلاینت‌هایی که هنوز سرویس‌ورکر قدیمی را دارند، با اولین بررسی
// آپدیت این نسخه را می‌گیرند که خودش و همه کش‌ها را پاک می‌کند.
// ============================================================
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { /* noop */ }
      try {
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.navigate(c.url));
      } catch (e) { /* noop */ }
    })()
  );
});
