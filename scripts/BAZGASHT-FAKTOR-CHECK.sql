-- فقط خواندن — هیچ داده‌ای عوض نمی‌شود.
-- سوپابیس → SQL Editor → Run
--
-- برای هر حساب نشان می‌دهد:
--   live_n     = تعداد فاکتور الان
--   backup_n   = تعداد فاکتور در آخرین پشتیبان ۲۶–۲۷ اوت
--   overlap    = چند فاکتور با همان شماره در هر دو هست
--   live_only  = چند فاکتور فقط الان هست (ممکن است کار امروز یا جعلی هکر باشد)
--   backup_only= چند فاکتور فقط در پشتیبان بود (با SQL قبلی باید اضافه‌شده باشند → نزدیک ۰)

WITH safe_window AS (
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
    CROSS JOIN safe_window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND jsonb_typeof(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) >= 1
   ORDER BY d.user_id, b.created_at DESC
)
SELECT pr.username,
       pr.first_name,
       pr.last_name,
       p.backup_at,
       jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS live_n,
       jsonb_array_length(COALESCE(p.snapshot->'invoices', '[]'::jsonb)) AS backup_n,
       (
         SELECT COUNT(*)::integer
           FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) l
          WHERE COALESCE(l->>'id', '') <> ''
            AND EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(p.snapshot->'invoices', '[]'::jsonb)) b
               WHERE b->>'id' = l->>'id'
            )
       ) AS overlap,
       (
         SELECT COUNT(*)::integer
           FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) l
          WHERE COALESCE(l->>'id', '') <> ''
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(p.snapshot->'invoices', '[]'::jsonb)) b
               WHERE b->>'id' = l->>'id'
            )
       ) AS live_only
  FROM picked p
  JOIN public.user_data d ON d.user_id = p.user_id
  JOIN public.profiles pr ON pr.id = p.user_id
 WHERE pr.username IN (
        'amirmmnn', 'mahdi0456', 'caferefiq', 'shayan', 'mahdi42711'
      )
    OR jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) >= 400
 ORDER BY live_n DESC
 LIMIT 40;
