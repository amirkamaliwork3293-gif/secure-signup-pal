/**
 * اپ اندروید بدون اینترنت: ثبت روی گوشی، بدون هیچ درخواست شبکه، و بعد از وصل شدن
 * ادغام شناسه‌به‌شناسه با سرور — بدون گم شدن دادهٔ دستگاه دیگر.
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-offline-capacitor-sync.ts
 */
import assert from "node:assert/strict";

const env = await import("./fakes/browser-env.ts");
const { onDevice, deviceStorage, advance, timers } = env;
const { fake } = await import("./fakes/supabase-client.ts");

// اپ Capacitor + وضعیت شبکهٔ قابل کنترل
const net = { onLine: true };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    get onLine() {
      return net.onLine;
    },
    userAgent: "test",
  },
});
(globalThis as unknown as { window: Record<string, unknown> }).window.Capacitor = {
  isNativePlatform: () => true,
};

type Store = typeof import("../src/lib/store.ts");
type Row = Record<string, unknown>;
const U = "user-1";
let instance = 0;

async function newDevice(name: string): Promise<{ name: string; s: Store }> {
  instance += 1;
  const s = (await import(`../src/lib/store.ts?device=${name}-${instance}`)) as Store;
  return { name, s };
}
type Device = Awaited<ReturnType<typeof newDevice>>;
const on = <T>(d: Device, fn: (s: Store) => T | Promise<T>): Promise<T> =>
  onDevice(d.name, async () => fn(d.s));
const settle = (ms = 3000) => advance(ms);
const ids = (list: unknown) =>
  (Array.isArray(list) ? list : []).map((r) => (r as { id: string }).id).sort();
const server = () => fake.rows.get(U)!;
const product = (id: string, extra: Row = {}) => ({
  id,
  name: `کالا ${id}`,
  price: 1000,
  category: "",
  code: "",
  stock: 5,
  ...extra,
});
const invoiceRow = (id: string) => ({
  id,
  number: id,
  items: [],
  createdAt: 1,
  customer: { firstName: "", lastName: "", phone: "" },
});

async function signIn(d: Device) {
  await on(d, async (s) => {
    fake.sessionUser = U;
    s.setStorageScope(U);
    s.beginUserScope(U);
    await s.hydrateFromCloud(U);
  });
  await settle();
}

function freshWorld() {
  for (const d of ["A", "B"]) deviceStorage(d).clear();
  timers.clear();
  fake.rows.clear();
  fake.upserts.length = 0;
  fake.gate = null;
  fake.beforeWrite = null;
  fake.serverMerge = null;
  net.onLine = true;
  fake.rows.set(U, {
    user_id: U,
    products: [product("p1"), product("p2")],
    invoices: [invoiceRow("i0")],
    customers: [{ id: "c1", firstName: "رضا", createdAt: 1, txs: [] }],
    settings: { shopName: "فروشگاه" },
  });
}

/** همان کاری که AuthContext بعد از وصل شدن می‌کند: خواندن ابر، ادغام، ارسال صف */
async function reconnect(d: Device) {
  net.onLine = true;
  await on(d, async (s) => {
    await s.hydrateFromCloud(U);
  });
  await settle();
}

// ۱) آفلاین: ثبت آزاد است، روی گوشی می‌ماند و هیچ درخواستی به سرور نمی‌رود
{
  freshWorld();
  const A = await newDevice("A");
  await signIn(A);
  const writesBefore = fake.upserts.length;

  net.onLine = false;
  await on(A, (s) => {
    assert.equal(s.assertBusinessWriteAllowed(), true, "ثبت آفلاین باید آزاد باشد");
    s.products.save([...s.products.getAll(), product("pA")]);
    s.customers.add({ firstName: "مشتری", lastName: "آفلاین", phone: "09120000001" });
  });
  await settle(10_000);
  assert.equal(fake.upserts.length, writesBefore, "آفلاین هیچ نوشتنی به سرور نمی‌رود");
  assert.deepEqual(ids(await on(A, (s) => s.products.getAll())), ["p1", "p2", "pA"]);
  assert.equal(await on(A, (s) => s.hasUnsyncedChanges()), true);

  // دستگاه دیگر (آنلاین) در همین فاصله چیزی ثبت کرده
  fake.externalWrite(U, {
    products: [product("p1"), product("p2"), product("pB")],
    invoices: [invoiceRow("i0"), invoiceRow("iB")],
  });

  await reconnect(A);
  assert.deepEqual(ids(server().products), ["p1", "p2", "pA", "pB"], "کالای هر دو دستگاه روی سرور");
  assert.deepEqual(ids(server().invoices), ["i0", "iB"], "فاکتور دستگاه دیگر حفظ شد");
  const serverCustomers = server().customers as { firstName: string }[];
  assert.equal(serverCustomers.length, 2, "مشتری آفلاین به سرور رسید");
  assert.ok(serverCustomers.some((c) => c.firstName === "مشتری"));
  assert.deepEqual(ids(await on(A, (s) => s.products.getAll())), ["p1", "p2", "pA", "pB"]);
  assert.equal(await on(A, (s) => s.hasUnsyncedChanges()), false, "صف خالی شد");
}

