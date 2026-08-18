/**
 * تبدیل واحد و کسر مواد فرمول تولید.
 * اجرا: node scripts/test-production.mjs
 */
import assert from "node:assert/strict";
import {
  convertQuantity,
  expandRecipeForQty,
  stockDeltasForSoldItems,
} from "../src/lib/production.ts";

assert.equal(convertQuantity(1, "کیلوگرم", "گرم"), 1000);
assert.equal(convertQuantity(500, "گرم", "کیلوگرم"), 0.5);
assert.equal(convertQuantity(2, "لیتر", "میلی‌لیتر"), 2000);
assert.equal(convertQuantity(3, "پیمانه", "پیمانه"), 3);
assert.equal(convertQuantity(3, "پیمانه", "لیتر"), 3, "واحد ناشناس تبدیل نمی‌شود");

const milk = {
  id: "milk",
  name: "شیر",
  price: 1,
  category: "",
  code: "",
  stock: 10,
  unit: "لیتر",
};
const cream = {
  id: "cream",
  name: "خامه",
  price: 1,
  category: "",
  code: "",
  stock: 5,
  unit: "لیتر",
};
const shake = {
  id: "shake",
  name: "شیک نوتلا",
  price: 1,
  category: "",
  code: "",
  stock: 0,
  unit: "عدد",
  recipe: [
    { productId: "milk", name: "شیر", quantity: 1, unit: "لیتر" },
    { productId: "cream", name: "خامه", quantity: 0.2, unit: "لیتر" },
  ],
};
const catalog = [milk, cream, shake];

{
  const usage = expandRecipeForQty(shake, 2, catalog);
  assert.equal(usage.find((u) => u.productId === "milk")?.quantity, 2);
  assert.equal(usage.find((u) => u.productId === "cream")?.quantity, 0.4);
}

{
  const deltas = stockDeltasForSoldItems(
    [{ productId: "shake", name: "شیک نوتلا", price: 1, quantity: 2, unit: "عدد" }],
    catalog,
  );
  assert.equal(deltas.get("shake"), 2, "خود محصول نهایی هم کم می‌شود");
  assert.equal(deltas.get("milk"), 2);
  assert.equal(deltas.get("cream"), 0.4);
}

{
  const prebuilt = { ...shake, stock: 5 };
  const cat = [milk, cream, prebuilt];
  const deltas = stockDeltasForSoldItems(
    [{ productId: "shake", name: "شیک نوتلا", price: 1, quantity: 2, unit: "عدد" }],
    cat,
  );
  assert.equal(deltas.get("shake"), 2);
  assert.equal(deltas.get("milk") ?? 0, 0, "اگر از قبل تولید شده مواد دوباره کم نمی‌شوند");
}

{
  const prebuilt = { ...shake, stock: 1 };
  const cat = [milk, cream, prebuilt];
  const deltas = stockDeltasForSoldItems(
    [{ productId: "shake", name: "شیک نوتلا", price: 1, quantity: 3, unit: "عدد" }],
    cat,
  );
  assert.equal(deltas.get("shake"), 3);
  assert.equal(deltas.get("milk"), 2, "کسری موجودی از مواد اولیه تأمین می‌شود");
}

{
  const glass = { id: "g", name: "گلس آیفون", price: 1, category: "", code: "", stock: 3 };
  const deltas = stockDeltasForSoldItems(
    [{ productId: "g", name: "گلس آیفون", price: 1, quantity: 1 }],
    [glass],
  );
  assert.equal(deltas.get("g"), 1);
  assert.equal(deltas.size, 1, "بدون فرمول فقط خود کالا کم می‌شود");
}

console.log("production formula ok");
