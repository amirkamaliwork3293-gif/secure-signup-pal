-- ════════════════════════════════════════════════════════════════════════════
-- «مشتریان من پاک شده‌اند» — چه اتفاقی افتاده و داده کجاست؟
--
-- داشبورد سوپابیس → SQL Editor → این فایل را Run کنید.
-- فقط گزارش می‌گیرد؛ هیچ داده‌ای را تغییر نمی‌دهد.
--
-- سرور هیچ مشتری‌ای را واقعاً پاک نمی‌کند (20261002120000): حذف در اپ فقط
-- شناسه را در settings.catalogTombstones.customers می‌نویسد و خود مشتری در
-- user_data.customers می‌ماند. هر حذف هم با محتوا در user_data_delete_log
-- ثبت می‌شود (20261002120100). پس این گزارش نشان می‌دهد:
--   ۱) کدام حساب است (شاید کاربر با حساب دیگری وارد شده)
--   ۲) چند مشتری روی سرور هست و چندتا «حذف‌شده» علامت خورده
--   ۳) کِی، از کدام دستگاه و چند مشتری با هم حذف شده‌اند
--      (ده‌ها حذف در یک دقیقه = دکمهٔ «حذف همه مشتریان» در صفحهٔ مشتریان)
--   ۴) تعداد مشتریان در نسخه‌های پشتیبان ۶ ساعته
--   ۵) آیا ادمین روی این حساب کاری کرده
--
-- مقادیر جستجو: نام «عرفان»، فامیل «سجدئی» (سجده‌ای / سجدهای / سجدی هم
-- با «سجد» پیدا می‌شود). اگر یوزرنیم را می‌دانید، در ids جایگزین کنید.
-- ════════════════════════════════════════════════════════════════════════════

-- ۱) همهٔ حساب‌هایی که به این نام می‌خورند + تعداد مشتریان هرکدام
--    اگر بیش از یک حساب آمد، شاید کاربر با حساب اشتباه وارد شده است.
WITH ids AS (
  SELECT id FROM public.profiles
   WHERE (first_name ILIKE '%عرفان%' AND last_name ILIKE '%سجد%')
      OR last_name ILIKE '%سجد%'
      OR username ILIKE '%sajd%'
  UNION
  SELECT id FROM auth.users
   WHERE coalesce(raw_user_meta_data->>'last_name', '') ILIKE '%سجد%'
      OR coalesce(raw_user_meta_data->>'username', '') ILIKE '%sajd%'
)
SELECT p.id AS user_id, p.username, p.first_name, p.last_name, p.status,
       u.last_sign_in_at,
       CASE WHEN jsonb_typeof(d.customers) = 'array'
            THEN jsonb_array_length(d.customers) END              AS customers_on_server,
       CASE WHEN jsonb_typeof(d.settings->'catalogTombstones'->'customers') = 'array'
            THEN jsonb_array_length(d.settings->'catalogTombstones'->'customers')
            ELSE 0 END                                             AS customers_marked_deleted,
       d.updated_at AS data_updated_at
  FROM ids
  LEFT JOIN public.profiles  p ON p.id = ids.id
  LEFT JOIN auth.users       u ON u.id = ids.id
  LEFT JOIN public.user_data d ON d.user_id = ids.id
 ORDER BY u.last_sign_in_at DESC NULLS LAST;

-- ۲) مشتریانی که هنوز روی سرورند، با وضعیت نمایش
--    deleted = true یعنی در اپ پنهان است ولی داده سالم است و قابل برگشت.
WITH ids AS (
  SELECT id FROM public.profiles
   WHERE (first_name ILIKE '%عرفان%' AND last_name ILIKE '%سجد%')
      OR username ILIKE '%sajd%'
)
SELECT d.user_id,
       c->>'id'   AS customer_id,
       concat_ws(' ', c->>'firstName', c->>'lastName') AS name,
       c->>'phone' AS phone,
       CASE WHEN jsonb_typeof(c->'txs') = 'array' THEN jsonb_array_length(c->'txs') ELSE 0 END AS txs,
       COALESCE(d.settings->'catalogTombstones'->'customers', '[]'::jsonb) ? (c->>'id') AS deleted
  FROM public.user_data d
  JOIN ids ON ids.id = d.user_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(d.customers) = 'array' THEN d.customers ELSE '[]'::jsonb END) AS c
 ORDER BY deleted DESC, name;

