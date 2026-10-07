/**
 * ممیزی حساب مشتری (بدهی/پرداخت) و واریز فاکتور به حساب/کارت — با localStorage
 * شبیه‌سازی‌شده؛ هیچ ارتباطی با پایگاه داده ندارد.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-customer-debt.ts
 */

import assert from "node:assert/strict";

const mem = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as { document?: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: "visible",
};
if (typeof CustomEvent === "undefined") {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}
(globalThis as { window?: unknown }).window = {
  localStorage,
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
};
(globalThis as { localStorage?: unknown }).localStorage = localStorage;

const store = await import("../src/lib/store.ts");
const {
  customers,
  invoice,
  accounts,
  accountTxs,
  accountBalance,
  expenses,
  emptyExpense,
  customerBalance,
  emptyInvoice,
  recalc,
  fromDisplayAmount,
  toDisplayAmount,
  invoiceReceivedNow,
} = store;
type Invoice = import("../src/lib/store.ts").Invoice;
type CustomerInfo = import("../src/lib/store.ts").CustomerInfo;
const { invoiceCustomerDebt, invoiceTotals } = await import("../src/lib/invoice-math.ts");
const { customerInsights } = await import("../src/lib/customer-insights.ts");

/** همان مسیر صفحه‌ی فاکتور: ثبت در تاریخچه + ثبت بدهی (InvoiceWorkspace.checkout) */
function sell(partial: Partial<Invoice>, customer: CustomerInfo): Invoice {
  const draft: Invoice = recalc({ ...emptyInvoice(), ...partial, customer });
  const saved = invoice.archive(draft);
  const debt = invoiceCustomerDebt(saved);
  const linked =
    debt > 0
      ? customers.recordInvoiceDebt(customer, saved, { amount: debt })
      : customers.findOrCreate(customer);
  if (linked && saved.customer?.customerId !== linked.id) {
    const withId = { ...saved, customer: { ...saved.customer, customerId: linked.id } };
    invoice.updateHistory(withId);
    return withId;
  }
  return saved;
}
const byId = (id: string) => customers.getAll().find((c) => c.id === id)!;
const historyOf = (id: string) => invoice.getHistory().find((i) => i.id === id)!;
const debtTxs = (invId: string) =>
  customers
    .getAll()
    .flatMap((c) => c.txs)
    .filter((t) => t.type === "debt" && t.invoiceId === invId);
const debtorsList = () => customers.getAll().filter((c) => customerBalance(c) > 0);

// ── ۱) فاکتور نسیه با مشتری جدید، پرداخت جزئی روی خود فاکتور ────────────────
const ali: CustomerInfo = { firstName: "علی", lastName: "رضایی", phone: "09121234567" };
const inv1 = sell(
  {
    items: [{ productId: "p1", name: "برنج", price: 500_000, quantity: 2 }],
    paymentMethod: "credit",
    paidAmount: 300_000,
  },
  ali,
);
const aliId = inv1.customer!.customerId!;
assert.ok(aliId, "invoice linked to the new customer");
assert.equal(customers.getAll().length, 1, "customer created once");
assert.equal(customerBalance(byId(aliId)), 700_000, "credit 1,000,000 − paid 300,000");
assert.ok(
  debtorsList().some((c) => c.id === aliId),
  "appears among debtors",
);
assert.equal(invoiceTotals(historyOf(inv1.id)).remaining, 700_000, "invoice shows same remainder");

// همان مشتری با تلفن دوباره → تکراری ساخته نمی‌شود
const inv2 = sell(
  {
    items: [{ productId: "p2", name: "روغن", price: 150_000, quantity: 1 }],
    paymentMethod: "credit",
  },
  { firstName: "علی", phone: "0912 123 4567" },
);
assert.equal(inv2.customer!.customerId, aliId, "matched by phone, no duplicate");
assert.equal(customers.getAll().length, 1);
assert.equal(customerBalance(byId(aliId)), 850_000, "two invoices add up");

// ── ۲) پرداخت از صفحه‌ی مشتری / «تسویه» دستیار (هر دو customers.addTx) ────
customers.addTx(aliId, { type: "payment", amount: 200_000, note: "دریافت" });
assert.equal(customerBalance(byId(aliId)), 650_000);

