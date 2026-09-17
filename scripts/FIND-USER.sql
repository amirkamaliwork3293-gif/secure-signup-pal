-- ════════════════════════════════════════════════════════════════════════════
-- پیدا کردن یک کاربر در سوپابیس (حتی اگر در پنل ادمین دیده نشود)
--
-- داشبورد سوپابیس → SQL Editor → این فایل را Run کنید.
-- هیچ داده‌ای را تغییر نمی‌دهد؛ فقط گزارش می‌گیرد.
--
-- اگر حساب زنده باشد، ردیف profiles یا auth.users می‌آید.
-- اگر پاک شده باشد، ممکن است فقط signup_requests / admin_audit_log /
-- user_data_backups باقی مانده باشد.
-- ════════════════════════════════════════════════════════════════════════════

-- مقادیر را عوض کنید:
--   یوزرنیم: m.soleimani
--   نام:     مصطفی
--   فامیل:   سلیمانی

-- ۱) پروفایل زنده (همان جدولی که تب «کاربران» می‌خواند)
SELECT 'profiles' AS src,
       id, username, first_name, last_name, status, plan, created_at, end_date
  FROM public.profiles
 WHERE username ILIKE '%soleimani%'
    OR username ILIKE '%m.soleimani%'
    OR first_name ILIKE '%مصطف%'
    OR last_name  ILIKE '%سلیمان%'
    OR last_name  ILIKE '%سليمان%'
 ORDER BY created_at DESC;

-- ۲) حساب ورود (auth) — ایمیل داخلی = username@kamali.local
SELECT 'auth.users' AS src,
       id,
       email,
       raw_user_meta_data->>'username'   AS username,
       raw_user_meta_data->>'first_name' AS first_name,
       raw_user_meta_data->>'last_name'  AS last_name,
       raw_user_meta_data->>'phone'      AS phone,
       created_at,
       last_sign_in_at
  FROM auth.users
 WHERE email ILIKE '%soleimani%'
    OR coalesce(raw_user_meta_data->>'username', '') ILIKE '%soleimani%'
    OR coalesce(raw_user_meta_data->>'first_name', '') ILIKE '%مصطف%'
    OR coalesce(raw_user_meta_data->>'last_name', '')  ILIKE '%سلیمان%'
    OR coalesce(raw_user_meta_data->>'last_name', '')  ILIKE '%سليمان%'
 ORDER BY created_at DESC;

-- ۳) درخواست ثبت‌نام / تمدید (حتی اگر حساب بعداً پاک شده باشد)
SELECT 'signup_requests' AS src,
       id, username, first_name, last_name, phone, status, plan,
       request_type, target_user_id, created_at, reviewed_at
  FROM public.signup_requests
 WHERE username ILIKE '%soleimani%'
    OR first_name ILIKE '%مصطف%'
    OR last_name  ILIKE '%سلیمان%'
    OR last_name  ILIKE '%سليمان%'
 ORDER BY created_at DESC;

-- ۴) درخواست بازیابی رمز از فرم عمومی
SELECT 'password_reset_requests' AS src,
       id, first_name, last_name, phone, status, created_at, reviewed_at
  FROM public.password_reset_requests
 WHERE first_name ILIKE '%مصطف%'
    OR last_name  ILIKE '%سلیمان%'
    OR last_name  ILIKE '%سليمان%'
 ORDER BY created_at DESC;

-- ۵) آیا ادمین این حساب را حذف کرده؟
SELECT 'admin_audit_log' AS src,
       created_at, action, target, detail, ip
  FROM public.admin_audit_log
 WHERE action IN ('user_deleted', 'user_password_reset', 'subscription_extended')
   AND (
        coalesce(detail->>'username', '') ILIKE '%soleimani%'
     OR coalesce(detail::text, '') ILIKE '%soleimani%'
     OR coalesce(detail::text, '') ILIKE '%سلیمان%'
   )
 ORDER BY created_at DESC
 LIMIT 50;

-- ۶) دادهٔ زنده / پشتیبان برای همان شناسه‌هایی که بالا پیدا شد
--    (user_id را از نتیجهٔ ۱ یا ۲ جایگذاری کنید اگر خالی آمد)
WITH ids AS (
  SELECT id FROM public.profiles
   WHERE username ILIKE '%soleimani%'
      OR (first_name ILIKE '%مصطف%' AND last_name ILIKE '%سلیمان%')
  UNION
  SELECT id FROM auth.users
   WHERE email ILIKE '%soleimani%'
      OR coalesce(raw_user_meta_data->>'username', '') ILIKE '%soleimani%'
)
SELECT 'user_data' AS src,
       d.user_id,
       jsonb_array_length(COALESCE(d.products, '[]'::jsonb)) AS products,
       jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS invoices,
       d.updated_at
  FROM public.user_data d
  JOIN ids ON ids.id = d.user_id
UNION ALL
SELECT 'user_data_backups',
       b.user_id,
       CASE WHEN jsonb_typeof(b.snapshot->'products') = 'array'
            THEN jsonb_array_length(b.snapshot->'products') ELSE 0 END,
       CASE WHEN jsonb_typeof(b.snapshot->'invoices') = 'array'
            THEN jsonb_array_length(b.snapshot->'invoices') ELSE 0 END,
       b.created_at
  FROM public.user_data_backups b
  JOIN ids ON ids.id = b.user_id
 ORDER BY 5 DESC NULLS LAST;

-- ۷) اگر هیچ‌کدام ردیفی نداد: حساب در این پروژه نیست
--    (یوزرنیم اشتباه، پروژهٔ سوپابیس دیگر، یا حذف کامل بدون پشتیبان).
