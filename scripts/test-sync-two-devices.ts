/**
 * شبیه‌سازی دو دستگاه با یک حساب (گوشی + مرورگر) روی یک سرور مشترک.
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-sync-two-devices.ts
 *
 * هر دستگاه نسخهٔ جدای store.ts با localStorage، تایمر و صف همگام‌سازی خودش است.
 * هر سناریو دو بار اجرا می‌شود:
 *   - سرور «کور» (هر نوشتن ستون را کامل جایگزین می‌کند): ثابت می‌کند خود برنامه بدون
 *     کمک تریگر هیچ داده‌ای را گم نمی‌کند.
 *   - سرور با ادغام شبیه تریگر 20261002120000 و ترتیب کلیدهای jsonb.
 */
import assert from "node:assert/strict";

const env = await import("./fakes/browser-env.ts");
const { onDevice, deviceStorage, advance, clock, timers, storageLimits } = env;
const { fake } = await import("./fakes/supabase-client.ts");

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
Date.now = () => T0 + clock.now;

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

async function on<T>(d: Device, fn: (s: Store) => T | Promise<T>): Promise<T> {
  return onDevice(d.name, () => fn(d.s));
}
async function settle(ms = 3000) {
  await advance(ms);
}
async function signIn(d: Device) {
  await on(d, async (s) => {
    fake.sessionUser = U;
    s.setStorageScope(U);
    s.beginUserScope(U);
    await s.hydrateFromCloud(U);
  });
  await settle();
}
async function refresh(d: Device) {
  await settle(2500); // refreshFromCloud waits 2s after this device's own push
  await on(d, (s) => s.refreshFromCloud());
  await settle();
}
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

// ─── سرور شبیه تریگر 20261002120000 ─────────────────────────────────────────
const ARRAY_COLS = [
  "products",
  "categories",
  "invoices",
  "customers",
  "students",
  "purchases",
  "expenses",
  "reminders",
  "accounts",
  "account_txs",
  "production",
  "manual_ledger",
];
function unionById(live: unknown, incoming: unknown): unknown[] {
  const inc = Array.isArray(incoming) ? incoming : [];
  const seen = new Set(inc.map((r) => (r as Row).id));
  const extra = (Array.isArray(live) ? live : []).filter((r) => !seen.has((r as Row).id));
  return [...inc, ...extra];
}
function jsonbKeyOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbKeyOrder);
  if (!v || typeof v !== "object") return v;
  const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const out: Row = {};
  for (const k of keys) out[k] = jsonbKeyOrder((v as Row)[k]);
  return out;
}
function triggerLikeMerge(old: Row, incoming: Row): Row {
  const next: Row = { ...old, ...incoming };
  const oldTs = ((old.settings as Row | undefined)?.catalogTombstones ?? {}) as Record<
    string,
    string[]
  >;
  if (incoming.settings && typeof incoming.settings === "object") {
    const newTs = ((incoming.settings as Row).catalogTombstones ?? {}) as Record<string, string[]>;
    const merged: Record<string, string[]> = {};
    for (const k of new Set([...Object.keys(oldTs), ...Object.keys(newTs)])) {
      merged[k] = [...new Set([...(oldTs[k] ?? []), ...(newTs[k] ?? [])])].sort();
    }
    next.settings = { ...(incoming.settings as Row), catalogTombstones: merged };
  }
  const tomb = ((next.settings as Row | undefined)?.catalogTombstones ?? {}) as Record<
    string,
    string[]
  >;
  for (const col of ARRAY_COLS) {
    if (!(col in incoming)) continue;
    let inc = incoming[col] as Row[];
    const nestedKey = col === "customers" ? "txs" : col === "students" ? "payments" : null;
    if (nestedKey && Array.isArray(inc) && Array.isArray(old[col])) {
      const gone = new Set(tomb[`${col}.${nestedKey}`] ?? []);
      inc = inc.map((row) => {
        const prev = (old[col] as Row[]).find((o) => o.id === row.id);
        if (!prev || !Array.isArray(prev[nestedKey]) || !Array.isArray(row[nestedKey])) return row;
        const have = new Set((row[nestedKey] as Row[]).map((t) => t.id));
        const add = (prev[nestedKey] as Row[]).filter(
          (t) => !have.has(t.id) && !gone.has(String(t.id)),
        );
        return add.length ? { ...row, [nestedKey]: [...(row[nestedKey] as Row[]), ...add] } : row;
      });
    }
    next[col] = unionById(old[col], inc);
  }
  return jsonbKeyOrder(next) as Row;
}