// ── ۳) ویرایش فاکتور: بدهی همان فاکتور جایگزین می‌شود، نه اضافه ──────────────
{
  const before = historyOf(inv1.id);
  const edited = recalc({
    ...before,
    items: [{ productId: "p1", name: "برنج", price: 400_000, quantity: 2 }],
  });
  invoice.updateHistory(edited);
  customers.syncInvoiceDebt(before, edited);
  assert.equal(debtTxs(inv1.id).length, 1, "exactly one debt tx per invoice");
  assert.equal(debtTxs(inv1.id)[0].amount, 500_000, "800,000 − 300,000");
  assert.equal(customerBalance(byId(aliId)), 450_000, "500k + 150k − 200k");
}
{
  // ویرایشی که مبلغ را عوض نمی‌کند (مثلاً توضیحات) → دفتر دست نمی‌خورد
  const before = historyOf(inv1.id);
  const txId = debtTxs(inv1.id)[0].id;
  const edited = { ...before, notes: "تحویل فردا" };
  invoice.updateHistory(edited);
  customers.syncInvoiceDebt(before, edited);
  assert.equal(debtTxs(inv1.id)[0].id, txId, "no rewrite when the debt is unchanged");
}

// ── ۴) تخفیف و مالیات در بدهی ───────────────────────────────────────────────
const sara: CustomerInfo = { firstName: "سارا", lastName: "کریمی", phone: "09351112233" };
const inv3 = sell(
  {
    items: [{ productId: "p3", name: "پارچه", price: 1_000_000, quantity: 1 }],
    paymentMethod: "credit",
    paidAmount: 100_000,
    discountPercent: 10,
    taxPercent: 9,
  },
  sara,
);
const saraId = inv3.customer!.customerId!;
// ۱٬۰۰۰٬۰۰۰ − ۱۰٪ = ۹۰۰٬۰۰۰ ؛ + ۹٪ = ۹۸۱٬۰۰۰ ؛ − ۱۰۰٬۰۰۰ پرداخت = ۸۸۱٬۰۰۰
assert.equal(invoiceTotals(historyOf(inv3.id)).total, 981_000);
assert.equal(customerBalance(byId(saraId)), 881_000);

// ── ۵) تسویه کامل، سپس پرداخت بیشتر (طلبکار) ───────────────────────────────
customers.update({ ...byId(saraId), settlementDate: "1405/08/01" });
customers.addTx(saraId, { type: "payment", amount: 881_000 });
assert.equal(customerBalance(byId(saraId)), 0, "fully settled");
assert.equal(byId(saraId).settlementDate, undefined, "settlement date cleared when settled");
assert.ok(!debtorsList().some((c) => c.id === saraId), "settled customer is not a debtor");
customers.addTx(saraId, { type: "payment", amount: 50_000 });
assert.equal(customerBalance(byId(saraId)), -50_000, "overpayment = creditor (طلبکار)");

// ── ۶) فاکتور چک: چک + مانده‌ی نسیه هر دو بدهی‌اند ──────────────────────────
const reza: CustomerInfo = { firstName: "رضا", phone: "09190000001" };
const inv4 = sell(
  {
    items: [{ productId: "p4", name: "یخچال", price: 1_000_000, quantity: 1 }],
    paymentMethod: "check",
    paidAmount: 100_000,
    cheques: [{ id: "ch1", amount: 600_000, dueDate: "2026-12-01" }],
    checkAmount: 600_000,
  },
  reza,
);
const rezaId = inv4.customer!.customerId!;
const t4 = invoiceTotals(historyOf(inv4.id));
assert.equal(t4.checkAmount, 600_000);
assert.equal(t4.remaining, 300_000);
assert.equal(
  customerBalance(byId(rezaId)),
  900_000,
  "cheque 600,000 + unpaid 300,000 (was only 600,000 before the fix)",
);

