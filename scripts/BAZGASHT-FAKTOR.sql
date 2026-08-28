-- ════════════════════════════════════════════════════════════════════════════
-- بازیابی امن قیمت فاکتور — هیچ فاکتوری حذف نمی‌شود.
--
-- این فایل را کامل کپی کنید → سوپابیس → SQL Editor → Run.
--
-- SQL قبلی کل فهرست فاکتور را عوض می‌کرد. این نسخه آن کار را نمی‌کند.
-- اگر آن یکی را هنوز Run نکرده‌اید، همان را نادیده بگیرید و فقط این را بزنید.
--
-- چه می‌کند (و چه نمی‌کند):
--   • هیچ فاکتوری پاک نمی‌شود.
--   • کالا، مشتری، تنظیمات، فاکتورِ بازِ فعلی دست نمی‌خورند.
--   • فقط اگر همان شماره فاکتور در پشتیبانِ ۲۷ اوت باشد، قیمت اقلام
--     همان فاکتور از پشتیبان کپی می‌شود.
--   • فاکتورهایی که فقط در پشتیبان هستند (حذف‌شده توسط هکر) اضافه می‌شوند.
--   • فاکتورهایی که فقط امروز ثبت شده‌اند سر جایشان می‌مانند.
--   • پشتیبان فقط از ۲۶ و ۲۷ اوت انتخاب می‌شود — نه امروز (داده‌ی خراب)
--     و نه هفته‌های قبل.
--   • قبل از تغییر، یک نسخه از وضعیت فعلی در backups ذخیره می‌شود.
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

-- ادغام: همه فاکتورهای زنده می‌مانند؛ قیمتِ شناسه‌های مشترک از پشتیبان می‌آید.
CREATE OR REPLACE FUNCTION public.kamix_merge_invoices_keep_all(live jsonb, backup jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(q.inv ORDER BY q.ord)
      FROM (
        SELECT
          CASE
            WHEN b.inv IS NULL THEN l.inv
            WHEN COALESCE(l.inv->'items', 'null'::jsonb) IS DISTINCT FROM COALESCE(b.inv->'items', 'null'::jsonb)
              OR COALESCE(l.inv->>'total', '') IS DISTINCT FROM COALESCE(b.inv->>'total', '')
            THEN l.inv || jsonb_build_object(
              'items', b.inv->'items',
              'total', b.inv->'total',
              'subtotal', b.inv->'subtotal',
              'discountAmount', b.inv->'discountAmount',
              'discountPercent', b.inv->'discountPercent',
              'taxPercent', b.inv->'taxPercent'
            )
            ELSE l.inv
          END AS inv,
          l.ord
        FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) WITH ORDINALITY AS l(inv, ord)
        LEFT JOIN LATERAL (
          SELECT x.inv
            FROM jsonb_array_elements(COALESCE(backup, '[]'::jsonb)) x(inv)
           WHERE x.inv->>'id' = l.inv->>'id'
             AND COALESCE(x.inv->>'id', '') <> ''
           LIMIT 1
        ) b ON true

        UNION ALL

        SELECT b.inv, 1000000 + b.ord
        FROM jsonb_array_elements(COALESCE(backup, '[]'::jsonb)) WITH ORDINALITY AS b(inv, ord)
        WHERE COALESCE(b.inv->>'id', '') <> ''
          AND NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) l(inv)
             WHERE l.inv->>'id' = b.inv->>'id'
          )
      ) q
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.kamix_invoices_is_array(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_invoices_vandalized(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_merge_invoices_keep_all(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- پنجرهٔ امن: از ۲۶ اوت تا قبل از ۲۸ اوت (امروز = دادهٔ خراب؛ قدیمی‌تر = از دست رفتن کار ۲۷ اوت)
WITH window AS (
  SELECT
    timestamptz '2026-08-26 00:00:00+00' AS from_at,
    timestamptz '2026-08-28 00:00:00+00' AS to_at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.created_at AS backup_at,
         b.snapshot
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
),
planned AS (
  SELECT p.user_id,
         p.backup_at,
         d.invoices AS live_invoices,
         public.kamix_merge_invoices_keep_all(d.invoices, p.snapshot->'invoices') AS merged
    FROM picked p
    JOIN public.user_data d ON d.user_id = p.user_id
)
INSERT INTO public.user_data_backups (user_id, snapshot)
SELECT d.user_id, to_jsonb(d)
  FROM public.user_data d
  JOIN planned x ON x.user_id = d.user_id
 WHERE COALESCE(x.live_invoices, '[]'::jsonb) IS DISTINCT FROM COALESCE(x.merged, '[]'::jsonb);

WITH window AS (
  SELECT
    timestamptz '2026-08-26 00:00:00+00' AS from_at,
    timestamptz '2026-08-28 00:00:00+00' AS to_at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.snapshot
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
)
UPDATE public.user_data d
   SET invoices = public.kamix_merge_invoices_keep_all(d.invoices, p.snapshot->'invoices'),
       updated_at = now()
  FROM picked p
 WHERE d.user_id = p.user_id
   AND COALESCE(d.invoices, '[]'::jsonb)
       IS DISTINCT FROM public.kamix_merge_invoices_keep_all(d.invoices, p.snapshot->'invoices');

-- گزارش: برای هر حساب، تعداد فاکتور کم نمی‌شود
WITH window AS (
  SELECT
    timestamptz '2026-08-26 00:00:00+00' AS from_at,
    timestamptz '2026-08-28 00:00:00+00' AS to_at
),
picked AS (
  SELECT DISTINCT ON (d.user_id)
         d.user_id,
         b.created_at AS backup_at
    FROM public.user_data d
    JOIN public.user_data_backups b ON b.user_id = d.user_id
    CROSS JOIN window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND public.kamix_invoices_is_array(b.snapshot->'invoices')
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
     AND NOT public.kamix_invoices_vandalized(b.snapshot->'invoices')
   ORDER BY d.user_id, b.created_at DESC
)
SELECT pr.username,
       pr.first_name,
       pr.last_name,
       k.backup_at,
       jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS invoice_count_now
  FROM picked k
  JOIN public.profiles pr ON pr.id = k.user_id
  JOIN public.user_data d ON d.user_id = k.user_id
 ORDER BY pr.last_name, pr.first_name;