// ─── سناریوها ────────────────────────────────────────────────────────────────
async function freshWorld(serverMode: "blind" | "trigger") {
  for (const d of ["A", "B", "C"]) deviceStorage(d).clear();
  timers.clear();
  fake.rows.clear();
  fake.upserts.length = 0;
  fake.gate = null;
  fake.beforeWrite = null;
  fake.serverMerge = serverMode === "trigger" ? triggerLikeMerge : null;
  fake.rows.set(U, {
    user_id: U,
    products: [product("p1"), product("p2")],
    customers: [
      {
        id: "c1",
        firstName: "رضا",
        createdAt: 1,
        txs: [{ id: "t0", type: "debt", amount: 1000, at: 1 }],
      },
    ],
    settings: { shopName: "فروشگاه" },
  });
  const A = await newDevice("A");
  const B = await newDevice("B");
  await signIn(A);
  await signIn(B);
  return { A, B };
}

/** با KEEP_GOING=1 همهٔ سناریوها اجرا و شکست‌ها گزارش می‌شوند (برای اجرا روی کد قدیمی) */
const failures: string[] = [];
async function scenario(fn: () => Promise<void>) {
  if (!process.env.KEEP_GOING) return fn();
  try {
    await fn();
  } catch (e) {
    failures.push((e as Error).message.split("\n")[0]);
  }
}

