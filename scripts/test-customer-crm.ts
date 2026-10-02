/**
 * فاز ۴ — پروندهٔ مشتری (CRM): آمار، ماندهٔ جاری، فیلتر فاکتورها، صورت‌حساب،
 * و کارایی ایندکس با هزاران مشتری و فاکتور.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-customer-crm.ts
 */
import assert from "node:assert/strict";
import {
  customerInsights,
  customerStatus,
  filterCustomerDocs,
  ledgerWithBalance,
  statementText,
} from "../src/lib/customer-insights.ts";
import { buildCustomerDocIndex } from "../src/lib/customer-link.ts";
import type { Customer, Invoice, Product, Purchase } from "../src/lib/store.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1, 12);
// تبدیل ساده برای تست: ماه میلادی به‌جای شمسی (منطق کلید ماه همان است)
const toJ = (t: number) => {
  const d = new Date(t);
  return { jy: d.getUTCFullYear(), jm: d.getUTCMonth() + 1 };
};

const c: Customer = { id: "c", firstName: "رضا", createdAt: NOW - 400 * DAY, txs: [] };
const products: Product[] = [
  { id: "tea", name: "چای", price: 100, buyPrice: 60, category: "", code: "", stock: 1 },
];
const inv = (id: string, daysAgo: number, qty: number, extra: Partial<Invoice> = {}): Invoice => ({
  id,
  createdAt: NOW - daysAgo * DAY,
  items: [{ productId: "tea", name: "چای", price: 100, quantity: qty }],
  total: 100 * qty,
  customer: { firstName: "رضا", customerId: "c" },
  ...extra,
});
const invoices = [
  inv("a", 40, 2),
  inv("b", 30, 1, { paymentMethod: "credit", paidAmount: 20 }),
  inv("c1", 20, 3, { discountPercent: 10 }),
  inv("d", 10, 1),
];
const purchases: Purchase[] = [
  {
    id: "p",
    createdAt: NOW - 5 * DAY,
    items: [{ productId: "tea", name: "چای", quantity: 2, buyPrice: 50 }],
    total: 100,
  },
];

const ins = customerInsights(c, invoices, purchases, products, toJ, NOW);
assert.equal(ins.invoiceCount, 4);
assert.equal(ins.salesTotal, 200 + 100 + 270 + 100);
assert.equal(ins.avgInvoice, Math.round(670 / 4));
assert.equal(ins.daysSinceLast, 10);
assert.equal(ins.avgGapDays, 10);
assert.equal(ins.invoiceRemaining, 80, "credit invoice remaining after paid 20");
// profit: revenue after invoice discount − cost (60/unit)
assert.equal(ins.profit, 200 - 120 + (100 - 60) + (270 - 180) + (100 - 60));
assert.equal(ins.profitKnown, true);
assert.equal(ins.paymentMix.cash, 3);
assert.equal(ins.paymentMix.credit, 1);
assert.equal(ins.topProducts[0].qty, 7);
assert.equal(ins.monthly.length, 12);
assert.equal(
  ins.monthly.reduce((s, m) => s + m.total, 0),
  670,
);
assert.equal(ins.purchaseTotal, 100);
assert.equal(ins.status, "active");

assert.equal(customerStatus(0, null, null, 3), "new");
assert.equal(customerStatus(0, null, null, 300), "none");
assert.equal(customerStatus(5, 10, 10, 300), "active");
assert.equal(customerStatus(5, 40, 10, 300), "slipping");
assert.equal(customerStatus(5, 400, 10, 300), "lost");

// ── ledger running balance ──
const withTx: Customer = {
  ...c,
  txs: [
    { id: "3", type: "payment", amount: 300, at: 3 },
    { id: "1", type: "debt", amount: 1000, at: 1 },
    { id: "2", type: "debt", amount: 500, at: 2 },
  ],
};
const ledger = ledgerWithBalance(withTx);
assert.deepEqual(
  ledger.map((r) => [r.tx.id, r.balance]),
  [
    ["3", 1200],
    ["2", 1500],
    ["1", 1000],
  ],
);
const txt = statementText(
  withTx,
  "فروشگاه",
  (n) => `${n}`,
  () => "D",
);
assert.ok(txt.includes("مانده بدهی شما: 1200"));
assert.ok(txt.indexOf("بدهی 1000") < txt.indexOf("پرداخت 300"), "statement reads oldest → newest");

// ── filters ──
assert.equal(filterCustomerDocs(invoices, purchases, {}, NOW).length, 5);
assert.deepEqual(
  filterCustomerDocs(invoices, purchases, { payment: "open" }, NOW).map((d) => d.doc.id),
  ["b"],
);
assert.equal(filterCustomerDocs(invoices, purchases, { kind: "purchases" }, NOW).length, 1);
assert.equal(filterCustomerDocs(invoices, purchases, { days: 25 }, NOW).length, 3);
assert.equal(filterCustomerDocs(invoices, purchases, { q: "چاي" }, NOW).length, 5, "Arabic ی");
assert.equal(filterCustomerDocs(invoices, purchases, { q: "C1" }, NOW).length, 1);

// ── performance: 2,000 customers × 20,000 invoices ──
const many: Customer[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `c${i}`,
  firstName: `نام${i}`,
  lastName: `فامیل${i % 300}`,
  phone: `0912${String(1000000 + i)}`,
  createdAt: 1,
  txs: [],
}));
const bigInvoices: Invoice[] = Array.from({ length: 20000 }, (_, i) => {
  const k = i % 2000;
  return {
    id: `i${i}`,
    createdAt: i,
    items: [],
    total: 1,
    customer:
      i % 3 === 0
        ? { firstName: `نام${k}`, lastName: `فامیل${k % 300}`, customerId: `c${k}` }
        : i % 3 === 1
          ? { firstName: "x", phone: `0912${String(1000000 + k)}` }
          : { firstName: `نام${k}`, lastName: `فامیل${k % 300}` },
  };
});
const t0 = performance.now();
const big = buildCustomerDocIndex(many, bigInvoices, []);
const ms = performance.now() - t0;
const total = [...big.byCustomer.values()].reduce((s, d) => s + d.invoices.length, 0);
assert.equal(total, 20000);
assert.ok(ms < 1500, `index too slow: ${ms.toFixed(0)}ms`);
console.log(`index of 2,000 customers / 20,000 invoices built in ${ms.toFixed(0)} ms`);

console.log("customer CRM tests passed");
