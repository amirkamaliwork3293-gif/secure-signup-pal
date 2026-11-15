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
/**
 * blind / trigger: سرور قبل از مهاجرت 20261115120000 (روش کل‌ستون).
 * delta / delta-trigger: همان مهاجرت نصب است (ارسال و دریافت «فقط تغییرات»)،
 * بدون / با تریگر محافظ 20261002120000.
 */
type ServerMode = "blind" | "trigger" | "delta" | "delta-trigger";
const isDelta = (m: ServerMode) => m.startsWith("delta");

async function freshWorld(serverMode: ServerMode) {
  for (const d of ["A", "B", "C"]) deviceStorage(d).clear();
  timers.clear();
  fake.rows.clear();
  fake.upserts.length = 0;
  fake.gate = null;
  fake.beforeWrite = null;
  fake.serverMerge = serverMode.endsWith("trigger") ? triggerLikeMerge : null;
  fake.delta = isDelta(serverMode);
  fake.rowSeq.clear();
  fake.rpcCalls.length = 0;
  fake.selects.length = 0;
  fake.rpcError = null;
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

async function run(serverMode: ServerMode) {
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

  // ۹) خروج بلافاصله بعد از ثبت: صف ذخیره پیش از خروج فرستاده می‌شود
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) =>
      s.expenses.add({ ...s.emptyExpense(), id: "e-last", title: "آخرین", amount: 9 }),
    );
    const synced = await on(A, (s) => s.flushPendingCloudWrites(5000));
    assert.equal(synced, true, `${tag} 9: flush before sign-out did not finish`);
    assert.deepEqual(ids(server().expenses), ["e-last"], `${tag} 9: last change lost on sign-out`);
    await refresh(B);
    assert.deepEqual(ids(await on(B, (s) => s.expenses.getAll())), ["e-last"], `${tag} 9: B`);
  });

  // ۱۰) خروج در حالت آفلاین: تغییر روی دستگاه می‌ماند و ورود بعدی آن را می‌فرستد
  await scenario(async () => {
    const { A } = await freshWorld(serverMode);
    const release = fake.hold();
    await on(A, (s) =>
      s.expenses.add({ ...s.emptyExpense(), id: "e-off", title: "آفلاین", amount: 5 }),
    );
    const pending = on(A, (s) => s.flushPendingCloudWrites(4000));
    await settle(5000);
    assert.equal(await pending, false, `${tag} 10: offline flush must report unsynced`);
    await on(A, (s) => s.stopCloudSync());
    release();
    await settle();
    // اپ بسته و دوباره باز می‌شود (نسخهٔ تازهٔ store روی همان حافظه)
    const A2 = await newDevice("A");
    await signIn(A2);
    await settle(3000);
    assert.ok(
      ids(server().expenses).includes("e-off"),
      `${tag} 10: offline change never reached server`,
    );
  });

  // ۱۱) حافظهٔ دستگاه پر است: ثبت تازه گم نمی‌شود و به سرور می‌رسد
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    storageLimits.maxChars = 0; // هر setItem تازه رد می‌شود
    try {
      await on(A, (s) => s.products.save([...s.products.getAll(), product("p-full")]));
      assert.ok(
        ids(await on(A, (s) => s.products.getAll())).includes("p-full"),
        `${tag} 11: write lost when storage is full`,
      );
      await settle();
      assert.ok(ids(server().products).includes("p-full"), `${tag} 11: not sent to server`);
      assert.equal(
        (await on(A, (s) => s.getSyncState())).localStorageFull,
        true,
        `${tag} 11: no warning`,
      );
    } finally {
      storageLimits.maxChars = Infinity;
    }
    await refresh(B);
    assert.ok(ids(await on(B, (s) => s.products.getAll())).includes("p-full"), `${tag} 11: B`);
  });

  // ۱۲) سیگنال لحظه‌ای: تغییر A بدون هیچ رفرش دستی (و بدون دریافت دوره‌ای) به B می‌رسد
  await scenario(async () => {
    fake.realtime = true;
    try {
      const { A, B } = await freshWorld(serverMode);
      await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 400 }));
      await settle(6000); // ذخیرهٔ A + سیگنال + دریافت B (تایمر ۴۰ ثانیه‌ای در محیط تست خاموش است)
      const c = await on(B, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
      assert.equal(c.txs.length, 2, `${tag} 12: realtime signal did not bring A's payment to B`);
    } finally {
      fake.realtime = false;
    }
  });

  // ۱۳) حذف قلم از فاکتور باز (پیش‌نویس) روی A با دستگاهِ کهنهٔ B برنمی‌گردد
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    const item = (id: string) => ({ productId: id, name: id, price: 1000, quantity: 1 });
    await on(A, (s) =>
      s.invoice.save({ ...s.invoice.getCurrent(), items: [item("x"), item("y"), item("z")] }),
    );
    await settle();
    await refresh(B);
    assert.equal(
      (await on(B, (s) => s.invoice.getCurrent())).items.length,
      3,
      `${tag} 13: B draft`,
    );
    await on(A, (s) => {
      const cur = s.invoice.getCurrent();
      s.invoice.save({ ...cur, items: cur.items.filter((i) => i.productId !== "y") });
    });
    await settle();
    await refresh(B);
    await refresh(A);
    for (const d of [A, B]) {
      const ids = (await on(d, (s) => s.invoice.getCurrent())).items.map((i) => i.productId);
      assert.deepEqual(ids, ["x", "z"], `${tag} 13: ${d.name} draft items came back: ${ids}`);
    }
  });

  // ۱۴) حذف قلم از فاکتور باز وقتی دستگاه دیگری هم‌زمان چیزی ذخیره کرده (ادغام پس از تعارض)
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    const item = (id: string) => ({ productId: id, name: id, price: 1000, quantity: 1 });
    await on(A, (s) =>
      s.invoice.save({ ...s.invoice.getCurrent(), items: [item("x"), item("y")] }),
    );
    await settle();
    await on(B, (s) => s.reminders.add({ title: "از B", dueAt: Date.now() + 86_400_000 }));
    await settle();
    await on(A, (s) => {
      const cur = s.invoice.getCurrent();
      s.invoice.save({ ...cur, items: cur.items.filter((i) => i.productId !== "y") });
    });
    await settle();
    const ids = (await on(A, (s) => s.invoice.getCurrent())).items.map((i) => i.productId);
    assert.deepEqual(ids, ["x"], `${tag} 14: deleted draft item came back after conflict: ${ids}`);
  });

  // ۱۵) بعد از حذف کالا/تراکنش، دو دستگاه باز نباید با هر دریافت دوباره کل ستون را
  //     بفرستند. سرور ردیف حذف‌شده را نگه می‌دارد (حذف نرم، تریگر 20261002120000) و
  //     هر آپلود updated_at را عوض می‌کند، پس دستگاه دیگر دوباره دریافت و آپلود می‌کرد:
  //     حلقهٔ بی‌پایان رفت‌وبرگشت که سهمیهٔ Disk IO سوپابیس را تمام می‌کرد.
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.remove(["p1"]));
    await on(A, (s) => s.customers.removeTx("c1", "t0"));
    await settle();
    await refresh(B);
    await refresh(A);
    const before = fake.upserts.length;
    for (let i = 0; i < 4; i++) {
      // هر دو دستگاه به نوبت (مثل سیگنال لحظه‌ای / دریافت دوره‌ای) سرور را می‌خوانند
      fake.rows.get(U)!.updated_at = new Date(Date.now() + i).toISOString();
      await refresh(B);
      await refresh(A);
    }
    const extra = fake.upserts.slice(before);
    assert.equal(
      extra.length,
      0,
      `${tag} 15: devices kept uploading after a delete (${extra.length}): ${extra
        .slice(0, 4)
        .map((u) => Object.keys(u.payload).join("+"))
        .join(" | ")}`,
    );
    // حذف همچنان روی همهٔ دستگاه‌ها (و دستگاه تازه) برقرار است
    const C = await newDevice("C");
    await signIn(C);
    for (const d of [A, B, C]) {
      assert.deepEqual(
        ids(await on(d, (s) => s.products.getAll())),
        ["p2"],
        `${tag} 15: ${d.name} deleted product came back`,
      );
      const c = await on(d, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
      assert.equal(c.txs.length, 0, `${tag} 15: ${d.name} deleted tx came back`);
    }
    // دادهٔ حذف‌شده روی سرور قابل بازیابی می‌ماند (حذف نرم)
    if (serverMode !== "blind") {
      assert.ok(ids(server().products).includes("p1"), `${tag} 15: server must keep p1 (soft delete)`);
    }
  });

  if (isDelta(serverMode)) await runDeltaOnly(serverMode, tag);

  if (!failures.length) console.log(`✓ ${tag} two-device sync scenarios passed`);
}

