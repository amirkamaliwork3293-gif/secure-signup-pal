/**
 * تست استخراج مشتری/تلفن در ثبت صوتی + جدا نشدن کالا.
 * اجرا: npx tsx --tsconfig tsconfig.json scripts/test-voice-customer.ts
 */

import { parseVoiceText } from "../src/lib/voice/persian-nlu";
import { customerInfoFromVoice, splitPersonName } from "../src/lib/voice/invoice-customer";
import type { Customer, Product } from "../src/lib/store";

const shirt: Product = {
  id: "p-shirt",
  name: "تیشرت",
  price: 200000,
  category: "پوشاک",
  code: "1",
  stock: 20,
};
const pants: Product = {
  id: "p-pants",
  name: "شلوار",
  price: 300000,
  category: "پوشاک",
  code: "2",
  stock: 10,
};
const bread: Product = {
  id: "p-bread",
  name: "نان",
  price: 10000,
  category: "نان",
  code: "3",
  stock: 50,
};
const tomato: Product = {
  id: "p-tomato",
  name: "گوجه",
  price: 40000,
  category: "سبزی",
  code: "4",
  stock: 12,
  unit: "کیلوگرم",
};

const products = [shirt, pants, bread, tomato];

function phrases(r: ReturnType<typeof parseVoiceText>) {
  return r.items.map((i) => i.productPhrase).join("|");
}

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log("ok:", label);
  else {
    failed++;
    console.error("FAIL:", label, detail ?? "");
  }
}

{
  const r = parseVoiceText("۲ تا تیشرت و ۳ تا شلوار برای آقای امیر احمدی", products);
  check("name امیر احمدی", r.customerName === "امیر احمدی", `got ${r.customerName}`);
  check("two product items", r.items.length === 2, `items=${r.items.length} ${phrases(r)}`);
  check("no احمدی product", !r.items.some((i) => /احمدی|امیر/.test(i.productPhrase)), phrases(r));
  check("qty 2 and 3", r.items[0]?.quantity === 2 && r.items[1]?.quantity === 3, String(r.items.map((i) => i.quantity)));
}

{
  const r = parseVoiceText(
    "۲ تا تیشرت و ۳ تا شلوار برای آقای امیر احمدی با شماره تلفن 09121234567",
    products,
  );
  check("name with phone", r.customerName === "امیر احمدی", `got ${r.customerName}`);
  check("phone 09121234567", r.customerPhone === "09121234567", `got ${r.customerPhone}`);
  check("products kept with phone", r.items.length === 2, phrases(r));
}

{
  const r = parseVoiceText("برای رضا دو تا نان", products);
  check("رضا then products", r.customerName === "رضا", `got ${r.customerName}`);
  check("نان remains", r.items.length === 1 && r.items[0].productPhrase.includes("نان"), phrases(r));
}

{
  const r = parseVoiceText("دو تا نان", products);
  check("no customer on plain items", !r.customerName && !r.customerPhone, r.customerName);
  check("نان still parsed", r.items.length === 1, phrases(r));
}

{
  const r = parseVoiceText("آقای امیر احمدی با شماره تلفن 09120000000", products);
  check("customer-only name", r.customerName === "امیر احمدی", `got ${r.customerName}`);
  check("customer-only phone", r.customerPhone === "09120000000", `got ${r.customerPhone}`);
  check("customer-only no products", r.items.length === 0, phrases(r));
}

{
  const r = parseVoiceText("دو ربع گوجه", products);
  check("legacy weight parse", r.items.length === 1 && r.items[0].quantity === 0.5, JSON.stringify(r.items[0]));
  check("legacy no customer", !r.customerName);
}

{
  const split = splitPersonName("امیر احمدی");
  check("split first", split.firstName === "امیر" && split.lastName === "احمدی", JSON.stringify(split));
}

{
  const list: Customer[] = [
    { id: "c1", firstName: "امیر", lastName: "احمدی", createdAt: 1, txs: [], phone: "09121111111" },
    { id: "c2", firstName: "علی", lastName: "محمدی", createdAt: 1, txs: [] },
  ];
  const hit = customerInfoFromVoice("امیر احمدی", "09121234567", list);
  check("clear match existing", hit.clearWinner && hit.info.firstName === "امیر" && hit.info.lastName === "احمدی");
  check("spoken phone wins", hit.info.phone === "09121234567", hit.info.phone);
}

{
  const list: Customer[] = [
    { id: "c-sadra", firstName: "صدرا", lastName: "کمالی", createdAt: 1, txs: [] },
  ];
  const ali = customerInfoFromVoice("علی کمالی", undefined, list);
  check("علی کمالی is not صدرا", !ali.clearWinner, JSON.stringify(ali.info));
  check("علی کمالی stays a new name", ali.info.firstName === "علی" && ali.info.lastName === "کمالی", JSON.stringify(ali.info));
  check("no sadra candidate", !ali.candidates.some((c) => c.customer.id === "c-sadra"));

  const sadra = customerInfoFromVoice("صدرا کمالی", undefined, list);
  check("صدرا کمالی matches", sadra.clearWinner && sadra.info.firstName === "صدرا");
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall voice-customer checks passed");
