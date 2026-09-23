/**
 * حذف فقط با اقدام صریح کاربر (باگ ناپدید شدن محصولات).
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-store-explicit-deletes.ts
 *
 * ۱) ذخیرهٔ لیستی که از نسخهٔ کهنه ساخته شده (مودال باز / await / تب دیگر) هیچ ردیفی را حذف نمی‌کند.
 * ۲) همهٔ مسیرهای صریح حذف هنوز حذف می‌کنند و شناسه را در tombstone همان ستون ثبت می‌کنند.
 * ۳) ردیف حذف‌شده با ادغام ابری برنمی‌گردد.
 */
import assert from "node:assert/strict";

const { localStorage, advance } = await import("./fakes/browser-env.ts");
const { fake } = await import("./fakes/supabase-client.ts");
const store = await import("../src/lib/store.ts");
const {
  products,
  categories,
  invoice,
  purchases,
  expenses,
  manualLedger,
  reminders,
  accounts,
  accountTxs,
  production,
  customers,
  students,
  emptyInvoice,
  emptyExpense,
  emptyManualLedger,
  hydrateFromCloud,
  beginUserScope,
  setStorageScope,
  stopCloudSync,
} = store;

const U = "user-a";
const ids = (list: { id: string }[]) => list.map((r) => r.id).sort();
const tombstones = (field: string): string[] =>
  JSON.parse(localStorage.getItem(`acc.tombstones.v1:${U}`) ?? "{}")[field] ?? [];
const product = (id: string) => ({ id, name: id, price: 1000, category: "", code: "", stock: 5 });

async function signIn() {
  fake.sessionUser = U;
  setStorageScope(U);
  beginUserScope(U);
  await hydrateFromCloud(U);
  await advance(1000);
}

fake.rows.set(U, {
  user_id: U,
  products: [product("p1"), product("p2")],
  settings: { shopName: "S" },
});
await signIn();
assert.deepEqual(ids(products.getAll()), ["p1", "p2"]);

// ─── ۱) لیست کهنه چیزی را حذف نمی‌کند ───────────────────────────────────────
const staleProducts = products.getAll(); // مثلاً لیستی که مودال/صفحهٔ صوتی قبل از await گرفته
products.save([...products.getAll(), product("p3")]); // در همین فاصله کالای p3 رسید
products.save([product("p4"), ...staleProducts]); // ذخیرهٔ کهنه (بدون p3)
assert.deepEqual(ids(products.getAll()), ["p1", "p2", "p3", "p4"], "stale save deleted p3");
assert.deepEqual(tombstones("products"), [], "stale save tombstoned something");
products.save([]); // حتی لیست خالی
assert.equal(products.getAll().length, 4, "empty save deleted products");

const staleCats = categories.getAll(); // لیستی که دیالوگ مدیریت دسته هنگام باز شدن گرفته
categories.save([...categories.getAll(), { id: "catX", name: "X" }]);
categories.save([...staleCats, { id: "catY", name: "Y" }]); // مثل دیالوگ مدیریت دسته
assert.ok(ids(categories.getAll()).includes("catX"), "stale category save deleted catX");
assert.deepEqual(tombstones("categories"), []);

// ─── ۲) مسیرهای صریح حذف ─────────────────────────────────────────────────────
function assertDeleted(field: string, all: () => { id: string }[], id: string) {
  assert.ok(!all().some((r) => r.id === id), `${field}: ${id} still present`);
  assert.ok(tombstones(field).includes(id), `${field}: ${id} not tombstoned`);
}

products.remove(["p1"]);
assertDeleted("products", products.getAll, "p1");
products.remove(["p2", "p3"]); // «حذف همه» فقط شناسه‌های دیده‌شده
assert.deepEqual(ids(products.getAll()), ["p4"]);

categories.remove("catX");
assertDeleted("categories", categories.getAll, "catX");
assert.deepEqual(ids(categories.getAll()), ["catY"]);

const inv = invoice.archive({ ...emptyInvoice(), items: [] });
invoice.deleteFromHistory(inv.id);
assertDeleted("invoices", invoice.getHistory, inv.id);

const pur = purchases.archive({
  id: "buy-1",
  createdAt: Date.now(),
  items: [],
  total: 0,
  paymentMethod: "cash",
});
purchases.deleteFromHistory(pur.id);
assertDeleted("purchases", purchases.getAll, pur.id);

const acc = accounts.add({ name: "صندوق" });
const exp = { ...emptyExpense(), title: "اجاره", amount: 500, accountId: acc.id };
expenses.add(exp);
const txOf = () => accountTxs.getAll().filter((t) => t.expenseId === exp.id);
assert.equal(txOf().length, 1);
const oldTx = txOf()[0].id;
expenses.update({ ...exp, amount: 700 }); // ویرایش هزینه: تراکنش حساب جایگزین می‌شود، نه دوبل
assert.equal(txOf().length, 1, "expense edit duplicated the account withdrawal");
assert.equal(txOf()[0].amount, 700);
assertDeleted("account_txs", accountTxs.getAll, oldTx);
expenses.remove(exp.id);
assertDeleted("expenses", expenses.getAll, exp.id);
assert.equal(txOf().length, 0, "expense delete left its account withdrawal");

const tx = accountTxs.add({ accountId: acc.id, type: "deposit", amount: 10, at: Date.now() });
accountTxs.remove(tx.id);
assertDeleted("account_txs", accountTxs.getAll, tx.id);

const tx2 = accountTxs.add({ accountId: acc.id, type: "deposit", amount: 10, at: Date.now() });
accounts.remove(acc.id); // حذف حساب همراه تراکنش‌هایش (رفتار مستند)
assertDeleted("accounts", accounts.getAll, acc.id);
assertDeleted("account_txs", accountTxs.getAll, tx2.id);

const led = manualLedger.add({ ...emptyManualLedger(), amount: 5 });
manualLedger.remove(led.id);
assertDeleted("manual_ledger", manualLedger.getAll, led.id);

const rem = reminders.add({ title: "تماس", dueAt: Date.now() + 86_400_000 });
reminders.remove(rem.id);
assertDeleted("reminders", reminders.getAll, rem.id);

production.save([{ id: "ev1", at: Date.now() } as never]);
production.remove("ev1");
assertDeleted("production", production.getAll, "ev1");

const c1 = customers.add({ firstName: "علی" });
customers.remove(c1.id);
assertDeleted("customers", customers.getAll, c1.id);
const c2 = customers.add({ firstName: "رضا" });
const c3 = customers.add({ firstName: "مریم" });
customers.removeAll();
assertDeleted("customers", customers.getAll, c2.id);
assertDeleted("customers", customers.getAll, c3.id);

const st = students.add({ firstName: "سارا", fee: 100, periodDays: 30, startDate: Date.now() });
students.remove(st.id);
assertDeleted("students", students.getAll, st.id);

// ─── ۳) حذف به ابر می‌رود و ادغام ابری آن را برنمی‌گرداند ──────────────────
await advance(10_000);
const cloudTs = (fake.rows.get(U)!.settings as { catalogTombstones?: Record<string, string[]> })
  .catalogTombstones;
assert.ok(cloudTs?.products?.includes("p1"), "product delete never reached the cloud");
// سرور (تریگر union) ردیف حذف‌شده را نگه می‌دارد؛ ورود دوباره نباید p1 را برگرداند.
fake.rows.get(U)!.products = [product("p1"), ...(fake.rows.get(U)!.products as unknown[])];
stopCloudSync();
await signIn();
assert.deepEqual(ids(products.getAll()), ["p4"], "deleted product came back after re-login");

console.log("store explicit-delete tests passed");
