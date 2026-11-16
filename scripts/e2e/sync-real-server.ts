/**
 * آزمون سرتاسری همگام‌سازی: همان store.ts برنامه روی دو «دستگاه»، با supabase-js
 * واقعی → PostgREST واقعی → PostgreSQL واقعی که مهاجرت‌های پروژه رویش اجرا شده.
 * چیزی که تست‌های شبیه‌سازی‌شده نمی‌توانند ثابت کنند این‌جا سنجیده می‌شود: نام و
 * قالب پارامترهای RPC، قالب زمان و عدد در JSON، RLS، و خود توابع SQL.
 *
 * اجرا: scripts/e2e/run-real-server.sh   (فقط روی PostgreSQL آزمایشی محلی)
 */
import assert from "node:assert/strict";

const realSetTimeout = setTimeout;
const sleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));

const env = await import("../fakes/browser-env.ts");
const { onDevice, advance } = env;
const { supabase, wire, USER_ID } = await import("./real-supabase-client.ts");

type Store = typeof import("../../src/lib/store.ts");
type Row = Record<string, unknown>;
const MODE = process.env.E2E_MODE ?? "delta";
const tag = `[real server · ${MODE}]`;

let instance = 0;
async function newDevice(name: string) {
  instance += 1;
  const s = (await import(`../../src/lib/store.ts?e2e=${name}-${instance}`)) as Store;
  return { name, s };
}
type Device = Awaited<ReturnType<typeof newDevice>>;
const on = <T>(d: Device, fn: (s: Store) => T | Promise<T>): Promise<T> =>
  Promise.resolve(onDevice(d.name, () => fn(d.s)));

/** تایمرهای برنامه (ساعت جعلی) و شبکهٔ واقعی را با هم جلو می‌برد تا شرط برقرار شود */
async function until(what: string, cond: () => boolean | Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    await advance(400);
    await sleep(25);
    if (await cond()) return;
    if (Date.now() > end) assert.fail(`${tag} timed out waiting for: ${what}`);
  }
}
async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await advance(700);
    await sleep(30);
  }
}
async function serverRow(): Promise<Row> {
  const { data, error } = await supabase
    .from("user_data")
    .select("*")
    .eq("user_id", USER_ID)
    .maybeSingle();
  assert.equal(error, null, `${tag} reading the server row failed`);
  return (data ?? {}) as Row;
}
const ids = (list: unknown) =>
  (Array.isArray(list) ? list : []).map((r) => String((r as Row).id)).sort();
async function signIn(d: Device) {
  await on(d, async (s) => {
    s.setStorageScope(USER_ID);
    s.beginUserScope(USER_ID);
    await s.hydrateFromCloud(USER_ID);
  });
  await settle(6);
  assert.equal(await on(d, (s) => s.isCloudHydrated()), true, `${tag} ${d.name} did not hydrate`);
}
async function refresh(d: Device) {
  await on(d, (s) => s.refreshFromCloud());
  await settle(6);
}
const product = (id: string, extra: Row = {}) => ({
  id,
  name: `کالا ${id}`,
  price: 1000,
  category: "",
  code: "",
  stock: 5,
  ...extra,
});

// ── شروع: حساب روی سرور داده دارد (۳۰۰ کالا، یک مشتری) ──
const A = await newDevice("A");
const B = await newDevice("B");
await signIn(A);
await signIn(B);
assert.equal((await on(A, (s) => s.products.getAll())).length, 300, `${tag} A initial products`);
assert.equal((await on(B, (s) => s.products.getAll())).length, 300, `${tag} B initial products`);