-- ۳) گزارش حذف‌ها، دسته‌بندی‌شده بر اساس دقیقه و دستگاه
--    count بالا در یک دقیقه = «حذف همه» (یا حذف پشت‌سرهم) از همان دستگاه.
--    user_agent نشان می‌دهد گوشی اندروید بوده یا مرورگر؛ session_id یعنی کدام ورود.
WITH ids AS (
  SELECT id FROM public.profiles
   WHERE (first_name ILIKE '%عرفان%' AND last_name ILIKE '%سجد%')
      OR username ILIKE '%sajd%'
)
SELECT l.user_id,
       date_trunc('minute', l.created_at) AS minute,
       l.field,
       count(*)                           AS deleted_rows,
       min(l.id)                          AS first_log_id,
       max(l.id)                          AS last_log_id,
       l.actor_id,
       l.session_id,
       l.user_agent,
       string_agg(l.row_label, ' | ' ORDER BY l.id) FILTER (WHERE l.row_label IS NOT NULL) AS names
  FROM public.user_data_delete_log l
  JOIN ids ON ids.id = l.user_id
 WHERE l.field IN ('customers', 'customers.txs')
 GROUP BY 1, 2, 3, 7, 8, 9
 ORDER BY minute DESC
 LIMIT 100;

-- ۴) تعداد مشتریان در هر نسخهٔ پشتیبان (هر ۶ ساعت، ۴۰ نسخهٔ آخر ≈ ۱۰ روز)
--    نقطه‌ای که customers افت می‌کند یا deleted بالا می‌رود = زمان حادثه.
--    _archived_reason = row_deleted یعنی کل ردیف داده حذف و بایگانی شده.
WITH ids AS (
  SELECT id FROM public.profiles
   WHERE (first_name ILIKE '%عرفان%' AND last_name ILIKE '%سجد%')
      OR username ILIKE '%sajd%'
)
SELECT b.user_id, b.id AS backup_id, b.created_at,
       CASE WHEN jsonb_typeof(b.snapshot->'customers') = 'array'
            THEN jsonb_array_length(b.snapshot->'customers') ELSE 0 END AS customers,
       CASE WHEN jsonb_typeof(b.snapshot->'settings'->'catalogTombstones'->'customers') = 'array'
            THEN jsonb_array_length(b.snapshot->'settings'->'catalogTombstones'->'customers')
            ELSE 0 END                                                  AS customers_marked_deleted,
       b.snapshot->>'_archived_reason' AS archived_reason
  FROM public.user_data_backups b
  JOIN ids ON ids.id = b.user_id
 ORDER BY b.created_at DESC;

-- ۵) کارهای ادمین روی این حساب (حذف کاربر، ریست رمز، تمدید)
SELECT created_at, action, target, detail, ip
  FROM public.admin_audit_log
 WHERE coalesce(detail::text, '') ILIKE '%سجد%'
    OR coalesce(detail::text, '') ILIKE '%sajd%'
    OR target IN (SELECT id::text FROM public.profiles
                   WHERE (first_name ILIKE '%عرفان%' AND last_name ILIKE '%سجد%')
                      OR username ILIKE '%sajd%')
 ORDER BY created_at DESC
 LIMIT 50;

-- ── چطور نتیجه را بخوانید ──
-- • بخش ۲ مشتری با deleted = true دارد و بخش ۳ ده‌ها حذف در یک دقیقه:
--   از دکمهٔ «حذف همه مشتریان» استفاده شده (با تایپ کلمهٔ «حذف»). user_agent
--   و session_id نشان می‌دهد از کدام دستگاه. داده سالم است؛ با
--   scripts/RESTORE-DELETED-ROW.sql (برای هر log id) برمی‌گردد.
-- • بخش ۲ مشتری با deleted = false دارد ولی اپ خالی نشان می‌دهد:
--   مشکل سمت دستگاه است (همگام‌سازی/اتصال، یا حساب دیگر). روی گوشی خارج و
--   دوباره وارد شود و صفحهٔ «وضعیت همگام‌سازی» را چک کنید.
-- • بخش ۱ دو حساب نشان می‌دهد و فقط یکی مشتری دارد: کاربر با حساب اشتباه وارد شده.
-- • customers_on_server صفر است و بخش ۳ چیزی ندارد: داده هیچ‌وقت به سرور نرسیده
--   (فقط روی همان دستگاه بوده) یا قبل از مهاجرت‌های 2026-10-02 رفته؛ بخش ۴
--   را برای آخرین نسخهٔ پشتیبانی که مشتری دارد ببینید (RESTORE-USER-DATA.sql بخش ج).
