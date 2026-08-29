-- فقط خواندن — هیچ داده‌ای عوض نمی‌شود.
-- سوپابیس → SQL Editor → همه را کپی → Run
-- نتیجه را برایم بفرستید تا بگویم برگرداندن ممکن است یا نه.
--
-- حساب: محمد معینی رودبالی / یوزرنیم mmr
-- هک: ۲۷ اوت ۲۰۲۶ — پشتیبانِ قبل از ۲۷ اوت یعنی دادهٔ پیش از هک

WITH target AS (
  SELECT p.id AS user_id,
         p.username,
         p.first_name,
         p.last_name,
         p.status,
         p.created_at AS account_created
    FROM public.profiles p
   WHERE lower(p.username) = 'mmr'
      OR p.username ILIKE 'mmr%'
      OR p.last_name ILIKE '%رودبال%'
      OR (p.first_name ILIKE '%محمد%' AND p.last_name ILIKE '%معینی%')
   ORDER BY CASE WHEN lower(p.username) = 'mmr' THEN 0 ELSE 1 END
   LIMIT 5
),
ms AS (
  SELECT
    (EXTRACT(EPOCH FROM timestamptz '2026-08-27 00:00:00+00') * 1000)::bigint AS hack_ms,
    (EXTRACT(EPOCH FROM timestamptz '2026-08-28 00:00:00+00') * 1000)::bigint AS day28_ms
),
live AS (
  SELECT t.*,
         d.updated_at AS live_updated,
         COALESCE(jsonb_array_length(d.products), 0) AS live_products,
         COALESCE(jsonb_array_length(d.invoices), 0) AS live_invoices,
         COALESCE(jsonb_array_length(d.customers), 0) AS live_customers,
         COALESCE(jsonb_array_length(d.purchases), 0) AS live_purchases,
         d.settings->>'shopName' AS shop_name,
         (
           SELECT COUNT(*)::integer
             FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e
            WHERE e->>'createdAt' ~ '^[0-9]+$'
              AND (e->>'createdAt')::bigint < ms.hack_ms
         ) AS invoices_before_27,
         (
           SELECT COUNT(*)::integer
             FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e
            WHERE e->>'createdAt' ~ '^[0-9]+$'
              AND (e->>'createdAt')::bigint >= ms.day28_ms
         ) AS invoices_from_28,
         (
           SELECT string_agg(x, ' | ')
             FROM (
               SELECT e->>'name' AS x
                 FROM jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
                LIMIT 8
             ) s
         ) AS live_product_sample
    FROM target t
    CROSS JOIN ms
    LEFT JOIN public.user_data d ON d.user_id = t.user_id
)
SELECT
  l.username,
  l.first_name,
  l.last_name,
  l.status,
  l.account_created,
  l.shop_name,
  l.live_updated,
  l.live_products,
  l.live_invoices,
  l.live_customers,
  l.live_purchases,
  l.invoices_before_27,
  l.invoices_from_28,
  l.live_product_sample,
  (
    SELECT COUNT(*)::integer
      FROM public.user_data_backups b
     WHERE b.user_id = l.user_id
  ) AS backup_rows,
  (
    SELECT COUNT(*)::integer
      FROM public.user_data_backups b
     WHERE b.user_id = l.user_id
       AND b.created_at < timestamptz '2026-08-27 00:00:00+00'
  ) AS backups_before_hack,
  (
    SELECT b.created_at
      FROM public.user_data_backups b
     WHERE b.user_id = l.user_id
       AND b.created_at < timestamptz '2026-08-27 00:00:00+00'
     ORDER BY b.created_at DESC
     LIMIT 1
  ) AS last_backup_before_hack,
  (
    SELECT jsonb_build_object(
             'products', COALESCE(jsonb_array_length(b.snapshot->'products'), 0),
             'invoices', COALESCE(jsonb_array_length(b.snapshot->'invoices'), 0),
             'customers', COALESCE(jsonb_array_length(b.snapshot->'customers'), 0),
             'purchases', COALESCE(jsonb_array_length(b.snapshot->'purchases'), 0),
             'shop', b.snapshot->'settings'->>'shopName',
             'sample', (
               SELECT string_agg(x, ' | ')
                 FROM (
                   SELECT e->>'name' AS x
                     FROM jsonb_array_elements(COALESCE(b.snapshot->'products', '[]'::jsonb)) e
                    LIMIT 8
                 ) s
             )
           )
      FROM public.user_data_backups b
     WHERE b.user_id = l.user_id
       AND b.created_at < timestamptz '2026-08-27 00:00:00+00'
     ORDER BY b.created_at DESC
     LIMIT 1
  ) AS pre_hack_backup,
  (
    SELECT json_agg(s ORDER BY s.created_at DESC)
      FROM (
        SELECT b.created_at,
               COALESCE(jsonb_array_length(b.snapshot->'products'), 0) AS products,
               COALESCE(jsonb_array_length(b.snapshot->'invoices'), 0) AS invoices,
               COALESCE(jsonb_array_length(b.snapshot->'customers'), 0) AS customers
          FROM public.user_data_backups b
         WHERE b.user_id = l.user_id
         ORDER BY b.created_at DESC
         LIMIT 12
      ) s
  ) AS recent_backups
  FROM live l;
