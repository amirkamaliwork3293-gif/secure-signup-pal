/**
 * آزمون تصادفی همگام‌سازی: سه دستگاه با یک حساب، صدها عملیات تصادفی (افزودن/ویرایش/حذف
 * کالا، مشتری و تراکنش، هزینه، تنظیمات، ثبت فاکتور، تب‌های فاکتور باز)، شبکهٔ کند،
 * بستن و باز کردن برنامه و (روی سرور دارای تریگر محافظ) اپ قدیمی که کل ستون را می‌نویسد.
 *
 * در پایان باید:
 *   ۱) هیچ ردیفی که ثبت شده و حذف نشده گم نشده باشد و هیچ ردیف حذف‌شده‌ای برنگشته باشد
 *   ۲) هر سه دستگاه دقیقاً یک داده را نشان بدهند
 *   ۳) سرور همان را داشته باشد
 *   ۴) وقتی همه هم‌گام‌اند، دستگاه‌ها دیگر چیزی آپلود نکنند (بدون رفت‌وبرگشت بی‌پایان)
 *
 * اجرا: npx tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-sync-fuzz.ts
 *   SEEDS=50 تعداد دور برای هر حالت سرور · SEED=1234 فقط همان دانه · MODE=delta
 */
import assert from "node:assert/strict";

const env = await import("./fakes/browser-env.ts");
const { onDevice, deviceStorage, advance, clock, timers } = env;
const { fake } = await import("./fakes/supabase-client.ts");

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
Date.now = () => T0 + clock.now;
const quiet = () => {};
console.warn = quiet;
console.error = quiet;

type Store = typeof import("../src/lib/store.ts");
type Row = Record<string, unknown>;
type ServerMode = "blind" | "trigger" | "delta" | "delta-trigger";
const U = "user-1";
let instance = 0;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// همان ادغام تریگر 20261002120000 که test-sync-two-devices.ts استفاده می‌کند
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
function triggerLikeMerge(old: Row, incoming: Row): Row {
  const next: Row = { ...old, ...incoming };
  const tombs = (s: unknown) =>
    (((s as Row | undefined)?.catalogTombstones ?? {}) as Record<string, string[]>) || {};
  if (incoming.settings && typeof incoming.settings === "object") {
    const merged: Record<string, string[]> = {};
    const a = tombs(old.settings);
    const b = tombs(incoming.settings);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      merged[k] = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])].sort();
    }
    next.settings = { ...(incoming.settings as Row), catalogTombstones: merged };
  }
  const tomb = tombs(next.settings);
  for (const col of ARRAY_COLS) {
    if (!(col in incoming)) continue;
    let inc = (Array.isArray(incoming[col]) ? incoming[col] : []) as Row[];
    const live = (Array.isArray(old[col]) ? old[col] : []) as Row[];
    const nestedKey = col === "customers" ? "txs" : col === "students" ? "payments" : null;
    if (nestedKey) {
      const gone = new Set(tomb[`${col}.${nestedKey}`] ?? []);
      inc = inc.map((row) => {
        const prev = live.find((o) => o.id === row.id);
        if (!prev || !Array.isArray(prev[nestedKey]) || !Array.isArray(row[nestedKey])) return row;
        const have = new Set((row[nestedKey] as Row[]).map((t) => t.id));
        const add = (prev[nestedKey] as Row[]).filter(
          (t) => !have.has(t.id) && !gone.has(String(t.id)),
        );
        return add.length ? { ...row, [nestedKey]: [...(row[nestedKey] as Row[]), ...add] } : row;
      });
    }
    const seen = new Set(inc.map((r) => r.id));
    next[col] = [...inc, ...live.filter((r) => !seen.has(r.id))];
  }
  return next;
}

const stable = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x: unknown) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return x;
    const out: Row = {};
    for (const k of Object.keys(x as Row).sort()) out[k] = (x as Row)[k];
    return out;
  });
const byId = (list: unknown) =>
  [...((Array.isArray(list) ? list : []) as Row[])].sort((a, b) =>
    String(a.id) < String(b.id) ? -1 : 1,
  );
const idsOf = (list: unknown) => byId(list).map((r) => String(r.id));