// ── ۷) فاکتور نقدی که بعداً نسیه شد → بدهی تازه برای همان مشتری ─────────────
const nima: CustomerInfo = { firstName: "نیما", phone: "09390000002" };
const inv5 = sell(
  { items: [{ productId: "p5", name: "کفش", price: 300_000, quantity: 1 }], paymentMethod: "cash" },
  nima,
);
const nimaId = inv5.customer!.customerId!;
assert.equal(customerBalance(byId(nimaId)), 0, "cash invoice: no debt");
{
  const before = historyOf(inv5.id);
  const edited = { ...before, paymentMethod: "credit" as const };
  invoice.updateHistory(edited);
  const linked = customers.syncInvoiceDebt(before, edited);
  assert.equal(linked, nimaId);
  assert.equal(customerBalance(byId(nimaId)), 300_000);
  // و برگشت به نقدی → بدهی برداشته می‌شود
  const back = { ...edited, paymentMethod: "cash" as const };
  invoice.updateHistory(back);
  customers.syncInvoiceDebt(edited, back);
  assert.equal(customerBalance(byId(nimaId)), 0);
  assert.equal(debtTxs(inv5.id).length, 0);
}

// ── ۸) بدهی‌ای که کاربر دستی حذف کرده، با ویرایش دوباره ساخته نمی‌شود ───────
{
  const tx = debtTxs(inv2.id)[0];
  customers.removeTx(aliId, tx.id);
  const balance = customerBalance(byId(aliId));
  const before = historyOf(inv2.id);
  const edited = recalc({
    ...before,
    items: [{ productId: "p2", name: "روغن", price: 160_000, quantity: 1 }],
  });
  invoice.updateHistory(edited);
  customers.syncInvoiceDebt(before, edited);
  assert.equal(debtTxs(inv2.id).length, 0, "manual removal respected");
  assert.equal(customerBalance(byId(aliId)), balance);
}

// ── ۹) حذف فاکتور: بدهی همان فاکتور برداشته می‌شود، پرداخت‌ها می‌مانند ──────
{
  const info = customers.invoiceDebtOf(inv1.id);
  assert.equal(info?.customer.id, aliId);
  assert.equal(info?.amount, 500_000);
  const paymentsBefore = byId(aliId).txs.filter((t) => t.type === "payment").length;
  invoice.deleteFromHistory(inv1.id);
  customers.clearInvoiceDebt(inv1.id);
  assert.equal(debtTxs(inv1.id).length, 0);
  assert.equal(byId(aliId).txs.filter((t) => t.type === "payment").length, paymentsBefore);
  assert.equal(customerBalance(byId(aliId)), -200_000, "the 200k payment is now credit");
}

// ── ۱۰) پروفایل مشتری: مانده‌ی فاکتورها با فرمول فاکتور یکی است ──────────────
{
  const ins = customerInsights(byId(rezaId), [historyOf(inv4.id)], [], [], () => null);
  assert.equal(ins.invoiceRemaining, 300_000, "invoice-level remainder (excludes cheques)");
}

// ── ۱۱) ریال: ورودی ۵٬۰۰۰٬۰۰۰ ریال = ۵۰۰٬۰۰۰ تومان ذخیره‌ای ──────────────────
assert.equal(fromDisplayAmount(5_000_000, "rial"), 500_000);
assert.equal(toDisplayAmount(500_000, "rial"), 5_000_000);
assert.equal(fromDisplayAmount(500_000, "toman"), 500_000);

// ── ۱۲) حذف مشتری: فاکتورهایش در تاریخچه می‌مانند ───────────────────────────
{
  const count = invoice.getHistory().filter((i) => i.customer?.customerId === nimaId).length;
  assert.ok(count > 0);
  customers.remove(nimaId);
  assert.ok(!customers.getAll().some((c) => c.id === nimaId));
  assert.equal(
    invoice.getHistory().filter((i) => i.customer?.customerId === nimaId).length,
    count,
    "invoices are kept",
  );
  assert.ok(
    customers.getAll().some((c) => c.id === aliId),
    "other customers untouched",
  );
}

// ══ واریز فاکتور به حساب/کارت (مورد ۳) ═══════════════════════════════════════
const card = accounts.add({ name: "کارت ملت", openingBalance: 1_000_000 });
const bal = () => accountBalance(card, accountTxs.getAll());

