/**
 * همگام‌سازی تنظیمات بین دستگاه‌های یک اکانت (F4).
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-store-settings-sync.ts
 *
 * ۱) تغییر تنظیمات روی دستگاه دیگر به این دستگاه می‌رسد و این دستگاه آن را برنمی‌گرداند.
 * ۲) دستگاهِ بیکار با نشانهٔ کهنهٔ «تغییر ذخیره‌نشده» تنظیمات ابر را بازنویسی نمی‌کند.
 * ۳) تغییر واقعیِ ذخیره‌نشدهٔ این دستگاه فقط برای همان کلید برنده است.
 * ۴) حذف‌ها (catalogTombstones) در ادغام گم نمی‌شوند.
 */
import assert from "node:assert/strict";

const { localStorage, advance } = await import("./fakes/browser-env.ts");
const { fake } = await import("./fakes/supabase-client.ts");
const { settings, products, hydrateFromCloud, beginUserScope, setStorageScope, stopCloudSync } =
  await import("../src/lib/store.ts");

const U = "user-a";
type S = Record<string, unknown>;
const cloud = () => fake.rows.get(U)!.settings as S;
const setCloud = (patch: S) => {
  fake.rows.get(U)!.settings = { ...cloud(), ...patch };
};

async function signIn() {
  fake.sessionUser = U;
  setStorageScope(U);
  beginUserScope(U);
  await hydrateFromCloud(U);
  await advance(10_000);
}
/** بستن برنامه / قطع شبکه: دیگر چیزی بالا نمی‌رود، ولی اسکوپ همین کاربر است. */
const goOffline = () => stopCloudSync();

fake.rows.set(U, {
  user_id: U,
  products: [{ id: "p1", name: "Tea", price: 1, category: "", code: "", stock: 1 }],
  settings: { shopName: "S", currencyUnit: "toman", invoiceFontSize: 13 },
});
await signIn();
assert.equal(settings.get().currencyUnit, "toman");

// ─── ۱) تغییر دستگاه دیگر می‌رسد و برگردانده نمی‌شود ────────────────────────
setCloud({ currencyUnit: "rial" }); // گوشی دیگر واحد را ریال کرد
goOffline();
await signIn();
assert.equal(settings.get().currencyUnit, "rial", "other device's setting did not arrive");
assert.equal(cloud().currencyUnit, "rial", "this device reverted the other device's setting");

// ─── ۲) دستگاه بیکار با نشانهٔ کهنهٔ dirty (نسخهٔ قبلی برنامه) ───────────────
goOffline();
localStorage.setItem(`acc.cloudDirty.v1:${U}`, JSON.stringify(["settings"]));
setCloud({ currencyUnit: "toman", invoicePaperSize: "A5" }); // دوباره روی گوشی دیگر عوض شد
await signIn();
assert.equal(settings.get().currencyUnit, "toman");
assert.equal(settings.get().invoicePaperSize, "A5");
assert.equal(cloud().currencyUnit, "toman", "idle stale phone overrode the server");

// ─── ۳) تغییر واقعی ذخیره‌نشده فقط برای همان کلید برنده است ─────────────────
goOffline();
settings.save({ ...settings.get(), invoiceFontSize: 20 }); // کاربر آفلاین فونت را عوض کرد
assert.deepEqual(
  JSON.parse(localStorage.getItem(`acc.settingsDirtyKeys.v1:${U}`) ?? "[]"),
  ["invoiceFontSize"],
  "only the changed key may be marked unsaved",
);
setCloud({ shopName: "New name" }); // همزمان گوشی دیگر نام فروشگاه را عوض کرد
await signIn();
assert.equal(settings.get().invoiceFontSize, 20, "this device's unsaved change was lost");
assert.equal(settings.get().shopName, "New name", "other device's change was overridden");
assert.equal(cloud().invoiceFontSize, 20, "unsaved change never reached the server");
assert.equal(cloud().shopName, "New name");
assert.equal(
  localStorage.getItem(`acc.settingsDirtyKeys.v1:${U}`),
  null,
  "unsaved-keys marker must clear once the server confirms",
);

// بعد از تأیید، این دستگاه دیگر برای آن کلید برنده نیست
goOffline();
setCloud({ invoiceFontSize: 15 });
await signIn();
assert.equal(settings.get().invoiceFontSize, 15);
assert.equal(cloud().invoiceFontSize, 15);

// ─── ۴) حذف آفلاین با ادغامِ ابر-مرجع گم نمی‌شود ───────────────────────────
goOffline();
products.remove(["p1"]);
setCloud({ shopName: "Newer" });
await signIn();
assert.equal(products.getAll().length, 0, "deleted product came back");
assert.deepEqual(
  (cloud().catalogTombstones as S).products,
  ["p1"],
  "delete lost in settings merge",
);
assert.equal(cloud().shopName, "Newer");

console.log("store settings-sync tests passed");
