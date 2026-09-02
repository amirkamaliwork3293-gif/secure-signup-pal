/**
 * ستون‌های اختیاری user_data اگر migrate نشده باشند نباید کل بازیابی را بخوابانند.
 * اجرا: node --experimental-strip-types scripts/test-user-data-schema.mjs
 */
import assert from "node:assert/strict";
import {
  missingUserDataColumnFromError,
  stripMissingUserDataColumn,
} from "../src/lib/user-data-schema.ts";

assert.equal(
  missingUserDataColumnFromError(
    "Could not find the 'manual_ledger' column of 'user_data' in the schema cache",
  ),
  "manual_ledger",
);
assert.equal(
  missingUserDataColumnFromError("could not find the production column of user_data in the schema cache"),
  "production",
);
assert.equal(missingUserDataColumnFromError("Could not find the 'products' column of 'user_data'"), null);
assert.equal(missingUserDataColumnFromError("permission denied"), null);

const stripped = stripMissingUserDataColumn(
  { user_id: "u1", products: [], manual_ledger: [] },
  "manual_ledger",
);
assert.equal("manual_ledger" in stripped, false);
assert.equal(Array.isArray(stripped.products), true);

console.log("user-data-schema ok");