async function run(serverMode: "blind" | "trigger") {
  const tag = `[${serverMode}]`;

  // ۱) کالای تازهٔ دستگاه A با ذخیرهٔ دستگاهِ کهنهٔ B از سرور پاک نمی‌شود
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.save([...s.products.getAll(), product("pA")]));
    await settle();
    await on(B, (s) => s.products.save([...s.products.getAll(), product("pB")]));
    await settle();
    assert.deepEqual(
      ids(server().products),
      ["p1", "p2", "pA", "pB"],
      `${tag} 1: server lost a product`,
    );
    await refresh(A);
    assert.deepEqual(
      ids(await on(A, (s) => s.products.getAll())),
      ["p1", "p2", "pA", "pB"],
      `${tag} 1: A missing B's product`,
    );
    assert.deepEqual(
      ids(await on(B, (s) => s.products.getAll())),
      ["p1", "p2", "pA", "pB"],
      `${tag} 1: B missing A's product`,
    );
  });

  // ۲) ثبت هم‌زمان بدهی/پرداخت برای یک مشتری روی دو دستگاه — هیچ تراکنشی گم نمی‌شود
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 300 }));
    await settle();
    await on(B, (s) => s.customers.addTx("c1", { type: "debt", amount: 500 }));
    await settle();
    await refresh(A);
    for (const d of [A, B]) {
      const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
      assert.equal(c.txs.length, 3, `${tag} 2: ${d.name} has ${c.txs.length} txs, expected 3`);
      assert.equal(await on(d, (s) => s.customerBalance(c)), 1200, `${tag} 2: ${d.name} balance`);
    }
    const sc = (server().customers as Row[]).find((x) => x.id === "c1")!;
    assert.equal((sc.txs as unknown[]).length, 3, `${tag} 2: server lost a tx`);
  });

  // ۳) فرم ویرایش مشتری که قبل از رسیدن تراکنش باز شده، تراکنش را پاک نمی‌کند
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    const stale = await on(B, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
    await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 200 }));
    await settle();
    await refresh(B);
    await on(B, (s) => s.customers.update({ ...stale, phone: "09120000000" }));
    await settle();
    await refresh(A);
    for (const d of [A, B]) {
      const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
      assert.equal(c.txs.length, 2, `${tag} 3: ${d.name} lost the payment`);
      assert.equal(c.phone, "09120000000", `${tag} 3: ${d.name} lost the phone edit`);
    }
  });

  // ۴) حذف صریح روی A به B می‌رسد و ذخیرهٔ کهنهٔ B آن را برنمی‌گرداند
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.remove(["p1"]));
    await settle();
    await on(B, (s) =>
      s.products.save(s.products.getAll().map((p) => (p.id === "p2" ? { ...p, price: 2500 } : p))),
    );
    await settle();
    await refresh(A);
    await refresh(B);
    for (const d of [A, B]) {
      const list = await on(d, (s) => s.products.getAll());
      assert.deepEqual(ids(list), ["p2"], `${tag} 4: ${d.name} products ${ids(list)}`);
      assert.equal(list[0].price, 2500, `${tag} 4: ${d.name} lost the price edit`);
    }
  });

  // ۵) حذف یک تراکنش روی A با ذخیرهٔ کهنهٔ همان مشتری روی B برنمی‌گردد
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.customers.removeTx("c1", "t0"));
    await settle();
    await on(B, (s) => s.customers.addTx("c1", { type: "debt", amount: 70 }));
    await settle();
    await refresh(A);
    await refresh(B);
    for (const d of [A, B]) {
      const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
      assert.deepEqual(
        c.txs.map((t) => t.amount),
        [70],
        `${tag} 5: ${d.name} txs ${JSON.stringify(c.txs)}`,
      );
    }
  });

  // ۶) نوشتن دستگاه دیگر درست پیش از رسیدن ذخیرهٔ B (اپ قدیمی، upsert کور) گم نمی‌شود
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    let injected = false;
    fake.beforeWrite = () => {
      if (injected) return;
      injected = true;
      fake.externalWrite(U, {
        reminders: [{ id: "r-old-app", title: "از اپ قدیمی", dueAt: 1, done: false, createdAt: 1 }],
      });
    };
    await on(B, (s) => s.reminders.add({ title: "از B", dueAt: Date.now() + 86_400_000 }));
    await settle();
    fake.beforeWrite = null;
    const titles = (server().reminders as Row[]).map((r) => r.title).sort();
    assert.deepEqual(
      titles,
      ["از B", "از اپ قدیمی"].sort(),
      `${tag} 6: server reminders ${titles}`,
    );
    await refresh(A);
    assert.equal((await on(A, (s) => s.reminders.getAll())).length, 2, `${tag} 6: A reminders`);
  });

  // ۷) پاک شدن کامل حافظهٔ WebView روی B و باز کردن دوبارهٔ اپ: هیچ چیز گم نمی‌شود
  //    و دستگاه خالی هرگز روی سرور نمی‌نویسد
  await scenario(async () => {
    const { A } = await freshWorld(serverMode);
    await on(A, (s) => s.products.save([...s.products.getAll(), product("pA")]));
    await settle();
    deviceStorage("B").clear();
    const before = fake.upserts.length;
    const B2 = await newDevice("B");
    await signIn(B2);
    assert.deepEqual(
      ids(await on(B2, (s) => s.products.getAll())),
      ["p1", "p2", "pA"],
      `${tag} 7: reinstalled B`,
    );
    assert.deepEqual(ids(server().products), ["p1", "p2", "pA"], `${tag} 7: server`);
    assert.ok(
      fake.upserts
        .slice(before)
        .every(
          (u) =>
            !Array.isArray(u.payload.products) || (u.payload.products as unknown[]).length >= 3,
        ),
      `${tag} 7: empty device uploaded a shorter product list`,
    );
  });

  // ۸) وقتی همه هم‌گام‌اند، دریافت‌های دوره‌ای هیچ آپلودی نمی‌سازند (بدون رفت‌وبرگشت)
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 1 }));
    await settle();
    await refresh(B);
    await refresh(A);
    const before = fake.upserts.length;
    for (let i = 0; i < 3; i++) {
      fake.rows.get(U)!.updated_at = new Date(Date.now() + i).toISOString(); // سیگنال تغییر بدون تغییر داده
      await refresh(A);
      await refresh(B);
    }
    const extra = fake.upserts.slice(before);
    assert.equal(
      extra.length,
      0,
      `${tag} 8: idle devices uploaded ${extra.length} times: ${extra.map((u) => Object.keys(u.payload).join("+")).join(" | ")}`,
    );
  });

  if (!failures.length) console.log(`✓ ${tag} two-device sync scenarios passed`);
}

await run("blind");
await run("trigger");
void storageLimits;
if (failures.length) {
  console.log(failures.map((f) => `✗ ${f}`).join("\n"));
  process.exit(1);
}
