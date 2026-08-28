-- ════════════════════════════════════════════════════════════════════════════
-- برگرداندن قیمت و شمارهٔ فاکتور از آخرین نسخهٔ پشتیبانِ قبل از خرابکاری.
--
-- این فایل را کامل کپی کنید → سوپابیس → SQL Editor → Run.
--
-- کد مخربی داخل برنامه نیست. هکر با کلید دیتابیس قیمت اقلام فاکتور را عوض کرد.
-- اسکریپت قبلی فقط اسم‌های چینی/فحاشی را می‌دید؛ قیمت تصادفی را برنمی‌گرداند.
-- بعد از رفع خطای ۴۰۳، گوشیِ بعضی کاربرها همان فاکتور خراب را دوباره ذخیره کرد.
--
-- چه می‌کند:
--   ۱) وضعیت فعلی را در پشتیبان نگه می‌دارد (قابل برگشت).
--   ۲) برای هر کاربر، آخرین پشتیبانِ سالمِ فاکتور قبل از
--      ۲۰۲۶-۰۸-۲۸ ساعت ۰۶:۰۰ UTC را پیدا می‌کند.
--   ۳) همان فاکتورها را برمی‌گرداند (قیمت و شمارهٔ اصلی).
--
-- بعد از Run: به کاربر بگویید اپ را کامل ببندد (از برنامه‌های اخیر حذف کند)
-- و دوباره باز کند تا گوشی نسخهٔ ابری را بگیرد.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kamix_invoices_is_array(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_typeof(COALESCE(j, '[]'::jsonb)) = 'array';
$$;

CREATE OR REPLACE FUNCTION public.kamix_invoices_vandalized(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(j, '[]'::jsonb)) inv
     WHERE COALESCE(inv->>'notes', '') ~ '[一-鿿]'
        OR COALESCE(inv->>'notes', '') ~ 'کسخل|ریدم توی|جنده|کسکش|گایید|کامیکس کس'
        OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements(COALESCE(inv->'items', '[]'::jsonb)) it
              WHERE COALESCE(it->>'name', '') ~ '[一-鿿]'
                 OR COALESCE(it->>'name', '') ~ 'کسخل|ریدم توی|جنده|کسکش|گایید|کامیکس کس'
           )
  );
$$;

REVOKE ALL ON FUNCTION public.kamix_invoices_is_array(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_invoices_vandalized(jsonb) FROM PUBLIC, anon, authenticated;

-- آخرین پشتیبانِ فاکتور قبل از اینکه ذخیرهٔ خراب دوباره روی ابر برود
WITH cutoff AS (
  SELECT timestamptz '2026-08-28 06:00:00+00' AS at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.id AS backup_id,
         b.created_at AS backup_at,
         b.snapshot
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN cutoff c
   WHERE b.created_at < c.at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
),
changed AS (
  SELECT p.user_id,
         p.backup_id,
         p.backup_at,
         p.snapshot,
         jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS live_n,
         jsonb_array_length(COALESCE(p.snapshot->'invoices', '[]'::jsonb)) AS backup_n
    FROM picked p
    JOIN public.user_data d ON d.user_id = p.user_id
   WHERE COALESCE(d.invoices, '[]'::jsonb) IS DISTINCT FROM COALESCE(p.snapshot->'invoices', '[]'::jsonb)
)
INSERT INTO public.user_data_backups (user_id, snapshot)
SELECT d.user_id, to_jsonb(d)
  FROM public.user_data d
  JOIN changed c ON c.user_id = d.user_id;

WITH cutoff AS (
  SELECT timestamptz '2026-08-28 06:00:00+00' AS at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.snapshot
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN cutoff c
   WHERE b.created_at < c.at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
)
UPDATE public.user_data d
   SET invoices = COALESCE(p.snapshot->'invoices', d.invoices),
       current_invoice = COALESCE(p.snapshot->'current_invoice', d.current_invoice),
       updated_at = now()
  FROM picked p
 WHERE d.user_id = p.user_id
   AND COALESCE(d.invoices, '[]'::jsonb) IS DISTINCT FROM COALESCE(p.snapshot->'invoices', '[]'::jsonb);

-- گزارش: چند حساب برگردانده شد
WITH cutoff AS (
  SELECT timestamptz '2026-08-28 06:00:00+00' AS at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.created_at AS backup_at,
         jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) AS backup_n
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN cutoff c
   WHERE b.created_at < c.at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
)
SELECT p.username,
       p.first_name,
       p.last_name,
       k.backup_at,
       k.backup_n AS invoice_count,
       (SELECT e->>'id' FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e LIMIT 1) AS sample_invoice_id
  FROM picked k
  JOIN public.profiles p ON p.id = k.user_id
  JOIN public.user_data d ON d.user_id = k.user_id
 ORDER BY p.last_name, p.first_name;

-- حساب‌هایی که فاکتور دارند ولی پشتیبانِ قبل از cutoff پیدا نشد
WITH cutoff AS (
  SELECT timestamptz '2026-08-28 06:00:00+00' AS at
),
picked AS (
  SELECT DISTINCT ON (d.user_id) d.user_id
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN cutoff c
   WHERE b.created_at < c.at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
)
SELECT p.username, p.first_name, p.last_name,
       jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS live_invoices
  FROM public.user_data d
  JOIN public.profiles p ON p.id = d.user_id
 WHERE jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) >= 1
   AND d.user_id NOT IN (SELECT user_id FROM picked)
 ORDER BY live_invoices DESC, p.username
 LIMIT 50;
