/**
 * تریگر محافظ کاتالوگ باید SECURITY DEFINER باشد تا ذخیره ابری 403 ندهد.
 * اجرا: node scripts/test-protect-catalog-definer.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "scripts/TAMIR-ZAKHIRE.sql",
  "scripts/HEFAZAT-KATALOG.sql",
  "supabase/migrations/20260828060000_protect_catalog_from_vandalism.sql",
  "supabase/migrations/20260828080000_protect_catalog_security_definer.sql",
];

for (const rel of files) {
  const sql = readFileSync(join(root, rel), "utf8");
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.protect_user_data_catalog\(\)[\s\S]*SECURITY DEFINER/,
    `${rel} must declare protect_user_data_catalog as SECURITY DEFINER`,
  );
  assert.doesNotMatch(
    sql,
    /kamix_json_looks_vandalized\(NEW\.current_invoice\)[\s\S]{0,120}NEW\.customers := OLD\.customers/,
    `${rel} must not copy customers over current_invoice`,
  );
}

const rootMeta = readFileSync(join(root, "src/routes/__root.tsx"), "utf8");
assert.match(rootMeta, /mobile-web-app-capable/);

console.log("ok: protect catalog trigger is SECURITY DEFINER");