// ۱) افزودن کالا روی A → روی B
wire.calls.length = 0;
await on(A, (s) => s.products.save([product("p-new") as never, ...s.products.getAll()]));
await until("the new product on the server", async () =>
  ids((await serverRow()).products).includes("p-new"),
);
const pushCalls = wire.calls.filter(
  (c) => c.method !== "GET" && c.sent > 0 && !c.path.includes("kamix_sync_pull"),
);
await refresh(B);
assert.ok(
  ids(await on(B, (s) => s.products.getAll())).includes("p-new"),
  `${tag} 1: B did not get the product`,
);
assert.equal((await on(B, (s) => s.products.getAll())).length, 301, `${tag} 1: B product count`);
const sentBytes = pushCalls.reduce((n, c) => n + c.sent, 0);
if (MODE === "delta") {
  assert.ok(
    pushCalls.every((c) => c.path.endsWith("/rpc/kamix_sync_push")),
    `${tag} 1: ${JSON.stringify(pushCalls)}`,
  );
  assert.ok(sentBytes < 1500, `${tag} 1: adding one product uploaded ${sentBytes} bytes`);
  const pulled = wire.calls.filter((c) => c.path.endsWith("/rpc/kamix_sync_pull"));
  assert.ok(pulled.length > 0, `${tag} 1: no delta pull`);
  const biggest = Math.max(...pulled.map((c) => c.got));
  assert.ok(biggest < 1500, `${tag} 1: a pull downloaded ${biggest} bytes`);
  assert.ok(
    !wire.calls.some((c) => c.method === "GET" && c.path === "/user_data" && c.got > 5000),
    `${tag} 1: a whole-row download happened`,
  );
  console.log(`  one new product (catalog of 300): ${sentBytes} bytes up, ${biggest} bytes down`);
} else {
  const down = Math.max(...wire.calls.filter((c) => c.method === "GET").map((c) => c.got));
  console.log(`  one new product (catalog of 300): ${sentBytes} bytes up, ${down} bytes down`);
}

// ۲) تراکنش هم‌زمان برای یک مشتری روی دو دستگاه
await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 300 }));
await on(B, (s) => s.customers.addTx("c1", { type: "debt", amount: 500 }));
await settle();
await refresh(A);
await refresh(B);
await settle();
for (const d of [A, B]) {
  const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
  assert.equal(c.txs.length, 3, `${tag} 2: ${d.name} has ${c.txs.length} txs`);
}
{
  const c = ((await serverRow()).customers as Row[]).find((x) => x.id === "c1")!;
  assert.equal((c.txs as unknown[]).length, 3, `${tag} 2: server txs`);
}

// ۳) حذف کالا و حذف تراکنش روی A به B می‌رسد و برنمی‌گردد
await on(A, (s) => s.products.remove(["p-new"]));
await on(A, (s) => s.customers.removeTx("c1", "t0"));
await settle();
await on(B, (s) => s.products.update({ ...s.products.findById("p-1")!, price: 4321 }));
await settle();
await refresh(B);
await refresh(A);
await settle();
for (const d of [A, B]) {
  assert.ok(
    !ids(await on(d, (s) => s.products.getAll())).includes("p-new"),
    `${tag} 3: ${d.name} deleted product is back`,
  );
  assert.equal(
    (await on(d, (s) => s.products.findById("p-1")))!.price,
    4321,
    `${tag} 3: ${d.name} price`,
  );
  const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
  assert.deepEqual(
    c.txs.map((t) => t.amount).sort(),
    [300, 500],
    `${tag} 3: ${d.name} txs`,
  );
}

// ۴) ثبت فاکتور روی B: فاکتور و موجودی روی A
await on(B, (s) => {
  const p = s.products.findById("p-2")!;
  s.invoice.save({
    ...s.invoice.getCurrent(),
    items: [{ productId: p.id, name: p.name, price: p.price, quantity: 2 }],
  });
  s.invoice.archive(s.recalc(s.invoice.getCurrent()));
});
await settle();
await refresh(A);
await settle();
for (const d of [A, B]) {
  assert.equal(
    (await on(d, (s) => s.invoice.getHistory())).length,
    1,
    `${tag} 4: ${d.name} invoices`,
  );
  assert.equal(
    (await on(d, (s) => s.products.findById("p-2")))!.stock,
    3,
    `${tag} 4: ${d.name} stock`,
  );
}

