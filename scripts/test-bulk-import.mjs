/**
 * بررسی ورود گروهی محصولات پس از تعویض xlsx به SheetJS رسمی.
 * اجرا: node --experimental-strip-types scripts/test-bulk-import.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile, sampleWorkbook, mergeImported } from "../src/lib/bulk-import.ts";

const xlsxPkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../node_modules/xlsx/package.json"),
    "utf8",
  ),
);
assert.match(xlsxPkg.version, /^0\.20\.\d+$/, `xlsx must be 0.20.x, got ${xlsxPkg.version}`);
assert.notEqual(xlsxPkg.version, "0.18.5", "vulnerable community npm build must not be installed");

const blob = sampleWorkbook();
assert.ok(blob.size > 0, "sample workbook should be non-empty");

const file = new File([blob], "نمونه-محصولات.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const rows = await parseFile(file);
assert.equal(rows.length, 2);
assert.equal(rows[0].name, "شیر پرچرب کاله");
assert.equal(rows[0].code, "1234567890123");
assert.equal(rows[0].price, 25000);
assert.equal(rows[0].buyPrice, 18000);
assert.equal(rows[0].stock, 100);
assert.equal(rows[0].category, "لبنیات");
assert.equal(rows[0].unit, "عدد");
assert.equal(rows[0].errors.length, 0);
assert.equal(rows[1].name, "نان بربری");
assert.equal(rows[1].price, 15000);
assert.equal(rows[1].errors.length, 0);

const { list, result } = mergeImported([], rows, () => "id-1");
assert.equal(result.added, 2);
assert.equal(result.updated, 0);
assert.equal(list[0].name, "نان بربری");
assert.equal(list[1].name, "شیر پرچرب کاله");

const again = mergeImported(list, rows, () => "id-2");
assert.equal(again.result.updated, 1, "barcode match should update existing");
assert.equal(again.result.added, 1, "row without barcode should add");

console.log("✓ bulk-import: SheetJS 0.20.3 parse/merge OK");
