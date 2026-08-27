-- ════════════════════════════════════════════════════════════════════════════
-- پاسخ به حادثه — قطع کامل دسترسی مهاجم
--
-- در Supabase → SQL Editor اجرا کنید. بخش‌ها به ترتیب شماره اجرا شوند.
-- بخش ۰ فقط گزارش می‌گیرد (هیچ تغییری نمی‌دهد) — اول آن را بخوانید.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- ۰) شناسایی: پیش از هر تغییر، وضعیت را ثبت کنید
-- ───────────────────────────────────────────────────────────────────────────

-- ۰-۱ چه کسانی نقش ادمین دارند؟ هر ردیف غیرمنتظره = درِ پشتی مهاجم.
SELECT ur.user_id, u.email, u.created_at, u.last_sign_in_at
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
 WHERE ur.role = 'admin'
 ORDER BY u.created_at;

-- ۰-۲ شکل و زمان سیل ثبت‌نام (هر دقیقه چند حساب ساخته شد؟)
SELECT date_trunc('minute', created_at) AS minute, count(*)
  FROM auth.users
 GROUP BY 1 ORDER BY 1 DESC LIMIT 120;

-- ۰-۳ نشست‌های فعال — مهاجم تا وقتی refresh token دارد داخل است
SELECT s.user_id, u.email, s.created_at, s.updated_at
  FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
 ORDER BY s.updated_at DESC LIMIT 100;

-- ۰-۴ داده‌هایی که پس از حذف کاربران باقی مانده‌اند (مسیر بازیابی)
SELECT b.user_id,
       max(b.created_at) AS latest_snapshot,
       (SELECT snapshot->'settings'->>'shopName'
          FROM public.user_data_backups x
         WHERE x.user_id = b.user_id ORDER BY created_at DESC LIMIT 1) AS shop
  FROM public.user_data_backups b
 GROUP BY b.user_id
 ORDER BY latest_snapshot DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- ۱) قطع فوری دسترسی: باطل‌کردن همه‌ی نشست‌ها
--
-- ⚠️ همه‌ی کاربران (از جمله خود شما) از حساب خارج می‌شوند — دقیقاً هدف همین است.
-- توکن دسترسی (access token) تا انقضای کوتاهش معتبر می‌ماند؛ برای ابطال
-- آنی همه‌ی آن‌ها، JWT Secret را هم از داشبورد بچرخانید:
--     Dashboard → Project Settings → API → JWT Settings → Generate new secret
-- ───────────────────────────────────────────────────────────────────────────
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.sessions;

-- ───────────────────────────────────────────────────────────────────────────
-- ۲) حذف درِ پشتی: هر ادمینی جز حساب قانونی خودتان
--
-- ابتدا خروجی ۰-۱ را ببینید و ایمیل ادمین واقعی را جای مقدار زیر بگذارید.
-- ───────────────────────────────────────────────────────────────────────────
-- DELETE FROM public.user_roles
--  WHERE role = 'admin'
--    AND user_id <> (SELECT id FROM auth.users WHERE email = 'amirkamali@kamali.local');

-- ───────────────────────────────────────────────────────────────────────────
-- ۳) پاک‌سازی حساب‌های ساخته‌شده در حمله
--
-- بازه‌ی زمانی را از خروجی ۰-۲ تنظیم کنید. اول SELECT را اجرا کنید و فهرست
-- را ببینید؛ فقط اگر مطمئن شدید، DELETE را از حالت توضیح خارج کنید.
-- حذف از auth.users به‌صورت cascade پروفایل و داده‌ها را هم پاک می‌کند،
-- اما user_data_backups (بدون FK) باقی می‌ماند.
-- ───────────────────────────────────────────────────────────────────────────
SELECT id, email, created_at
  FROM auth.users
 WHERE created_at BETWEEN '2026-08-27 00:00:00+00' AND '2026-08-28 00:00:00+00'
   AND email <> 'amirkamali@kamali.local'
 ORDER BY created_at;

-- DELETE FROM auth.users
--  WHERE created_at BETWEEN '2026-08-27 00:00:00+00' AND '2026-08-28 00:00:00+00'
--    AND email <> 'amirkamali@kamali.local';

-- ───────────────────────────────────────────────────────────────────────────
-- ۴) پاک‌کردن هر رمز متن‌ساده‌ی باقی‌مانده
-- (ستون در مهاجرت ۲۰۲۶۰۸۲۷ حذف شده؛ این فقط بررسی اطمینان است)
-- ───────────────────────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'signup_requests'
   AND column_name = 'temp_password';   -- باید صفر ردیف برگرداند

-- ───────────────────────────────────────────────────────────────────────────
-- ۵) بازبینی محتوایی که مهاجم ممکن است دستکاری کرده باشد
-- ───────────────────────────────────────────────────────────────────────────
SELECT id, brand_name, headline, updated_at FROM public.landing_content;
SELECT id, card_number, card_holder, bank_name, updated_at FROM public.app_settings;

-- ───────────────────────────────────────────────────────────────────────────
-- ۶) از این پس: گزارش عملیات ادمین
-- ───────────────────────────────────────────────────────────────────────────
SELECT created_at, action, actor_id, target, ip, detail
  FROM public.admin_audit_log
 ORDER BY created_at DESC LIMIT 200;