// ۵) تنظیمات: دو کلید مختلف روی دو دستگاه
await on(A, (s) => s.settings.save({ ...s.settings.get(), shopName: "نام تازه" }));
await on(B, (s) => s.settings.save({ ...s.settings.get(), invoiceFontSize: 17 }));
await settle();
await refresh(A);
await refresh(B);
for (const d of [A, B]) {
  const st = await on(d, (s) => s.settings.get());
  assert.equal(st.shopName, "نام تازه", `${tag} 5: ${d.name}`);
  assert.equal(st.invoiceFontSize, 17, `${tag} 5: ${d.name}`);
}

// ۶) اپ قدیمی کل ستون را مستقیم می‌نویسد؛ دستگاه‌های جدید می‌گیرند
{
  const row = await serverRow();
  const { error } = await supabase
    .from("user_data")
    .update({
      expenses: [{ id: "e-old-app", title: "اپ قدیمی", amount: 9, createdAt: 5 }],
      products: [product("p-old-app"), ...(row.products as Row[])],
    } as never)
    .eq("user_id", USER_ID);
  assert.equal(error, null, `${tag} 6: old-app write failed`);
}
await refresh(A);
await refresh(B);
await settle();
for (const d of [A, B]) {
  assert.deepEqual(
    ids(await on(d, (s) => s.expenses.getAll())),
    ["e-old-app"],
    `${tag} 6: ${d.name} expenses`,
  );
  assert.ok(
    ids(await on(d, (s) => s.products.getAll())).includes("p-old-app"),
    `${tag} 6: ${d.name} products`,
  );
}

// ۷) بستن و باز کردن برنامه روی B در حالی که A چیزی ثبت کرده
await on(B, (s) => s.stopCloudSync());
await on(A, (s) =>
  s.expenses.add({ ...s.emptyExpense(), id: "e-while-closed", title: "x", amount: 1 }),
);
await settle();
wire.calls.length = 0;
const B2 = await newDevice("B");
await signIn(B2);
assert.ok(
  ids(await on(B2, (s) => s.expenses.getAll())).includes("e-while-closed"),
  `${tag} 7: B missed a change made while closed`,
);
if (MODE === "delta") {
  assert.ok(
    !wire.calls.some((c) => c.method === "GET" && c.path === "/user_data" && c.got > 5000),
    `${tag} 7: restart downloaded the whole row`,
  );
}

// ۸) همه هم‌گام: دیگر هیچ نوشتنی روی سرور انجام نمی‌شود و دو دستگاه یکسان‌اند
await settle();
await refresh(A);
await refresh(B2);
await settle();
const before = (await serverRow()).updated_at;
for (let i = 0; i < 3; i++) {
  await refresh(A);
  await refresh(B2);
}
assert.equal(
  (await serverRow()).updated_at,
  before,
  `${tag} 8: idle devices kept writing to the server`,
);
for (const d of [A, B2]) {
  assert.equal(
    await on(d, (s) => s.hasUnsyncedChanges()),
    false,
    `${tag} 8: ${d.name} has unsynced changes`,
  );
}
const snapshot = (s: Store) => ({
  p: s.products.getAll(),
  c: s.customers.getAll(),
  e: s.expenses.getAll(),
  i: s.invoice.getHistory(),
});
const norm = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => {
    if (Array.isArray(x)) {
      return [...x].sort((m, n) => (String((m as Row)?.id) < String((n as Row)?.id) ? -1 : 1));
    }
    if (!x || typeof x !== "object") return x;
    const out: Row = {};
    for (const k of Object.keys(x as Row).sort()) out[k] = (x as Row)[k];
    return out;
  });
assert.equal(
  norm(await on(A, snapshot)),
  norm(await on(B2, snapshot)),
  `${tag} 8: the two devices show different data`,
);

console.log(`✓ ${tag} end-to-end sync passed`);
process.exit(0);
