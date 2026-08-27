-- ════════════════════════════════════════════════════════════════════════════
-- پیدا کردن و برگرداندن محصولات/فاکتورهای خراب‌شده
-- در سوپابیس → SQL Editor اجرا کنید.
--
-- اول بخش الف و ب را Run کنید و نتیجه را ببینید.
-- بخش ج را فقط وقتی Run کنید که id نسخهٔ درست را از بخش ب برداشته‌اید.
-- ════════════════════════════════════════════════════════════════════════════

-- الف) کاربر را پیدا کنید (مثال: مهران بهوندی)
SELECT id, username, first_name, last_name, status
  FROM public.profiles
 WHERE first_name ILIKE '%مهران%'
    OR last_name  ILIKE '%بهوند%'
    OR username   ILIKE '%mehran%'
 ORDER BY created_at DESC;

-- ب) برای یک کاربر: وضعیت زنده + نسخه‌های پشتیبان با نمونه نام کالا
--    user_id را از نتیجه الف جایگذاری کنید.
-- SELECT 'LIVE' AS kind, NULL::timestamptz AS backup_at, NULL::uuid AS backup_id,
--        jsonb_array_length(COALESCE(d.products, '[]'::jsonb)) AS products,
--        jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS invoices,
--        (SELECT string_agg(e->>'name', ' | ')
--           FROM jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
--          LIMIT 1) AS sample
--   FROM public.user_data d
--  WHERE d.user_id = 'USER_ID_HERE'
-- UNION ALL
-- SELECT 'BACKUP', b.created_at, b.id,
--        jsonb_array_length(COALESCE(b.snapshot->'products', '[]'::jsonb)),
--        jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)),
--        (SELECT string_agg(x, ' | ') FROM (
--            SELECT e->>'name' AS x
--              FROM jsonb_array_elements(COALESCE(b.snapshot->'products', '[]'::jsonb)) e
--             LIMIT 8
--        ) s)
--   FROM public.user_data_backups b
--  WHERE b.user_id = 'USER_ID_HERE'
--  ORDER BY backup_at DESC NULLS FIRST;

-- فهرست همهٔ حساب‌هایی که در نام کالای فعلی واژه‌های مشکوک دارند
SELECT p.username, p.first_name, p.last_name, e->>'name' AS product_name
  FROM public.profiles p
  JOIN public.user_data d ON d.user_id = p.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
 WHERE e->>'name' ~ 'کص|کیر|رید|جنده|گایید|کون'
 LIMIT 200;

-- ج) بازگردانی یک نسخه (بعد از دیدن بخش ب)
-- اول وضعیت فعلی را هم به‌عنوان نسخه نگه می‌داریم، بعد فیلدها را برمی‌گردانیم.
--
-- INSERT INTO public.user_data_backups (user_id, snapshot)
-- SELECT user_id, to_jsonb(d) FROM public.user_data d WHERE user_id = 'USER_ID_HERE';
--
-- UPDATE public.user_data d
--    SET products = COALESCE(b.snapshot->'products', d.products),
--        categories = COALESCE(b.snapshot->'categories', d.categories),
--        invoices = COALESCE(b.snapshot->'invoices', d.invoices),
--        current_invoice = COALESCE(b.snapshot->'current_invoice', d.current_invoice),
--        settings = COALESCE(b.snapshot->'settings', d.settings),
--        customers = COALESCE(b.snapshot->'customers', d.customers),
--        students = COALESCE(b.snapshot->'students', d.students),
--        purchases = COALESCE(b.snapshot->'purchases', d.purchases),
--        expenses = COALESCE(b.snapshot->'expenses', d.expenses),
--        reminders = COALESCE(b.snapshot->'reminders', d.reminders),
--        accounts = COALESCE(b.snapshot->'accounts', d.accounts),
--        account_txs = COALESCE(b.snapshot->'account_txs', d.account_txs),
--        production = COALESCE(b.snapshot->'production', d.production),
--        manual_ledger = COALESCE(b.snapshot->'manual_ledger', d.manual_ledger),
--        updated_at = now()
--   FROM public.user_data_backups b
--  WHERE d.user_id = 'USER_ID_HERE'
--    AND b.id = 'BACKUP_ID_HERE';