/** سناریوهای مخصوص همگام‌سازی «فقط تغییرات» */
async function runDeltaOnly(serverMode: ServerMode, tag: string) {
  const pushes = () => fake.rpcCalls.filter((c) => c.name === "kamix_sync_push");
  const pulls = () => fake.rpcCalls.filter((c) => c.name === "kamix_sync_pull");
  const bytes = (v: unknown) => JSON.stringify(v ?? null).length;
  const bigCatalog = () =>
    Array.from({ length: 400 }, (_, i) => product(`big-${i}`, { name: `کالای حجیم شمارهٔ ${i}` }));

  // D1) با ۴۰۰ کالا روی سرور، افزودن یک کالا فقط همان یک ردیف را می‌فرستد و دستگاه
  //     دیگر فقط همان یک ردیف را می‌گیرد (نه کل ستون و نه کل ردیف)
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.save([...s.products.getAll(), ...bigCatalog()]));
    await settle();
    await refresh(B);
    assert.equal((await on(B, (s) => s.products.getAll())).length, 402, `${tag} D1: B catalog`);
    fake.rpcCalls.length = 0;
    fake.selects.length = 0;
    const writesBefore = fake.upserts.length;
    await on(A, (s) => s.products.save([product("p-new"), ...s.products.getAll()]));
    await settle();
    await refresh(B);
    const sent = pushes();
    assert.equal(sent.length, 1, `${tag} D1: expected one push, got ${sent.length}`);
    const sentRows = ((sent[0].args.p as Row).rows as Row).products as Row[];
    assert.deepEqual(ids(sentRows), ["p-new"], `${tag} D1: pushed rows ${ids(sentRows)}`);
    assert.ok(bytes(sent[0].args) < 400, `${tag} D1: push is ${bytes(sent[0].args)} bytes`);
    const got = pulls().filter((c) => (c.result as Row)?.fields && bytes((c.result as Row).fields) > 2);
    assert.equal(got.length, 1, `${tag} D1: expected one non-empty pull, got ${got.length}`);
    assert.ok(bytes(got[0].result) < 600, `${tag} D1: pull is ${bytes(got[0].result)} bytes`);
    assert.deepEqual(fake.selects, [], `${tag} D1: whole-row reads happened: ${fake.selects}`);
    assert.equal(fake.upserts.length - writesBefore, 1, `${tag} D1: extra uploads`);
    const listB = await on(B, (s) => s.products.getAll());
    assert.equal(listB.length, 403, `${tag} D1: B has ${listB.length} products`);
    assert.equal(listB[0].id, "p-new", `${tag} D1: a new row must come first on B`);
    assert.equal((server().products as Row[]).length, 403, `${tag} D1: server count`);
    assert.equal((server().products as Row[])[0].id, "p-new", `${tag} D1: server order`);
  });

  // D2) بستن و باز کردن برنامه: به‌جای خواندن کل ردیف فقط «بعد از نسخهٔ n چه عوض شده؟»
  //     و تغییری که در این فاصله روی دستگاه دیگر ثبت شده می‌رسد
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(B, (s) => s.stopCloudSync());
    await on(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 250 }));
    await on(A, (s) => s.products.remove(["p2"]));
    await settle();
    fake.selects.length = 0;
    fake.rpcCalls.length = 0;
    const B2 = await newDevice("B"); // همان حافظهٔ دستگاه B
    await signIn(B2);
    assert.deepEqual(fake.selects, [], `${tag} D2: restart read the whole row: ${fake.selects}`);
    assert.ok(pulls().length >= 1, `${tag} D2: no delta pull on restart`);
    const c = await on(B2, (s) => s.customers.getAll().find((x) => x.id === "c1")!);
    assert.equal(c.txs.length, 2, `${tag} D2: B missed the payment made while it was closed`);
    assert.deepEqual(
      ids(await on(B2, (s) => s.products.getAll())),
      ["p1"],
      `${tag} D2: B missed the delete made while it was closed`,
    );
    assert.equal(fake.upserts.filter((u) => u.asUser && u.ok).length, 2, `${tag} D2: B re-uploaded`);
  });

  // D3) توابع سرور خطا می‌دهند (باگ/حذف تابع): همان تغییر با روش قبلی ذخیره می‌شود و
  //     دستگاه دیگر هم آن را می‌گیرد — هیچ چیز گیر نمی‌کند
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    fake.rpcError = { code: "XX000", message: "internal error in kamix_sync_push" };
    await on(A, (s) => s.products.save([...s.products.getAll(), product("p-fallback")]));
    await settle();
    assert.ok(ids(server().products).includes("p-fallback"), `${tag} D3: change was not saved`);
    assert.deepEqual(ids(server().products), ["p-fallback", "p1", "p2"].sort(), `${tag} D3: server`);
    await refresh(B);
    assert.ok(
      ids(await on(B, (s) => s.products.getAll())).includes("p-fallback"),
      `${tag} D3: B did not receive it`,
    );
    assert.equal((await on(A, (s) => s.getSyncState())).failed, false, `${tag} D3: A shows an error`);
    // تابع وجود ندارد (مهاجرت برگردانده شده)
    fake.rpcError = { code: "PGRST202", message: "Could not find the function" };
    await on(B, (s) => s.products.save([...s.products.getAll(), product("p-fallback-2")]));
    await settle();
    assert.ok(ids(server().products).includes("p-fallback-2"), `${tag} D3: B change not saved`);
    fake.rpcError = null;
    await refresh(A);
    assert.ok(
      ids(await on(A, (s) => s.products.getAll())).includes("p-fallback-2"),
      `${tag} D3: A did not receive B's change`,
    );
  });

  // D4) اپ قدیمی (نسخهٔ کش‌شده روی یک گوشی) کل ستون را مستقیم می‌نویسد: دستگاه جدید
  //     همان را به‌صورت «فقط تغییرات» می‌گیرد
  await scenario(async () => {
    const { A } = await freshWorld(serverMode);
    fake.selects.length = 0;
    fake.externalWrite(U, {
      products: [...(server().products as Row[]), product("p-old-app")],
      expenses: [{ id: "e-old", title: "اپ قدیمی", amount: 3, createdAt: 5 }],
    });
    await refresh(A);
    assert.ok(
      ids(await on(A, (s) => s.products.getAll())).includes("p-old-app"),
      `${tag} D4: product from the old app missing`,
    );
    assert.deepEqual(ids(await on(A, (s) => s.expenses.getAll())), ["e-old"], `${tag} D4: expense`);
    assert.deepEqual(fake.selects, [], `${tag} D4: whole-row read: ${fake.selects}`);
  });

  // D5) اپ قدیمی روی سرورِ بدون تریگر محافظ ردیف‌ها را از ستون حذف می‌کند: دستگاه جدید
  //     کل همان ستون را می‌گیرد و ردیف‌های گم‌شده را دوباره به سرور برمی‌گرداند
  if (serverMode === "delta") {
    await scenario(async () => {
      const { A } = await freshWorld(serverMode);
      fake.externalWrite(U, { products: [product("p-only")] });
      await refresh(A);
      await settle();
      assert.deepEqual(
        ids(await on(A, (s) => s.products.getAll())),
        ["p-only", "p1", "p2"],
        `${tag} D5: A lost rows`,
      );
      assert.deepEqual(ids(server().products), ["p-only", "p1", "p2"], `${tag} D5: server not healed`);
    });
  }

  // D6) ویرایش هم‌زمان یک کالا روی دو دستگاه: آخرین ویرایش روی هر دو و روی سرور می‌ماند
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.update({ ...s.products.findById("p1")!, price: 1111 }));
    await advance(5000);
    await on(B, (s) => s.products.update({ ...s.products.findById("p1")!, price: 2222 }));
    await settle();
    await refresh(A);
    await refresh(B);
    for (const d of [A, B]) {
      assert.equal(
        (await on(d, (s) => s.products.findById("p1")))!.price,
        2222,
        `${tag} D6: ${d.name} price`,
      );
    }
    assert.equal(
      (server().products as Row[]).find((p) => p.id === "p1")!.price,
      2222,
      `${tag} D6: server price`,
    );
  });

  // D7) تغییر تنظیمات روی A و کلید دیگری روی B: هر دو می‌مانند (فقط همان کلید می‌رود)
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.settings.save({ ...s.settings.get(), shopName: "نام تازه" }));
    await on(B, (s) => s.settings.save({ ...s.settings.get(), invoiceFontSize: 17 }));
    await settle();
    await refresh(A);
    await refresh(B);
    for (const d of [A, B]) {
      const st = await on(d, (s) => s.settings.get());
      assert.equal(st.shopName, "نام تازه", `${tag} D7: ${d.name} shopName`);
      assert.equal(st.invoiceFontSize, 17, `${tag} D7: ${d.name} font size`);
    }
    const sent = pushes()
      .filter((c) => (c.args.p as Row).settings)
      .map((c) => Object.keys(((c.args.p as Row).settings as Row).set as Row));
    assert.deepEqual(sent.map((k) => k.join()).sort(), ["invoiceFontSize", "shopName"], `${tag} D7: ${JSON.stringify(sent)}`);
  });

  // D8) ثبت آفلاین + بستن برنامه: بعد از باز شدن فقط همان ردیف‌ها فرستاده می‌شوند
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => s.products.save([...s.products.getAll(), ...bigCatalog()]));
    await settle();
    await refresh(B);
    const release = fake.hold();
    await on(B, (s) =>
      s.expenses.add({ ...s.emptyExpense(), id: "e-off", title: "آفلاین", amount: 5 }),
    );
    await on(B, (s) => s.products.update({ ...s.products.findById("big-7")!, price: 7777 }));
    await settle(4000);
    await on(B, (s) => s.stopCloudSync());
    release();
    await settle();
    fake.rpcCalls.length = 0;
    const B2 = await newDevice("B");
    await signIn(B2);
    await settle(3000);
    assert.deepEqual(ids(server().expenses), ["e-off"], `${tag} D8: offline expense not sent`);
    assert.equal(
      (server().products as Row[]).find((p) => p.id === "big-7")!.price,
      7777,
      `${tag} D8: offline edit not sent`,
    );
    const total = pushes().reduce((n, c) => n + bytes(c.args), 0);
    assert.ok(total < 1500, `${tag} D8: restart re-sent ${total} bytes (whole columns?)`);
    await refresh(A);
    assert.equal((await on(A, (s) => s.products.findById("big-7")))!.price, 7777, `${tag} D8: A`);
  });

  // D9) فاکتور ثبت‌شده روی A: فاکتور، کم شدن موجودی و بسته شدن تبِ باز به B می‌رسد
  await scenario(async () => {
    const { A, B } = await freshWorld(serverMode);
    await on(A, (s) => {
      const p = s.products.findById("p1")!;
      s.invoice.save({
        ...s.invoice.getCurrent(),
        items: [{ productId: p.id, name: p.name, price: p.price, quantity: 2 }],
      });
    });
    await settle();
    await refresh(B);
    assert.equal((await on(B, (s) => s.invoice.getCurrent())).items.length, 1, `${tag} D9: draft on B`);
    await on(A, (s) => s.invoice.archive(s.invoice.getCurrent()));
    await settle();
    await refresh(B);
    await refresh(A);
    for (const d of [A, B]) {
      const hist = await on(d, (s) => s.invoice.getHistory());
      assert.equal(hist.length, 1, `${tag} D9: ${d.name} has ${hist.length} invoices`);
      assert.equal(
        (await on(d, (s) => s.products.findById("p1")))!.stock,
        3,
        `${tag} D9: ${d.name} stock`,
      );
      assert.equal(
        (await on(d, (s) => s.invoice.getCurrent())).items.length,
        0,
        `${tag} D9: ${d.name} still shows the registered invoice as an open draft`,
      );
    }
    assert.equal((server().invoices as Row[]).length, 1, `${tag} D9: server invoices`);
  });

  if (!failures.length) console.log(`✓ ${tag} delta-only scenarios passed`);
}

const only = process.env.MODE as ServerMode | undefined;
for (const mode of ["blind", "trigger", "delta", "delta-trigger"] as ServerMode[]) {
  if (!only || only === mode) await run(mode);
}
if (failures.length) {
  console.log(failures.map((f) => `✗ ${f}`).join("\n"));
  process.exit(1);
}
