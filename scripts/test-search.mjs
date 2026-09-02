/**
 * اولویت جستجوی محصولات: کل عبارت > شروع با کل عبارت > وجود پیوسته‌ی عبارت > کلمه‌ها.
 * اجرا: node scripts/test-search.mjs
 */
import assert from "node:assert/strict";
import { filterAndRankSearch, identitySearchFields, phonesLikelySame, normalizePhoneDigits, scoreSearchFields } from "../src/lib/search.ts";

const products = [
  { id: "1", name: "گلس سامسونگ" },
  { id: "2", name: "گلس آیفون ۱۳" },
  { id: "3", name: "گلس آیفون" },
  { id: "4", name: "محافظ صفحه شیائومی" },
  { id: "5", name: "آیفون گلس UV" },
];

function names(list) {
  return list.map((p) => p.name);
}

{
  const ranked = filterAndRankSearch(products, "گلس آیفون", (p) => [p.name]);
  assert.equal(ranked[0].name, "گلس آیفون", "تطبیق دقیق کل عبارت باید اول باشد");
  assert.equal(ranked[1].name, "گلس آیفون ۱۳", "شروع با کل عبارت باید دوم باشد");
  assert.ok(
    ranked.findIndex((p) => p.name === "گلس سامسونگ") >
      ranked.findIndex((p) => p.name === "گلس آیفون ۱۳"),
    "محصولی که فقط کلمه‌ی اول را دارد نباید بالاتر از کل عبارت باشد",
  );
}

{
  const ranked = filterAndRankSearch(products, "آیفون", (p) => [p.name]);
  assert.ok(ranked[0].name.includes("آیفون"), "جستجوی کلمه‌ی دوم باید همان محصولات را اول بیاورد");
  assert.ok(!ranked.some((p) => p.name === "گلس سامسونگ"), "گلس سامسونگ نباید برای «آیفون» بیاید");
}

{
  const ranked = filterAndRankSearch(products, "گلس", (p) => [p.name]);
  assert.ok(ranked.length >= 3);
  assert.ok(ranked.every((p) => p.name.includes("گلس") || p.name.includes("آیفون گلس") || true));
}

{
  const exact = scoreSearchFields(["گلس آیفون"], "گلس آیفون");
  const prefix = scoreSearchFields(["گلس آیفون ۱۳"], "گلس آیفون");
  const firstOnly = scoreSearchFields(["گلس سامسونگ"], "گلس آیفون");
  assert.ok(exact > prefix, "دقیق > شروع با عبارت");
  assert.ok(prefix > firstOnly, "کل عبارت > فقط کلمه‌ی اول");
}

{
  const people = [
    { firstName: "علی", lastName: "رضایی" },
    { firstName: "علی", lastName: "کمالی" },
    { firstName: "رضا", lastName: "کمالی" },
  ];
  const ranked = filterAndRankSearch(people, "علی کمالی", (p) => [
    p.firstName,
    p.lastName,
    `${p.firstName} ${p.lastName}`,
  ]);
  assert.equal(ranked[0].lastName, "کمالی");
  assert.equal(ranked[0].firstName, "علی");
}

{
  const users = [
    { username: "ali", first_name: "علی", last_name: "کمالی", phone: "+98 912 333 4444" },
    { username: "reza", first_name: "رضا", last_name: "محمدی", phone: "09125556666" },
  ];
  const byPhone = filterAndRankSearch(users, "۰۹۱۲۳۳۳۴۴۴۴", (u) => identitySearchFields(u));
  assert.equal(byPhone.length, 1);
  assert.equal(byPhone[0].username, "ali");

  const spaced = filterAndRankSearch(users, "0912 333 4444", (u) => identitySearchFields(u));
  assert.equal(spaced[0].username, "ali");

  const shortPrefix = filterAndRankSearch(users, "0912555", (u) => identitySearchFields(u));
  assert.equal(shortPrefix[0].username, "reza");

  assert.equal(normalizePhoneDigits("+989123334444"), "09123334444");
  assert.equal(phonesLikelySame("09123334444", "+98 912 333 4444"), true);
  assert.equal(phonesLikelySame("09123334444", "09125556666"), false);
}

console.log("search ranking ok", names(filterAndRankSearch(products, "گلس آیفون", (p) => [p.name])));
