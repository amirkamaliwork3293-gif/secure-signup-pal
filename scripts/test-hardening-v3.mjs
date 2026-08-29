/**
 * مهاجرت v3 باید فقط افزودنی باشد و دادهٔ کاربر را پاک نکند.
 * اجرا: node scripts/test-hardening-v3.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../supabase/migrations/20260829120000_security_hardening_v3.sql",
  ),
  "utf8",
);

assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  sql,
  /\bDELETE\s+FROM\s+public\.(profiles|user_data|user_data_backups|signup_requests)\b/i,
);
assert.match(sql, /allowed_mime_types/);
assert.match(sql, /WITH CHECK \(auth\.uid\(\) = user_id\)/);
assert.doesNotMatch(sql, /image\/svg\+xml/);

console.log("ok: hardening v3 is additive and blocks SVG MIME");
