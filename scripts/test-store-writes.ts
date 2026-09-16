/**
 * تست نوشتن دفتر مشتریان برای خرید نسیه، با localStorage شبیه‌سازی‌شده.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-store-writes.ts
 */

import assert from "node:assert/strict";

const mem = new Map<string, string>();
const localStorage = {
  getItem(key: string) {
    return mem.has(key) ? mem.get(key)! : null;
  },
  setItem(key: string, value: string) {
    mem.set(key, value);
  },
  removeItem(key: string) {
    mem.delete(key);
  },
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
(globalThis as { window?: unknown; localStorage?: unknown }).window = {
  localStorage,
  dispatchEvent() {
    return true;
  },
  addEventListener() {},
  removeEventListener() {},
  setInterval() {
    return 0;
  },
};
(globalThis as { localStorage?: unknown }).localStorage = localStorage;

const store = await import("../src/lib/store.ts");
const {
  customers,
  purchases,
  customerBalance,
  invoicesOfCustomer,
  emptyInvoice,
  addProductToInvoice,
  products,
} = store;

const milk = {
  id: "milk",
  name: "شیر",
  price: 20000,
  category: "لبنیات",
  code: "m1",
  stock: 1,
  lowStockThreshold: 5,
};
products.save([milk]);

const draft = addProductToInvoice(emptyInvoice(), milk);
assert.equal(draft.items[0].quantity, 1);
const blocked = addProductToInvoice(draft, milk);
assert.equal(blocked.items[0].quantity, 1, "cannot add after last unit is on the invoice");

const saved = purchases.archive({
  id: "buy-credit-1",
  createdAt: Date.now(),
  items: [{ productId: "milk", name: "شیر", quantity: 3, buyPrice: 15000 }],
  total: 45000,
  paymentMethod: "credit",
  paidAmount: 5000,
  supplierName: "علی طاهری",
  supplierPhone: "09121111111",
});
const list = customers.getAll();
assert.equal(list.length, 1);
assert.equal(list[0].firstName, "علی");
assert.equal(list[0].lastName, "طاهری");
assert.equal(customerBalance(list[0]), -40000, "credit purchase should make supplier a creditor");
assert.equal(list[0].txs[0].purchaseId, saved.id);
assert.equal(saved.supplierCustomerId, list[0].id);

purchases.updateHistory({ ...saved, paidAmount: 45000, paymentMethod: "credit" });
assert.equal(customerBalance(customers.getAll()[0]), 0, "full pay should clear creditor balance");

purchases.updateHistory({ ...saved, paidAmount: 0, paymentMethod: "credit", total: 45000 });
assert.equal(customerBalance(customers.getAll()[0]), -45000);

purchases.deleteFromHistory(saved.id);
assert.equal(customers.getAll()[0].txs.length, 0, "delete purchase removes payable tx");

const ali = customers.getAll()[0];
const invs = invoicesOfCustomer(ali, [
  {
    id: "s1",
    createdAt: 1,
    items: [],
    total: 1,
    customer: { firstName: "محمد", lastName: "طاهری" },
  },
  {
    id: "s2",
    createdAt: 1,
    items: [],
    total: 1,
    customer: { firstName: "علی", lastName: "طاهری", phone: "09121111111" },
  },
]);
assert.deepEqual(
  invs.map((i) => i.id),
  ["s2"],
);

console.log("store write tests passed");
