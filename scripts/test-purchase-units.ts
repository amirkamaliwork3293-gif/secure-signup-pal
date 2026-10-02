/**
 * فاز ۲ — فاکتور خرید با کیلوگرم و گرم: تعویض واحد ورود، موجودی، قیمت خرید،
 * ویرایش، چاپ و متن اشتراک. خریدهای قدیمی باید دقیقاً مثل قبل رفتار کنند.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-purchase-units.ts
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

const { switchPurchaseLineUnit, newPurchaseLine } = await import("../src/lib/stock-moves.ts");
const { purchaseLineTotal, purchaseTotals } = await import("../src/lib/invoice-math.ts");
const { formatQtyWithUnit } = await import("../src/lib/qty-format.ts");
const store = await import("../src/lib/store.ts");
const { products, purchases, settings } = store;
type Product = import("../src/lib/store.ts").Product;
type PurchaseItem = import("../src/lib/store.ts").PurchaseItem;

const saffron: Product = {
  id: "s",
  name: "زعفران",
  price: 900_000,
  category: "",
  code: "",
  stock: 1,
  unit: "کیلوگرم",
  buyPrice: 700_000,
};

// ── new line snapshots product unit ──
const line = newPurchaseLine(saffron);
assert.equal(line.unit, "کیلوگرم");
assert.equal(line.productUnit, "کیلوگرم");
assert.equal(newPurchaseLine({ ...saffron, unit: undefined }).productUnit, "عدد");

// ── switching kg ⇄ g keeps the line total ──
const half: PurchaseItem = { ...line, quantity: 0.5, buyPrice: 200_000 };
const inG = switchPurchaseLineUnit(half, "گرم");
assert.equal(inG.quantity, 500);
assert.equal(inG.buyPrice, 200);
assert.equal(purchaseLineTotal(inG), purchaseLineTotal(half));
const back = switchPurchaseLineUnit(inG, "کیلوگرم");
assert.equal(back.quantity, 0.5);
assert.equal(back.buyPrice, 200_000);
const odd = switchPurchaseLineUnit({ ...line, quantity: 1.234, buyPrice: 1_234_567 }, "گرم");
assert.ok(Math.abs(purchaseLineTotal(odd) - Math.round(1.234 * 1_234_567)) <= 1);
assert.deepEqual(
  switchPurchaseLineUnit({ ...line, unit: "عدد", quantity: 3, buyPrice: 10 }, "کیلوگرم"),
  { ...line, unit: "کیلوگرم", quantity: 3, buyPrice: 10 },
  "unrelated units only relabel",
);

// ── formatting ──
assert.equal(formatQtyWithUnit(1.3, "کیلوگرم"), "۱ کیلو و ۳۰۰ گرم");
assert.equal(formatQtyWithUnit(0.5, "کیلوگرم"), "۵۰۰ گرم");
assert.equal(formatQtyWithUnit(2, "کیلوگرم"), "۲ کیلوگرم");
assert.equal(formatQtyWithUnit(750, "گرم"), "۷۵۰ گرم");
assert.equal(formatQtyWithUnit(3), "۳");

// ── store: edit a purchase by switching its entry unit ──
products.save([saffron]);
const saved = purchases.archive({
  id: "p1",
  createdAt: 1,
  items: [{ ...line, quantity: 2, buyPrice: 700_000 }],
  total: 1_400_000,
  paymentMethod: "cash",
});
assert.equal(products.findById("s")!.stock, 3);
// user changes to "2500 g" in the edit card
purchases.updateHistory({
  ...saved,
  items: [{ ...switchPurchaseLineUnit(saved.items[0], "گرم"), quantity: 2500 }],
});
assert.equal(products.findById("s")!.stock, 3.5, "2 kg → 2500 g adds 0.5 kg");

// ── legacy purchase (no unit, no productUnit) unchanged ──
products.save([{ ...saffron, id: "c", unit: undefined, stock: 4 }]);
purchases.archive({
  id: "legacy",
  createdAt: 1,
  items: [{ productId: "c", name: "x", quantity: 6, buyPrice: 5 }],
  total: 30,
});
assert.equal(products.findById("c")!.stock, 10);
assert.equal(products.findById("c")!.buyPrice, 5);

// ── print / share show units, discount and the right totals ──
const { buildPurchaseHTML, buildThermalPurchaseHTML } =
  await import("../src/components/PurchaseActions.tsx");
const pr = {
  id: "pp",
  createdAt: Date.now(),
  items: [
    { productId: "s", name: "زعفران", quantity: 500, buyPrice: 200, unit: "گرم" },
    { productId: "s", name: "زعفران", quantity: 1.3, buyPrice: 100_000, unit: "کیلوگرم" },
  ],
  total: 0,
  discountPercent: 10,
  paymentMethod: "credit" as const,
  paidAmount: 10_000,
};
const t = purchaseTotals(pr);
assert.equal(t.subtotal, 230_000);
assert.equal(t.total, 207_000);
settings.save({ ...settings.get(), currencyUnit: "toman" });
const a4 = buildPurchaseHTML(pr);
assert.ok(a4.includes("۵۰۰ گرم"));
assert.ok(a4.includes("۱ کیلو و ۳۰۰ گرم"));
assert.ok(a4.includes("تخفیف"));
assert.ok(a4.includes("۲۰۷٬۰۰۰"), "total from items, not the stale stored total");
assert.ok(a4.includes("۱۹۷٬۰۰۰"), "credit remaining after discount");
const th = buildThermalPurchaseHTML(pr);
assert.ok(th.includes("۵۰۰ گرم") && th.includes("۲۰۷٬۰۰۰"));

console.log("purchase units tests passed");