// ۲) بستن و باز کردن برنامه در حالت آفلاین: ثبت‌ها نمی‌پرند و بعداً ارسال می‌شوند
{
  freshWorld();
  const A1 = await newDevice("A");
  await signIn(A1);
  net.onLine = false;
  await on(A1, (s) => s.products.save([...s.products.getAll(), product("pOffline")]));
  await settle();
  await on(A1, (s) => s.stopCloudSync());

  // اجرای تازهٔ برنامه روی همان گوشی (همان حافظه) هنوز آفلاین
  const A2 = await newDevice("A");
  await on(A2, (s) => {
    s.setStorageScope(U);
    s.beginUserScope(U);
  });
  assert.deepEqual(ids(await on(A2, (s) => s.products.getAll())), ["p1", "p2", "pOffline"]);
  assert.equal(await on(A2, (s) => s.hasUnsyncedChanges()), true);
  await on(A2, (s) => s.products.save([...s.products.getAll(), product("pOffline2")]));
  await settle();

  await reconnect(A2);
  assert.deepEqual(ids(server().products), ["p1", "p2", "pOffline", "pOffline2"]);
}

// ۳) ورود آفلاین (بدون نشست، offline-cached): فقط اسکوپ کاربر؛ بعد از ورود آنلاین ارسال
{
  freshWorld();
  const A1 = await newDevice("A");
  await signIn(A1);
  await on(A1, (s) => s.stopCloudSync()); // خروج

  net.onLine = false;
  const A2 = await newDevice("A");
  fake.sessionUser = null;
  await on(A2, (s) => s.setStorageScope(U)); // همان کاری که enterOfflineSession می‌کند
  await on(A2, (s) => {
    s.customers.add({ firstName: "ورود", lastName: "آفلاین", phone: "" });
  });
  await settle();
  const before = fake.upserts.length;
  await settle(10_000);
  assert.equal(fake.upserts.length, before);

  fake.externalWrite(U, { invoices: [invoiceRow("i0"), invoiceRow("iWeb")] });
  net.onLine = true;
  await on(A2, async (s) => {
    fake.sessionUser = U;
    s.beginUserScope(U);
    await s.hydrateFromCloud(U);
  });
  await settle();
  const names = (server().customers as { firstName: string }[]).map((c) => c.firstName).sort();
  assert.deepEqual(names, ["رضا", "ورود"]);
  assert.deepEqual(ids(server().invoices), ["i0", "iWeb"]);
}

// ۴) ثبت محلی هنگام آفلاین روی وب (رفتار قبلی سایت) تغییری نکرده: ثبت آزاد است
{
  const cap = (globalThis as unknown as { window: Record<string, unknown> }).window;
  const saved = cap.Capacitor;
  delete cap.Capacitor;
  freshWorld();
  const W = await newDevice("B");
  await signIn(W);
  net.onLine = false;
  await on(W, (s) => assert.equal(s.assertBusinessWriteAllowed(), true));
  cap.Capacitor = saved;
}

// ۵) اگر ذخیرهٔ فاکتور در فهرست رد شود، فاکتور باز بسته نمی‌شود (هیچ‌چیز گم نمی‌شود)
{
  freshWorld();
  const A = await newDevice("A");
  await signIn(A);
  const g = globalThis as unknown as { window: Record<string, unknown> };
  const prevAlert = g.window.alert;
  let alerted = "";
  g.window.alert = (m: string) => (alerted = m);
  await on(A, (s) => {
    const inv = s.addCustomInvoiceLine(s.emptyInvoice(), { name: "نان", price: 1000, quantity: 1 });
    s.invoice.save(inv);
    const before = s.invoice.getCurrent();
    // شبیه رد شدن نوشتن (اسکوپ حافظه با حساب ابری نمی‌خواند)
    const current = s.invoice.getCurrent();
    const histBefore = s.invoice.getHistory().length;
    localStorage.setItem("kamali.auth.scope.v1", "someone-else");
    const out = s.invoice.archive(current);
    localStorage.setItem("kamali.auth.scope.v1", U);
    assert.equal(out.id, before.id);
    assert.equal(s.invoice.getHistory().length, histBefore, "ذخیره نشد");
    assert.equal(s.invoice.getCurrent().id, before.id, "فاکتور باز سر جایش ماند");
    assert.equal(s.invoice.getCurrent().items.length, 1, "اقلام فاکتور باز گم نشد");
    // دوباره امتحان: این بار ذخیره می‌شود
    s.invoice.archive(s.invoice.getCurrent());
    assert.equal(s.invoice.getHistory().length, histBefore + 1);
  });
  assert.match(alerted, /فاکتور باز مانده/);
  g.window.alert = prevAlert;
}

console.log("offline-capacitor-sync: all checks passed");
