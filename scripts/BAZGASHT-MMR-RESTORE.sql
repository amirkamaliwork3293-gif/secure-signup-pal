-- ════════════════════════════════════════════════════════════════════════════
-- بازیابی امن حساب mmr (محمد معینی رودبالی)
-- فقط همین یک کاربر. هیچ ردیفی پاک نمی‌شود.
--
-- سوپابیس → SQL Editor → همه را کپی → Run
--
-- منبع: آخرین پشتیبان سالم امروز صبح (حدود ۰۳:۲۰)
--   ۱۰ کالا، ۱۱۸ فاکتور، ۳۱ مشتری — بیشتر از نسخهٔ ۲۶ اوت (۱۱۱ فاکتور)
-- پشتیبان‌های ۹۰ کالا / ۸۱ مشتری استفاده نمی‌شوند (اثر هک).
--
-- چه می‌کند:
--   • وضعیت فعلی را اول در backups نگه می‌دارد
--   • کالا / فاکتور / مشتری / خرید / دستهٔ موجود می‌مانند
--   • فقط شناسه‌هایی که الان نیستند از پشتیبان اضافه می‌شوند
--   • تنظیمات فروشگاه و فاکتور باز دست نمی‌خورند
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kamix_json_array_add_missing(live jsonb, backup jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(q.elem ORDER BY q.ord)
      FROM (
        SELECT l.elem, l.ord
          FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) WITH ORDINALITY AS l(elem, ord)
        UNION ALL
        SELECT b.elem, 1000000 + b.ord
          FROM jsonb_array_elements(COALESCE(backup, '[]'::jsonb)) WITH ORDINALITY AS b(elem, ord)
         WHERE COALESCE(b.elem->>'id', '') <> ''
           AND NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) x(elem)
              WHERE x.elem->>'id' = b.elem->>'id'
           )
      ) q
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.kamix_json_array_add_missing(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

WITH picked AS (
  SELECT DISTINCT ON (p.id)
         p.id AS user_id,
         b.created_at AS backup_at,
         b.snapshot
    FROM public.profiles p
    JOIN public.user_data_backups b ON b.user_id = p.id
   WHERE lower(p.username) = 'mmr'
     AND b.created_at >= timestamptz '2026-08-28 09:00:00+00'
     AND b.created_at <  timestamptz '2026-08-29 12:00:00+00'
     AND COALESCE(jsonb_array_length(b.snapshot->'products'), 0) BETWEEN 8 AND 20
     AND COALESCE(jsonb_array_length(b.snapshot->'invoices'), 0) >= 110
     AND COALESCE(jsonb_array_length(b.snapshot->'customers'), 0) BETWEEN 25 AND 40
   ORDER BY p.id, b.created_at DESC
)
INSERT INTO public.user_data_backups (user_id, snapshot)
SELECT d.user_id, to_jsonb(d)
  FROM public.user_data d
  JOIN picked p ON p.user_id = d.user_id;

WITH picked AS (
  SELECT DISTINCT ON (p.id)
         p.id AS user_id,
         b.snapshot
    FROM public.profiles p
    JOIN public.user_data_backups b ON b.user_id = p.id
   WHERE lower(p.username) = 'mmr'
     AND b.created_at >= timestamptz '2026-08-28 09:00:00+00'
     AND b.created_at <  timestamptz '2026-08-29 12:00:00+00'
     AND COALESCE(jsonb_array_length(b.snapshot->'products'), 0) BETWEEN 8 AND 20
     AND COALESCE(jsonb_array_length(b.snapshot->'invoices'), 0) >= 110
     AND COALESCE(jsonb_array_length(b.snapshot->'customers'), 0) BETWEEN 25 AND 40
   ORDER BY p.id, b.created_at DESC
)
UPDATE public.user_data d
   SET products   = public.kamix_json_array_add_missing(d.products,   p.snapshot->'products'),
       invoices   = public.kamix_json_array_add_missing(d.invoices,   p.snapshot->'invoices'),
       customers  = public.kamix_json_array_add_missing(d.customers,  p.snapshot->'customers'),
       purchases  = public.kamix_json_array_add_missing(d.purchases,  p.snapshot->'purchases'),
       categories = public.kamix_json_array_add_missing(d.categories, p.snapshot->'categories'),
       updated_at = now()
  FROM picked p
 WHERE d.user_id = p.user_id;

-- گزارش بعد از ادغام — باید کالا ≥ ۱۰ و فاکتور ≥ ۱۱۸ باشد
SELECT p.username,
       p.first_name,
       p.last_name,
       d.settings->>'shopName' AS shop_name,
       COALESCE(jsonb_array_length(d.products), 0) AS products_now,
       COALESCE(jsonb_array_length(d.invoices), 0) AS invoices_now,
       COALESCE(jsonb_array_length(d.customers), 0) AS customers_now,
       COALESCE(jsonb_array_length(d.purchases), 0) AS purchases_now,
       (
         SELECT string_agg(x, ' | ')
           FROM (
             SELECT e->>'name' AS x
               FROM jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
              LIMIT 12
           ) s
       ) AS product_sample
  FROM public.profiles p
  JOIN public.user_data d ON d.user_id = p.id
 WHERE lower(p.username) = 'mmr';
