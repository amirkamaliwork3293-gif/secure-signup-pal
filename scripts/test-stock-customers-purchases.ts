/**
 * تست هویت فاکتور مشتری، موجودی هنگام افزودن به فاکتور، و مانده خرید نسیه.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-stock-customers-purchases.ts
 */

import assert from "node:assert/strict";
import { namesReferToSamePerson } from "../src/lib/search.ts";
import {
  emptyInvoice,
  evaluateInvoiceStockAdd,
  evaluateInvoiceStockSet,
  invoiceBelongsToCustomer,
  invoicesOfCustomer,
  purchaseBelongsToCustomer,
  purchaseCreditRemaining,
  addProductToInvoice,
  addProductToInvoiceQty,
  supplierToCustomerInfo,
  type Customer,
  type Invoice,
  type Product,
  type Purchase,
} from "../src/lib/store.ts";

const taheriAli: Customer = {
  id: "c-ali-taheri",
  firstName: "علی",
  lastName: "طاهری",
  phone: "09121111111",
  createdAt: 1,
  txs: [],
};
const taheriMohammad: Customer = {
  id: "c-mohammad-taheri",
  firstName: "محمد",
  lastName: "طاهری",
  phone: "09122222222",
  createdAt: 1,
  txs: [],
};
const aliOnly: Customer = {
  id: "c-ali",
  firstName: "علی",
  createdAt: 1,
  txs: [],
};

assert.equal(namesReferToSamePerson(taheriAli, taheriAli), true);
assert.equal(namesReferToSamePerson(taheriAli, { firstName: "علی طاهری" }), true);
assert.equal(namesReferToSamePerson(taheriAli, taheriMohammad), false);
assert.equal(namesReferToSamePerson(taheriAli, aliOnly), false);
assert.equal(namesReferToSamePerson({ firstName: "طاهری" }, taheriAli), false);
assert.equal(
  namesReferToSamePerson(
    { firstName: "علی", lastName: "طاهری" },
    { firstName: "طاهری", lastName: "علی" },
  ),
  true,
);

const invAliPhone: Invoice = {
  id: "i1",
  createdAt: 1,
  items: [],
  total: 1000,
  customer: { firstName: "علی", lastName: "طاهری", phone: "09121111111" },
};
const invAliId: Invoice = {
  id: "i2",
  createdAt: 1,
  items: [],
  total: 2000,
  customer: { firstName: "علی", lastName: "طاهری", customerId: "c-ali-taheri" },
};
const invMohammad: Invoice = {
  id: "i3",
  createdAt: 1,
  items: [],
  total: 3000,
  customer: { firstName: "محمد", lastName: "طاهری" },
};
const invLastNameOnly: Invoice = {
  id: "i4",
  createdAt: 1,
  items: [],
  total: 4000,
  customer: { firstName: "طاهری" },
};

assert.equal(invoiceBelongsToCustomer(invAliPhone, taheriAli), true);
assert.equal(invoiceBelongsToCustomer(invAliPhone, taheriMohammad), false);
assert.equal(invoiceBelongsToCustomer(invAliId, taheriAli), true);
assert.equal(invoiceBelongsToCustomer(invAliId, taheriMohammad), false);
assert.equal(invoiceBelongsToCustomer(invMohammad, taheriAli), false);
assert.equal(invoiceBelongsToCustomer(invLastNameOnly, taheriAli), false);

const mixed = invoicesOfCustomer(taheriAli, [
  invAliPhone,
  invAliId,
  invMohammad,
  invLastNameOnly,
]);
assert.deepEqual(
  mixed.map((i) => i.id).sort(),
  ["i1", "i2"],
);

const tracked: Product = {
  id: "p1",
  name: "شیر",
  price: 10000,
  category: "لبنیات",
  code: "1",
  stock: 2,
  lowStockThreshold: 5,
};
const untracked: Product = {
  id: "p2",
  name: "تعمیر",
  price: 50000,
  category: "خدمات",
  code: "2",
  stock: 0,
  trackStock: false,
};

let inv = emptyInvoice();
const first = evaluateInvoiceStockAdd(tracked, inv, 1);
assert.equal(first.ok, true);
assert.equal(first.kind, "low");
inv = addProductToInvoice(inv, tracked);
assert.equal(inv.items[0].quantity, 1);

const second = evaluateInvoiceStockAdd(tracked, inv, 1);
assert.equal(second.ok, true);
assert.equal(second.kind, "last");
inv = addProductToInvoice(inv, tracked);
assert.equal(inv.items[0].quantity, 2);

const third = evaluateInvoiceStockAdd(tracked, inv, 1);
assert.equal(third.ok, false);
assert.equal(third.kind, "out");
const blocked = addProductToInvoice(inv, tracked);
assert.equal(blocked.items[0].quantity, 2);

const tooMany = addProductToInvoiceQty(emptyInvoice(), tracked, 5);
assert.equal(tooMany.items.length, 0);
assert.equal(evaluateInvoiceStockAdd(tracked, emptyInvoice(), 5).kind, "insufficient");

const service = addProductToInvoice(emptyInvoice(), untracked);
assert.equal(service.items[0].quantity, 1);
assert.equal(evaluateInvoiceStockAdd(untracked, service, 10).ok, true);

const histEdit = evaluateInvoiceStockSet(tracked, 4, { committedQty: 2 });
assert.equal(histEdit.ok, true);
assert.equal(histEdit.after, 0);
const histTooMuch = evaluateInvoiceStockSet(tracked, 5, { committedQty: 2 });
assert.equal(histTooMuch.ok, false);

const creditPurchase: Purchase = {
  id: "buy1",
  createdAt: 1,
  items: [{ productId: "p1", name: "شیر", quantity: 1, buyPrice: 8000 }],
  total: 8000,
  paymentMethod: "credit",
  paidAmount: 2000,
  supplierName: "علی طاهری",
  supplierPhone: "09121111111",
};
assert.equal(purchaseCreditRemaining(creditPurchase), 6000);
assert.equal(purchaseCreditRemaining({ ...creditPurchase, paymentMethod: "cash" }), 0);
assert.equal(purchaseBelongsToCustomer(creditPurchase, taheriAli), true);
assert.equal(purchaseBelongsToCustomer(creditPurchase, taheriMohammad), false);

const info = supplierToCustomerInfo("فروشگاه رضایی", "09123333333", "c-9");
assert.equal(info.firstName, "فروشگاه");
assert.equal(info.lastName, "رضایی");
assert.equal(info.customerId, "c-9");

console.log("stock / customer-invoice / purchase-credit tests passed");