// نقدی با کارت → کل مبلغ
const s1 = sell(
  {
    items: [{ productId: "q1", name: "کیف", price: 250_000, quantity: 2 }],
    paymentMethod: "card",
    accountId: card.id,
  },
  { firstName: "مهسا", phone: "09120000009" },
);
assert.equal(bal(), 1_500_000, "card invoice deposits its full total");
assert.equal(accountTxs.getAll().filter((t) => t.invoiceId === s1.id).length, 1);

// نسیه با پرداخت جزئی → فقط بخش پرداخت‌شده
const s2 = sell(
  {
    items: [{ productId: "q2", name: "کت", price: 1_000_000, quantity: 1 }],
    paymentMethod: "credit",
    paidAmount: 400_000,
    accountId: card.id,
  },
  { firstName: "مهسا", phone: "09120000009" },
);
assert.equal(invoiceReceivedNow(historyOf(s2.id)), 400_000);
assert.equal(bal(), 1_900_000, "never the credit part");
// چک → فقط نقد، نه چک
const s3 = sell(
  {
    items: [{ productId: "q3", name: "مبل", price: 2_000_000, quantity: 1 }],
    paymentMethod: "check",
    paidAmount: 500_000,
    cheques: [{ id: "c9", amount: 1_500_000 }],
    checkAmount: 1_500_000,
    accountId: card.id,
  },
  { firstName: "مهسا", phone: "09120000009" },
);
assert.equal(bal(), 2_400_000, "cheque is not cash yet");

// ویرایش فاکتور → همان واریز به‌روز می‌شود (نه دوتا)
{
  const before = historyOf(s1.id);
  const txId = accountTxs.getAll().find((t) => t.invoiceId === s1.id)!.id;
  invoice.updateHistory({ ...before, notes: "بدون تغییر مبلغ" });
  assert.equal(
    accountTxs.getAll().find((t) => t.invoiceId === s1.id)!.id,
    txId,
    "unchanged deposit is not rewritten",
  );
  invoice.updateHistory(
    recalc({ ...before, items: [{ productId: "q1", name: "کیف", price: 250_000, quantity: 3 }] }),
  );
  assert.equal(accountTxs.getAll().filter((t) => t.invoiceId === s1.id).length, 1);
  assert.equal(bal(), 2_650_000, "750,000 instead of 500,000");
}
// حذف فاکتور → واریزش برداشته می‌شود
invoice.deleteFromHistory(s3.id);
assert.equal(accountTxs.getAll().filter((t) => t.invoiceId === s3.id).length, 0);
assert.equal(bal(), 2_150_000);
invoice.deleteFromHistory(s2.id);
invoice.deleteFromHistory(s1.id);
assert.equal(bal(), 1_000_000, "back to the opening balance");

// بدون انتخاب حساب → مثل قبل، هیچ تراکنشی
const txCount = accountTxs.getAll().length;
sell(
  { items: [{ productId: "q4", name: "کلاه", price: 90_000, quantity: 1 }], paymentMethod: "card" },
  { firstName: "مهسا", phone: "09120000009" },
);
assert.equal(accountTxs.getAll().length, txCount, "no account → no deposit");
// حسابِ حذف‌شده → تراکنش یتیم ساخته نمی‌شود
sell(
  {
    items: [{ productId: "q5", name: "شال", price: 90_000, quantity: 1 }],
    paymentMethod: "cash",
    accountId: "deleted-account",
  },
  { firstName: "مهسا", phone: "09120000009" },
);
assert.equal(accountTxs.getAll().length, txCount, "unknown account → no deposit");

// هزینه‌ها (رفتار موجود): برداشت از همان حساب، ویرایش و حذف
{
  const e = { ...emptyExpense(), title: "اجاره", amount: 300_000, accountId: card.id };
  expenses.add(e);
  const added = expenses.getAll()[0];
  assert.equal(bal(), 700_000);
  expenses.update({ ...added, amount: 200_000 });
  assert.equal(accountTxs.getAll().filter((t) => t.expenseId === added.id).length, 1);
  assert.equal(bal(), 800_000);
  expenses.remove(added.id);
  assert.equal(bal(), 1_000_000);
}

console.log("customer-debt: all ok");