async function runSeed(serverMode: ServerMode, seed: number) {
  const rand = rng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const chance = (p: number) => rand() < p;
  const tag = `[${serverMode} seed=${seed}]`;

  for (const d of ["A", "B", "C"]) deviceStorage(d).clear();
  timers.clear();
  fake.rows.clear();
  fake.upserts.length = 0;
  fake.rpcCalls.length = 0;
  fake.selects.length = 0;
  fake.rowSeq.clear();
  fake.gate = null;
  fake.beforeWrite = null;
  fake.rpcError = null;
  // ماژول realtime-sync بین نمونه‌های store در یک پروسه مشترک است (در مرورگر هر دستگاه
  // نسخهٔ خودش را دارد)، پس سیگنال لحظه‌ای این‌جا در سطح تست شبیه‌سازی می‌شود: بعد از
  // هر نوشتن روی سرور، هر دستگاه همان چیزی را می‌گیرد که کانال realtime می‌فرستد.
  fake.realtime = false;
  const realtimeOn = chance(0.5);
  // FAST_CLOCK=1: ساعت سرور تقریباً ثابت می‌ماند، پس همهٔ ویرایش‌ها «هم‌زمان» حساب
  // می‌شوند — سخت‌ترین حالت برای قاعدهٔ انتخاب نسخه.
  fake.realClock = !process.env.FAST_CLOCK;
  fake.delta = serverMode.startsWith("delta");
  fake.serverMerge = serverMode.endsWith("trigger") ? triggerLikeMerge : null;
  fake.rows.set(U, {
    user_id: U,
    products: [
      { id: "p-seed-1", name: "کالا ۱", price: 1000, category: "", code: "", stock: 50 },
      { id: "p-seed-2", name: "کالا ۲", price: 2000, category: "", code: "", stock: 50 },
    ],
    customers: [{ id: "c-seed", firstName: "رضا", createdAt: 1, txs: [] }],
    settings: { shopName: "فروشگاه" },
  });

  type Device = { name: string; s: Store };
  const devices = new Map<string, Device>();
  const on = <T>(d: Device, fn: (s: Store) => T | Promise<T>): Promise<T> =>
    Promise.resolve(onDevice(d.name, () => fn(d.s)));
  const boot = async (name: string) => {
    instance += 1;
    const s = (await import(`../src/lib/store.ts?fuzz=${name}-${instance}`)) as Store;
    const d = { name, s };
    devices.set(name, d);
    await on(d, async (st) => {
      fake.sessionUser = U;
      st.setStorageScope(U);
      st.beginUserScope(U);
      await st.hydrateFromCloud(U);
    });
    return d;
  };
  for (const name of ["A", "B", "C"]) await boot(name);
  fake.afterWrite = realtimeOn
    ? (row) => {
        const signal = {
          updatedAt: String(row.updated_at),
          seq: typeof row.sync_seq === "number" ? row.sync_seq : null,
        };
        for (const d of devices.values()) {
          // گاهی سیگنال نمی‌رسد (اتصال ناپایدار)
          if (chance(0.15)) continue;
          onDevice(d.name, () => setTimeout(() => void d.s.refreshFromCloud(signal), 50));
        }
      }
    : null;
  await advance(3000);

  // آنچه باید در پایان وجود داشته باشد
  const added: Record<string, Set<string>> = {
    products: new Set(["p-seed-1", "p-seed-2"]),
    customers: new Set(["c-seed"]),
    expenses: new Set(),
    invoices: new Set(),
  };
  const removed: Record<string, Set<string>> = {
    products: new Set(),
    customers: new Set(),
    expenses: new Set(),
    invoices: new Set(),
  };
  const txAdded = new Map<string, Set<string>>(); // customer → tx ids
  const txRemoved = new Set<string>();
  const settingsWanted: Record<string, unknown> = {};
  let n = 0;
  const nextId = (prefix: string) => `${prefix}-${seed}-${++n}`;
  let release: (() => void) | null = null;

  const trace: string[] = [];
  const steps = 60 + Math.floor(rand() * 60);
  for (let step = 0; step < steps; step++) {
    const d = devices.get(pick(["A", "B", "C"]))!;
    const r = rand();
    trace.push(`${step} t=${clock.now} ${d.name} r=${r.toFixed(3)} n=${n} held=${!!release}`);
    if (r < 0.14) {
      const id = nextId("p");
      added.products.add(id);
      await on(d, (s) =>
        s.products.save([
          { id, name: `کالا ${id}`, price: 1000, category: "", code: "", stock: 20 } as never,
          ...s.products.getAll(),
        ]),
      );
    } else if (r < 0.26) {
      await on(d, (s) => {
        const list = s.products.getAll();
        if (!list.length) return;
        const p = pick(list);
        s.products.update({ ...p, price: Math.floor(rand() * 9000) + 1000 });
      });
    } else if (r < 0.31) {
      await on(d, (s) => {
        const list = s.products.getAll();
        if (list.length <= 1) return;
        const p = pick(list);
        removed.products.add(p.id);
        s.products.remove([p.id]);
      });
    } else if (r < 0.37) {
      await on(d, (s) => {
        const c = s.customers.add({ firstName: `مشتری ${n}`, lastName: "", phone: "" } as never);
        added.customers.add((c as { id: string }).id);
      });
    } else if (r < 0.52) {
      await on(d, (s) => {
        const list = s.customers.getAll();
        if (!list.length) return;
        const c = pick(list);
        const before = new Set((c.txs ?? []).map((t) => t.id));
        s.customers.addTx(c.id, {
          type: chance(0.5) ? "debt" : "payment",
          amount: Math.floor(rand() * 900) + 100,
        });
        const after = s.customers.getAll().find((x) => x.id === c.id);
        for (const t of after?.txs ?? []) {
          if (before.has(t.id)) continue;
          if (!txAdded.has(c.id)) txAdded.set(c.id, new Set());
          txAdded.get(c.id)!.add(t.id);
        }
      });
    } else if (r < 0.56) {
      await on(d, (s) => {
        const withTx = s.customers.getAll().filter((c) => (c.txs ?? []).length > 0);
        if (!withTx.length) return;
        const c = pick(withTx);
        const t = pick(c.txs!);
        txRemoved.add(t.id);
        s.customers.removeTx(c.id, t.id);
      });
    } else if (r < 0.64) {
      const id = nextId("e");
      added.expenses.add(id);
      await on(d, (s) => s.expenses.add({ ...s.emptyExpense(), id, title: id, amount: 10 }));
    } else if (r < 0.7) {
      const key = pick(["shopName", "storeAddress", "invoiceFontSize"]);
      const value = key === "invoiceFontSize" ? 10 + Math.floor(rand() * 10) : `${key}-${step}`;
      settingsWanted[key] = undefined; // فقط هم‌گرایی بررسی می‌شود
      await on(d, (s) => s.settings.save({ ...s.settings.get(), [key]: value }));
    } else if (r < 0.8) {
      await on(d, (s) => {
        const list = s.products.getAll();
        if (!list.length) return;
        const p = pick(list);
        const cur = s.invoice.getCurrent();
        s.invoice.save({
          ...cur,
          items: [...cur.items, { productId: p.id, name: p.name, price: p.price, quantity: 1 }],
        });
        if (chance(0.6)) {
          const saved = s.invoice.archive(s.recalc(s.invoice.getCurrent()));
          added.invoices.add(saved.id);
        }
      });
    } else if (r < 0.84) {
      if (release) {
        release();
        release = null;
      } else {
        release = fake.hold();
      }
    } else if (r < 0.88) {
      // بستن و باز کردن برنامه روی همین دستگاه
      const wasHeld = release;
      if (wasHeld) {
        wasHeld();
        release = null;
      }
      await advance(100);
      await on(d, (s) => s.stopCloudSync());
      await boot(d.name);
    } else if (r < 0.92 && serverMode.endsWith("trigger")) {
      // اپ قدیمی: کل ستون کالاها را از روی نسخهٔ الانِ سرور + یک کالای تازه می‌نویسد
      const id = nextId("p-old");
      added.products.add(id);
      const cur = (fake.rows.get(U)?.products ?? []) as Row[];
      fake.externalWrite(U, {
        products: [
          { id, name: id, price: 5, category: "", code: "", stock: 1 },
          ...cur.slice(0, Math.max(0, cur.length - (chance(0.5) ? 1 : 0))),
        ],
      });
    } else {
      // منتظر نمی‌مانیم: ممکن است شبکه همین حالا معطل (hold) باشد
      void on(d, (s) => s.refreshFromCloud());
    }
    await advance(Math.floor(rand() * 2500));
  }

  // ── آرام شدن: شبکه وصل، همه چند دور دریافت و ارسال می‌کنند ──
  fake.afterWrite = null;
  if (release) release();
  await advance(10_000);
  const all = [...devices.values()];
  for (let round = 0; round < 8; round++) {
    for (const d of all) {
      await on(d, (s) => s.refreshFromCloud());
      await advance(4000);
    }
  }
  // ۴) دیگر هیچ آپلودی نباید باشد
  const quietFrom = fake.upserts.length;
  for (let round = 0; round < 3; round++) {
    for (const d of all) {
      await on(d, (s) => s.refreshFromCloud());
      await advance(4000);
    }
  }
  const late = fake.upserts.slice(quietFrom);
  assert.equal(
    late.length,
    0,
    `${tag} devices keep uploading when everything is in sync (${late.length}): ${late
      .slice(0, 3)
      .map((u) => stable(u.payload).slice(0, 300))
      .join(" | ")}`,
  );

  const view = async (d: Device) =>
    on(d, (s) => ({
      products: byId(s.products.getAll()),
      customers: byId(s.customers.getAll()).map((c) => ({ ...c, txs: byId(c.txs) })),
      expenses: byId(s.expenses.getAll()),
      invoices: byId(s.invoice.getHistory()),
      settings: (() => {
        const st = { ...(s.settings.get() as unknown as Row) };
        delete st.catalogTombstones;
        return st;
      })(),
      open: byId(
        (s.invoice.getCurrent(), JSON.parse(deviceStorage(d.name).get(`acc.currentInvoice.v2:${U}`) ?? "{}").open),
      ),
      pending: s.hasUnsyncedChanges(),
    }));
  const views = new Map<string, Awaited<ReturnType<typeof view>>>();
  for (const d of all) views.set(d.name, await view(d));

  if (process.env.TRACE) {
    console.log(trace.join("\n"));
    const srvRow = fake.rows.get(U)!;
    for (const col of ["products", "customers", "expenses", "invoices"]) {
      const exp = [...added[col]].filter((id) => !removed[col].has(id)).sort();
      console.log(col, "server", idsOf(srvRow[col]).filter((x) => !exp.includes(x)), "missing", exp.filter((x) => !idsOf(srvRow[col]).includes(x)));
      for (const d of all) {
        const have = idsOf((views.get(d.name) as unknown as Record<string, Row[]>)[col]);
        console.log(col, d.name, "extra", have.filter((x) => !exp.includes(x)), "missing", exp.filter((x) => !have.includes(x)));
      }
    }
    for (const d of all) console.log(d.name, "hydrated", await on(d, (st) => st.isCloudHydrated()), "sync", stable(await on(d, (st) => st.getSyncState())));
    console.log("tombstones", stable(((srvRow.settings as Row) ?? {}).catalogTombstones));
    console.log(fake.upserts.map((u, i) => `${i} ${u.ok ? "" : "REFUSED "}${Object.keys(u.payload).join("+")} exp=${stable((u.payload as Row).expenses ?? ((u.payload as Row).rows as Row)?.expenses ?? "").slice(0, 0)}${idsOf((u.payload as Row).expenses ?? []).join(",")}`).join("\n"));
  }
  // ۱) نه ردیف گم‌شده، نه ردیف برگشته
  for (const d of all) {
    const v = views.get(d.name)! as unknown as Record<string, Row[]>;
    for (const col of ["products", "customers", "expenses", "invoices"]) {
      const expected = [...added[col]].filter((id) => !removed[col].has(id)).sort();
      assert.deepEqual(idsOf(v[col]), expected, `${tag} ${d.name} ${col}`);
    }
    for (const c of v.customers) {
      const expected = [...(txAdded.get(String(c.id)) ?? [])].filter((id) => !txRemoved.has(id)).sort();
      assert.deepEqual(idsOf(c.txs), expected, `${tag} ${d.name} txs of ${c.id}`);
    }
    assert.equal(v.pending as unknown, false, `${tag} ${d.name} still has unsynced changes`);
  }
  // ۲) هر سه دستگاه یکسان
  const first = views.get("A")!;
  for (const d of all) {
    for (const key of ["products", "customers", "expenses", "invoices", "settings", "open"] as const) {
      assert.equal(
        stable(views.get(d.name)![key]),
        stable(first[key]),
        `${tag} ${d.name} and A show different ${key}`,
      );
    }
  }
  // ۳) سرور همان را دارد (ردیف‌های حذف‌شده روی سرور می‌مانند: حذف نرم)
  const srv = fake.rows.get(U)!;
  const tomb = (((srv.settings as Row)?.catalogTombstones ?? {}) as Record<string, string[]>) || {};
  for (const col of ["products", "customers", "expenses", "invoices"] as const) {
    const gone = new Set(tomb[col] ?? []);
    const goneTx = new Set(tomb["customers.txs"] ?? []);
    const visible = byId(srv[col])
      .filter((r) => !gone.has(String(r.id)))
      .map((r) =>
        col === "customers"
          ? { ...r, txs: byId(r.txs).filter((t) => !goneTx.has(String(t.id))) }
          : r,
      );
    assert.equal(stable(visible), stable(first[col]), `${tag} server and devices differ in ${col}`);
  }
  void settingsWanted;
}

const seeds = process.env.SEED
  ? [Number(process.env.SEED)]
  : Array.from({ length: Number(process.env.SEEDS ?? 25) }, (_, i) => 1000 + i);
const modes = (process.env.MODE ? [process.env.MODE] : ["delta", "delta-trigger", "trigger", "blind"]) as ServerMode[];
let failed = 0;
for (const mode of modes) {
  let ok = 0;
  for (const seed of seeds) {
    try {
      await runSeed(mode, seed);
      ok += 1;
    } catch (e) {
      failed += 1;
      console.log(`✗ ${(e as Error).message.split("\n")[0].slice(0, 600)}`);
      if (process.env.STACK) console.log((e as Error).stack);
    }
  }
  console.log(`${ok === seeds.length ? "✓" : "✗"} [${mode}] ${ok}/${seeds.length} random runs converged`);
}
if (failed) process.exit(1);
console.log("sync fuzz tests passed");
