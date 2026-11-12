/**
 * تجمیع ذخیرهٔ ابری (کاهش مصرف Disk IO سوپابیس) بدون به خطر انداختن داده.
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-store-push-batching.ts
 *
 * ۱) چند تغییر پشت سر هم فقط یک نوشتن روی سرور می‌سازد و آخرین نسخه می‌نشیند.
 * ۲) تغییرهای بی‌وقفه (تایپ مداوم) حداکثر بعد از CLOUD_PUSH_MAX_WAIT_MS فرستاده می‌شوند.
 * ۳) خروج از حساب درست بعد از ثبت، بدون انتظار برای تایمر همه چیز را می‌فرستد.
 * ۴) ثبت نهایی فاکتور منتظر تایمر نمی‌ماند.
 */
import assert from "node:assert/strict";

const { localStorage, advance, clock } = await import("./fakes/browser-env.ts");
const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);
Date.now = () => T0 + clock.now; // ساعت برنامه هم‌پای تایمرهای جعلی
const { fake } = await import("./fakes/supabase-client.ts");
const store = await import("../src/lib/store.ts");
const {
  products,
  hydrateFromCloud,
  beginUserScope,
  setStorageScope,
  flushPendingCloudWrites,
  CLOUD_PUSH_DEBOUNCE_MS,
  CLOUD_PUSH_MAX_WAIT_MS,
} = store;

const U = "user-batch";
const product = (id: string, price = 1000) => ({
  id,
  name: id,
  price,
  category: "",
  code: "",
  stock: 5,
});
const serverIds = () =>
  ((fake.rows.get(U)!.products as { id: string }[]) ?? []).map((p) => p.id).sort();
const productWrites = () => fake.upserts.filter((u) => u.ok && "products" in u.payload).length;

localStorage.clear();
fake.rows.set(U, { user_id: U, products: [product("p1")], settings: { shopName: "S" } });
fake.sessionUser = U;
setStorageScope(U);
beginUserScope(U);
await hydrateFromCloud(U);
await advance(10_000);

// ۱) پنج تغییر پشت سر هم → یک نوشتن
let before = productWrites();
for (let i = 2; i <= 6; i++) {
  products.save([...products.getAll(), product(`p${i}`)]);
  await advance(200);
}
assert.equal(productWrites() - before, 0, "must wait for the batch window");
await advance(CLOUD_PUSH_DEBOUNCE_MS + 100);
assert.equal(productWrites() - before, 1, "rapid edits must be saved with one write");
assert.deepEqual(serverIds(), ["p1", "p2", "p3", "p4", "p5", "p6"]);
assert.equal(store.hasUnsyncedChanges(), false, "nothing left unsynced");

// ۲) تغییر مداوم (هر ۵۰۰ms) → حداکثر بعد از MAX_WAIT فرستاده می‌شود
before = productWrites();
let n = 0;
for (let t = 0; t <= CLOUD_PUSH_MAX_WAIT_MS + 1000; t += 500) {
  n += 1;
  products.save(products.getAll().map((p) => (p.id === "p1" ? { ...p, price: 1000 + n } : p)));
  await advance(500);
}
assert.ok(productWrites() - before >= 1, "continuous edits must still reach the server");
await advance(CLOUD_PUSH_DEBOUNCE_MS + 100);
const p1 = (fake.rows.get(U)!.products as { id: string; price: number }[]).find((p) => p.id === "p1")!;
assert.equal(p1.price, 1000 + n, "latest value must be on the server");
assert.ok(
  productWrites() - before <= Math.ceil((n * 500) / CLOUD_PUSH_MAX_WAIT_MS) + 1,
  `too many writes for continuous editing: ${productWrites() - before}`,
);

// ۳) خروج بلافاصله بعد از ثبت
products.save([...products.getAll(), product("p-last")]);
const ok = await flushPendingCloudWrites(5000);
assert.equal(ok, true, "sign-out flush must finish");
assert.ok(serverIds().includes("p-last"), "last change must reach the server before sign-out");

// ۴) dirty marker همان لحظه در حافظهٔ دستگاه است (بستن برنامه پیش از تایمر چیزی گم نمی‌کند)
products.save([...products.getAll(), product("p-crash")]);
assert.ok(
  (localStorage.getItem(`acc.cloudDirty.v1:${U}`) ?? "").includes("products"),
  "unsynced marker must be persisted immediately",
);
await advance(CLOUD_PUSH_DEBOUNCE_MS + 100);
assert.ok(serverIds().includes("p-crash"));

console.log("store push-batching tests passed");
