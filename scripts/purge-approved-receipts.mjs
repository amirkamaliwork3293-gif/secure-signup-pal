/**
 * پاک‌سازی یک‌باره‌ی رسیدهای باقی‌مانده در باکت `receipts`.
 *
 * فقط درخواست‌هایی را هدف می‌گیرد که مدیر قبلاً آن‌ها را **تایید یا رد** کرده و
 * هنوز مسیر فایل رسید در ستون receipt_url مانده است. درخواست‌های pending هرگز
 * دست نمی‌خورند. خود رکورد حذف نمی‌شود؛ فقط فایل + ستون مسیر پاک می‌شود.
 *
 * اجرا:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-approved-receipts.mjs --dry-run
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-approved-receipts.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!url || !key) {
  console.error("SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY را تنظیم کنید.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from("signup_requests")
  .select("id, username, status, receipt_url")
  .in("status", ["approved", "rejected"])
  .not("receipt_url", "is", null);

if (error) {
  console.error("خطا در خواندن درخواست‌ها:", error.message);
  process.exit(1);
}

console.log(`${rows.length} درخواست بررسی‌شده با رسید باقی‌مانده پیدا شد.`);
if (dryRun) {
  for (const r of rows) console.log(`  [dry-run] ${r.status} @${r.username} → ${r.receipt_url}`);
  process.exit(0);
}

let removed = 0;
let failed = 0;
for (const r of rows) {
  const { error: rmErr } = await sb.storage.from("receipts").remove([r.receipt_url]);
  if (rmErr) {
    // فایل ممکن است قبلاً حذف شده باشد — ستون را باز هم پاک می‌کنیم
    console.warn(`  حذف فایل ناموفق (${r.receipt_url}): ${rmErr.message}`);
    failed++;
  }
  const { error: updErr } = await sb
    .from("signup_requests")
    .update({ receipt_url: null })
    .eq("id", r.id)
    .in("status", ["approved", "rejected"]);
  if (updErr) console.warn(`  به‌روزرسانی ردیف ناموفق (${r.id}): ${updErr.message}`);
  else removed++;
}

console.log(`پایان: ${removed} ردیف پاک شد، ${failed} فایل قابل حذف نبود.`);
