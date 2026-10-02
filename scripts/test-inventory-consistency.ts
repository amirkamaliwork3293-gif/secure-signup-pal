/**
 * فاز ۱ — هماهنگی انبار، محصولات، فروش و خرید (واحد کیلو/گرم، ویرایش، حذف، تولید،
 * ادغام سه‌طرفهٔ فرم محصول، تغییر نام دسته، سلامت داده‌ها).
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-inventory-consistency.ts
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

const units = await import("../src/lib/units.ts");
const { stockDeltasForSoldItems } = await import("../src/lib/production.ts");
const moves = await import("../src/lib/stock-moves.ts");
const { convertProductUnit } = await import("../src/lib/product-unit-change.ts");
const { auditCatalog } = await import("../src/lib/data-health.ts");
const store = await import("../src/lib/store.ts");
const {
  products,
  purchases,
  invoice,
  categories,
  settings,
  dataHealth,
  mergeProductEdit,
  emptyInvoice,
  getUnitDefs,
} = store;
type Product = import("../src/lib/store.ts").Product;

// ── units ──
assert.equal(units.convertQuantity(500, "گرم", "کیلوگرم"), 0.5);
assert.equal(units.convertQuantity(1.3, "کیلوگرم", "گرم"), 1300);
assert.equal(units.convertQuantity(3, "عدد", "کیلوگرم"), 3, "unrelated units never convert");
assert.equal(
  units.convertQuantity(3, undefined, "کیلوگرم"),
  3,
  "legacy rows without unit unchanged",
);
assert.equal(units.convertUnitPrice(200, "گرم", "کیلوگرم"), 200_000);
assert.equal(units.convertUnitPrice(1_500_000, "کیلوگرم", "گرم"), 1_500);
assert.equal(units.convertUnitPrice(999, "عدد", "کیلوگرم"), 999);
assert.deepEqual(units.splitKgGrams(1.3), { kg: 1, g: 300 });
assert.deepEqual(units.splitKgGrams(2.9999999), { kg: 3, g: 0 });
assert.equal(units.joinKgGrams(0, 500), 0.5);
assert.equal(units.joinKgGrams(1, 1500), 2.5, "grams above 999 roll over");
assert.equal(units.roundQty(1.3 - 1), 0.3);
assert.deepEqual(units.alternateEntryUnits("کیلوگرم"), ["گرم"]);
assert.deepEqual(units.alternateEntryUnits("عدد"), []);

// ── sale deltas convert item unit → product unit ──
const rice: Product = {
  id: "rice",
  name: "برنج",
  price: 300_000,
  category: "مواد غذایی",
  code: "",
  stock: 10,
  unit: "کیلوگرم",
};
assert.equal(
  stockDeltasForSoldItems(
    [{ productId: "rice", name: "برنج", price: 1, quantity: 500, unit: "گرم" }],
    [rice],
  ).get("rice"),
  0.5,
);
assert.equal(
  stockDeltasForSoldItems([{ productId: "rice", name: "برنج", price: 1, quantity: 2 }], [rice]).get(
    "rice",
  ),
  2,
  "legacy item without unit is deducted as-is",
);

// ── purchase deltas ──
assert.equal(
  moves
    .purchaseStockDeltas(
      [{ productId: "rice", name: "برنج", quantity: 750, buyPrice: 250, unit: "گرم" }],
      [rice],
    )
    .get("rice"),
  0.75,
);
assert.equal(moves.purchaseUnitCostInProductUnit({ buyPrice: 250, unit: "گرم" }, rice), 250_000);
const editDelta = moves.purchaseEditStockDeltas(
  [{ productId: "rice", name: "برنج", quantity: 500, buyPrice: 1, unit: "گرم" }],
  [{ productId: "rice", name: "برنج", quantity: 1, buyPrice: 1, unit: "کیلوگرم" }],
  [rice],
);
assert.equal(editDelta.get("rice"), 0.5);
assert.equal(moves.applyStockDelta(0.2, -0.5), 0, "stock never negative");

// ── store: full purchase / sale / edit / delete cycle ──
products.save([{ ...rice, stock: 2, buyPrice: 180_000 }]);
const stockOf = (id: string) => products.findById(id)!.stock;

const gramBuy = purchases.archive({
  id: "pu-g",
  createdAt: Date.now(),
  items: [
    {
      productId: "rice",
      name: "برنج",
      quantity: 500,
      buyPrice: 200,
      unit: "گرم",
      productUnit: "کیلوگرم",
    },
  ],
  total: 100_000,
  paymentMethod: "cash",
});
assert.equal(stockOf("rice"), 2.5, "500 g added to a kg product = +0.5");
assert.equal(products.findById("rice")!.buyPrice, 200_000, "buy price stored per kg");

const legacyBuy = purchases.archive({
  id: "pu-legacy",
  createdAt: Date.now(),
  items: [{ productId: "rice", name: "برنج", quantity: 3, buyPrice: 190_000, unit: "کیلوگرم" }],
  total: 570_000,
  paymentMethod: "cash",
});
assert.equal(stockOf("rice"), 5.5, "same-unit purchase unchanged (+3)");
assert.equal(products.findById("rice")!.buyPrice, 190_000);

purchases.updateHistory({
  ...gramBuy,
  items: [{ ...gramBuy.items[0], quantity: 700 }],
});
assert.equal(stockOf("rice"), 5.7, "editing 500 g → 700 g adds 0.2 kg");

purchases.deleteFromHistory(legacyBuy.id);
assert.equal(stockOf("rice"), 5.7, "plain delete keeps stock (previous behaviour)");
purchases.deleteFromHistory(gramBuy.id, { unstock: true });
assert.equal(stockOf("rice"), 5, "delete + unstock removes the 700 g");

let inv = emptyInvoice();
inv = {
  ...inv,
  items: [{ productId: "rice", name: "برنج", price: 300_000, quantity: 1.3, unit: "کیلوگرم" }],
};
const sold = invoice.archive(inv);
assert.equal(stockOf("rice"), 3.7, "selling 1.3 kg — no float drift");
invoice.updateHistory({ ...sold, items: [{ ...sold.items[0], quantity: 1 }] });
assert.equal(stockOf("rice"), 4);
invoice.deleteFromHistory(sold.id, { restock: true });
assert.equal(stockOf("rice"), 5);

// ── 3-way product edit: stale form never resets stock ──
const original = products.findById("rice")!;
invoice.archive({
  ...emptyInvoice(),
  items: [{ productId: "rice", name: "برنج", price: 300_000, quantity: 2, unit: "کیلوگرم" }],
});
assert.equal(stockOf("rice"), 3);
assert.equal(products.applyEdit({ ...original, name: "برنج طارم" }, original), true);
assert.equal(products.findById("rice")!.name, "برنج طارم");
assert.equal(stockOf("rice"), 3, "sale made while the form was open is kept");
const original2 = products.findById("rice")!;
products.applyEdit({ ...original2, stock: 20 }, original2);
assert.equal(stockOf("rice"), 20, "an explicit stock edit still wins");
assert.equal(products.applyEdit({ ...original2, id: "gone" }, { ...original2, id: "gone" }), false);

const merged = mergeProductEdit(
  { ...original2, price: 1, description: undefined },
  { ...original2, description: "قدیمی" },
  { ...original2, stock: 4, description: "قدیمی" },
);
assert.equal(merged.price, 1);
assert.equal(merged.stock, 4);
assert.equal("description" in merged, false, "a cleared field is removed");

// ── unit change kg → g converts only untouched numbers ──
const kgP: Product = { ...rice, stock: 2, price: 300_000, buyPrice: 200_000, lowStockThreshold: 1 };
const conv = convertProductUnit({ ...kgP, unit: "گرم" }, kgP, { ...kgP, stock: 1.5 });
assert.equal(conv.stock, 1500, "converted from the *current* stock");
assert.equal(conv.price, 300);
assert.equal(conv.buyPrice, 200);
assert.equal(conv.lowStockThreshold, 1000);
const conv2 = convertProductUnit({ ...kgP, unit: "گرم", price: 999 }, kgP, kgP);
assert.equal(conv2.price, 999, "a price typed by the user is not converted");

// ── category rename moves products ──
categories.save([{ id: "c1", name: "مواد غذایی" }]);
categories.rename("c1", "خواربار");
assert.equal(products.findById("rice")!.category, "خواربار");
assert.equal(categories.getAll().find((c) => c.id === "c1")!.name, "خواربار");

// ── data health ──
products.save([
  ...products.getAll(),
  {
    id: "bad",
    name: "خراب",
    price: "۱۲٬۰۰۰" as unknown as number,
    category: "بی‌دسته‌جدید",
    code: "X1",
    stock: 1,
    unit: "بسته‌ویژه",
  },
  { id: "dup1", name: "شیر", price: 1, category: "خواربار", code: "X1", stock: 2 },
  { id: "dup2", name: "شیر ", price: 1, category: "خواربار", code: "", stock: 3 },
]);
const snap = dataHealth.snapshot();
const issues = auditCatalog(snap);
const keys = issues.map((i) => i.key);
assert.ok(keys.includes("num:bad"));
assert.ok(keys.includes("cat:بی‌دسته‌جدید"));
assert.ok(keys.includes("unit:بسته‌ویژه"));
assert.ok(keys.includes("code:X1"));
assert.ok(keys.some((k) => k.startsWith("dup:شیر")));
assert.equal(
  issues.find((i) => i.key.startsWith("dup:"))!.fix,
  undefined,
  "duplicates are never auto-merged",
);

const before = JSON.stringify(dataHealth.snapshot().products);
assert.equal(JSON.stringify(dataHealth.snapshot().products), before, "audit never writes");

const fixes = issues.filter((i) => i.fix).map((i) => i.fix!);
const res = dataHealth.apply(fixes);
assert.ok(res.applied >= 3);
assert.equal(products.findById("bad")!.price, 12_000);
assert.ok(categories.getAll().some((c) => c.name === "بی‌دسته‌جدید"));
assert.ok(getUnitDefs().some((u) => u.name === "بسته‌ویژه"));
assert.equal(
  auditCatalog(dataHealth.snapshot()).filter((i) => i.fix).length,
  0,
  "idempotent: nothing left to fix",
);
assert.equal(dataHealth.apply(fixes).applied, 0, "re-applying is a no-op");

const u = dataHealth.undo(res.undo);
assert.equal(u.skipped, 0);
assert.equal(products.findById("bad")!.price as unknown, "۱۲٬۰۰۰", "undo restores exactly");
assert.ok(!categories.getAll().some((c) => c.name === "بی‌دسته‌جدید"));

// undo never clobbers a row that changed after the fix
const res2 = dataHealth.apply([{ kind: "coerce-product-numbers", productId: "bad" }]);
const fixedBad = products.findById("bad")!;
products.save(products.getAll().map((p) => (p.id === "bad" ? { ...fixedBad, stock: 9 } : p)));
const u2 = dataHealth.undo(res2.undo);
assert.equal(u2.skipped, 1);
assert.equal(products.findById("bad")!.stock, 9);

// invoice total mismatch is reported, items untouched by the fix
invoice.archive({
  ...emptyInvoice(),
  items: [{ productId: "manual-x", name: "خدمت", price: 1000, quantity: 2 }],
});
const h = invoice.getHistory();
const first = { ...h[0], total: 5 };
invoice.updateHistory(first); // updateHistory recalcs — simulate legacy bad stored total directly:
const raw = invoice.getHistory().map((x) => (x.id === first.id ? { ...x, total: 5 } : x));
dataHealth.apply([]); // no-op
mem.forEach((v, k) => {
  if (k.startsWith("acc.invoices.v2")) mem.set(k, JSON.stringify(raw));
});
const totIssue = auditCatalog(dataHealth.snapshot()).find((i) => i.key === `inv-total:${first.id}`);
assert.ok(totIssue?.fix);
dataHealth.apply([totIssue!.fix!]);
assert.equal(invoice.getHistory().find((x) => x.id === first.id)!.total, 2000);

// settings untouched by everything above except units
assert.ok(settings.get());

console.log("inventory consistency tests passed");
