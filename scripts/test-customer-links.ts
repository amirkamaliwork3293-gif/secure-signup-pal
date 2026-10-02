/**
 * فاز ۳ — اتصال قطعی فاکتور به مشتری (بدون حدس) و فیلدهای اختصاصی سنجاق‌شده.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-customer-links.ts
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
  location: { origin: "http://x" },
};
(globalThis as { localStorage?: unknown }).localStorage = localStorage;

const link = await import("../src/lib/customer-link.ts");
const cf = await import("../src/lib/customer-fields.ts");
const store = await import("../src/lib/store.ts");
const { customers, invoice, purchases, dataHealth, customerAmbiguity, invoicesOfCustomer } = store;
type Customer = import("../src/lib/store.ts").Customer;
type Invoice = import("../src/lib/store.ts").Invoice;

const ali1: Customer = { id: "a1", firstName: "علی", lastName: "رضایی", createdAt: 1, txs: [] };
const ali2: Customer = { id: "a2", firstName: "علی", lastName: "رضایی", createdAt: 2, txs: [] };
const sara: Customer = {
  id: "s",
  firstName: "سارا",
  lastName: "کریمی",
  phone: "09121234567",
  createdAt: 3,
  txs: [],
};
const idx = link.buildCustomerIndex([ali1, ali2, sara]);

// ── matching never guesses ──
assert.equal(link.matchCustomer({ customerId: "a2" }, idx).kind, "id");
assert.equal(link.matchCustomer({ firstName: "علی", lastName: "رضایی" }, idx).kind, "ambiguous");
assert.equal(link.matchCustomer({ firstName: "x", phone: "+98 912 123 4567" }, idx).kind, "phone");
assert.equal(
  link.matchCustomer({ firstName: "سارا", lastName: "کریمی", phone: "09350000000" }, idx).kind,
  "none",
  "same name, different phone = different person",
);
assert.equal(
  link.matchCustomer({ firstName: "سارا", lastName: "کریمی", phone: "123" }, idx).kind,
  "none",
  "short phone never matches (legacy rule)",
);
assert.equal(link.matchCustomer({ firstName: "کریمی", lastName: "سارا" }, idx).kind, "name");
assert.equal(
  link.matchCustomer({ firstName: "سارا", lastName: "كريمي" }, idx).kind,
  "name",
  "Arabic ي/ك",
);

// ── document index ──
const legacyAmbiguous: Invoice = {
  id: "i1",
  createdAt: 10,
  items: [],
  total: 5,
  customer: { firstName: "علی", lastName: "رضایی" },
};
const linked: Invoice = {
  id: "i2",
  createdAt: 11,
  items: [],
  total: 7,
  customer: { firstName: "نام قدیمی", customerId: "a1" },
};
const legacySara: Invoice = {
  id: "i3",
  createdAt: 12,
  items: [],
  total: 9,
  customer: { firstName: "سارا", lastName: "کریمی", phone: "0912 123 4567" },
};
const orphan: Invoice = {
  id: "i4",
  createdAt: 13,
  items: [],
  total: 1,
  customer: { firstName: "x", customerId: "deleted" },
};
const docs = link.buildCustomerDocIndex(
  [ali1, ali2, sara],
  [legacyAmbiguous, linked, legacySara, orphan],
);
assert.deepEqual(
  docs.byCustomer.get("a1")!.invoices.map((i) => i.id),
  ["i2"],
);
assert.equal(
  docs.byCustomer.get("a2"),
  undefined,
  "ambiguous legacy invoice is under neither namesake",
);
assert.deepEqual(
  docs.byCustomer.get("s")!.invoices.map((i) => i.id),
  ["i3"],
);
assert.equal(docs.ambiguous.length, 1);
assert.equal(docs.orphanLinked, 1);
assert.deepEqual(invoicesOfCustomer(ali2, [legacyAmbiguous, linked], [ali1, ali2]), []);
assert.deepEqual(
  invoicesOfCustomer(ali1, [legacyAmbiguous, linked], [ali1, ali2]).map((i) => i.id),
  ["i2"],
);

// ── suggestions ──
const sug = link.linkSuggestions([ali1, ali2, sara], [legacyAmbiguous, linked, legacySara], []);
assert.equal(sug.length, 2, "already-linked invoices are not suggested");
assert.equal(sug.find((x) => x.docId === "i3")!.reason, "phone");
assert.equal(sug.find((x) => x.docId === "i1")!.reason, "ambiguous");
assert.equal(sug.find((x) => x.docId === "i1")!.suggested, undefined);

// ── store: ambiguity, links, snapshots ──
customers.save([ali1, ali2, sara]);
assert.deepEqual(
  customerAmbiguity({ firstName: "علی", lastName: "رضایی" })
    .map((c) => c.id)
    .sort(),
  ["a1", "a2"],
);
assert.deepEqual(customerAmbiguity({ firstName: "علی", lastName: "رضایی", customerId: "a1" }), []);
assert.deepEqual(customerAmbiguity({ firstName: "سارا", lastName: "کریمی" }), []);

invoice.archive({ ...legacyAmbiguous, id: "h1" });
invoice.archive({ ...legacySara, id: "h3" });
const before = invoice.getHistory().find((i) => i.id === "h3")!;
const res = dataHealth.apply([
  { kind: "link-invoice-customer", invoiceId: "h3", customerId: "s" },
  { kind: "link-invoice-customer", invoiceId: "h1", customerId: "missing" },
]);
assert.equal(res.applied, 1, "linking to a non-existent customer is refused");
const after = invoice.getHistory().find((i) => i.id === "h3")!;
assert.equal(after.customer!.customerId, "s");
assert.equal(after.customer!.firstName, before.customer!.firstName, "printed name unchanged");
assert.equal(after.total, before.total);
assert.equal(
  dataHealth.apply([{ kind: "link-invoice-customer", invoiceId: "h3", customerId: "a1" }]).applied,
  0,
  "an existing link is never overwritten",
);

// renamed customer with a new phone keeps the linked invoice
customers.update({
  ...customers.getAll().find((c) => c.id === "s")!,
  firstName: "سارا خانم",
  phone: "09359999999",
});
const s2 = customers.getAll().find((c) => c.id === "s")!;
assert.deepEqual(
  invoicesOfCustomer(s2, invoice.getHistory(), customers.getAll()).map((i) => i.id),
  ["h3"],
);
dataHealth.undo(res.undo);
assert.equal(invoice.getHistory().find((i) => i.id === "h3")!.customer!.customerId, undefined);

// purchases: unique supplier match is linked (even cash); namesakes never
const pu1 = purchases.archive({
  id: "p1",
  createdAt: 1,
  items: [],
  total: 0,
  supplierName: "سارا خانم کریمی",
  paymentMethod: "cash",
});
assert.equal(pu1.supplierCustomerId, "s");
const pu2 = purchases.archive({
  id: "p2",
  createdAt: 1,
  items: [],
  total: 0,
  supplierName: "علی رضایی",
  paymentMethod: "cash",
});
assert.equal(pu2.supplierCustomerId, undefined);

// ── custom fields ──
const fields = [
  { id: "1", label: "کد ملی", value: " 0012345678 ", pinned: true },
  { id: "2", label: "نشانی", value: "تهران", pinned: false },
  { id: "3", label: "نام شرکت", value: "", pinned: true },
];
assert.deepEqual(cf.pinnedInvoiceFields({ fields }), [{ label: "کد ملی", value: "0012345678" }]);
assert.deepEqual(cf.customerFields({ fields: [null, { label: 1 }] as never }), []);
assert.deepEqual(
  cf.cleanInvoiceFields([
    { label: "کد ملی", value: "1" },
    { label: " کد  ملی", value: "2" },
    { label: "x", value: " " },
  ]),
  [{ label: "کد ملی", value: "1" }],
);
assert.equal(cf.cleanInvoiceFields([]), undefined);
assert.deepEqual(
  cf.prefillTemplateFields(
    [
      { id: "t1", label: "كد ملي" },
      { id: "t2", label: "شماره سفارش" },
    ],
    [{ label: "کد ملی", value: "99" }],
    { t2: "abc" },
  ),
  { t1: "99", t2: "abc" },
);
const keep = { t1: "typed" };
assert.equal(
  cf.prefillTemplateFields(
    [{ id: "t1", label: "کد ملی" }],
    [{ label: "کد ملی", value: "99" }],
    keep,
  ),
  keep,
);
assert.ok(
  cf
    .fieldLabelSuggestions([{ ...ali1, fields: [{ id: "x", label: "کد مشتری", value: "1" }] }])
    .includes("کد مشتری"),
);

customers.upsertFields("a1", [{ label: "کد ملی", value: "111" }]);
customers.upsertFields("a1", [{ label: "کد ملي", value: "222" }]);
const a1 = customers.getAll().find((c) => c.id === "a1")!;
assert.equal(a1.fields!.length, 1, "same label (normalized) is updated, not duplicated");
assert.equal(a1.fields![0].value, "222");
assert.equal(a1.fields![0].pinned, true);

// issued invoice keeps its snapshot when the profile changes later
invoice.archive({
  ...store.emptyInvoice(),
  id: "snap",
  customer: { firstName: "علی", lastName: "رضایی", customerId: "a1" },
  customerFields: [{ label: "کد ملی", value: "222" }],
});
customers.upsertFields("a1", [{ label: "کد ملی", value: "333" }]);
assert.equal(invoice.getHistory().find((i) => i.id === "snap")!.customerFields![0].value, "222");

// ── outputs show the fields ──
const { buildDefaultInvoiceHTML, buildShareText, buildThermalInvoiceHTML } =
  await import("../src/lib/invoice-document.ts");
const snap = invoice.getHistory().find((i) => i.id === "snap")!;
assert.ok(buildDefaultInvoiceHTML(snap).includes("کد ملی"));
assert.ok(buildShareText(snap).includes("کد ملی: 222"));
if (typeof buildThermalInvoiceHTML === "function") {
  assert.ok(buildThermalInvoiceHTML(snap).includes("222"));
}
const { resolveField } = await import("../src/lib/invoice-template.ts");
assert.equal(resolveField(snap, { id: "z", label: "کد ملی", key: "blank" }), "222");
assert.equal(resolveField(snap, { id: "z", label: "x", key: "customer.fields" }), "کد ملی: 222");
assert.equal(resolveField(snap, { id: "z", label: "نشانی", key: "blank" }), "");

console.log("customer links tests passed");
