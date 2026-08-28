-- فقط خواندن — هیچ داده‌ای عوض نمی‌شود.
-- یک نتیجه برای amirmmnn: تعداد زنده، تعداد شناسهٔ یکتا، پشتیبان‌ها

SELECT
  jsonb_array_length(COALESCE(d.invoices, '[]'::jsonb)) AS live_n,
  (
    SELECT COUNT(DISTINCT NULLIF(e->>'id', ''))::integer
      FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e
  ) AS distinct_ids,
  (
    SELECT COUNT(*)::integer
      FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e
     WHERE e->>'createdAt' ~ '^[0-9]+$'
       AND (e->>'createdAt')::bigint >= (EXTRACT(EPOCH FROM timestamptz '2026-08-27 00:00:00+00') * 1000)::bigint
       AND (e->>'createdAt')::bigint <  (EXTRACT(EPOCH FROM timestamptz '2026-08-28 00:00:00+00') * 1000)::bigint
  ) AS created_27_aug,
  (
    SELECT COUNT(*)::integer
      FROM jsonb_array_elements(COALESCE(d.invoices, '[]'::jsonb)) e
     WHERE e->>'createdAt' ~ '^[0-9]+$'
       AND (e->>'createdAt')::bigint >= (EXTRACT(EPOCH FROM timestamptz '2026-08-28 00:00:00+00') * 1000)::bigint
  ) AS created_28_aug,
  (
    SELECT COUNT(*)::integer
      FROM public.user_data_backups b
     WHERE b.user_id = d.user_id
  ) AS backup_rows,
  (
    SELECT json_agg(s ORDER BY s.created_at DESC)
      FROM (
        SELECT b.created_at,
               jsonb_array_length(COALESCE(b.snapshot->'invoices', '[]'::jsonb)) AS invoices_in_backup
          FROM public.user_data_backups b
         WHERE b.user_id = d.user_id
         ORDER BY b.created_at DESC
         LIMIT 15
      ) s
  ) AS backups
  FROM public.user_data d
  JOIN public.profiles p ON p.id = d.user_id
 WHERE p.username = 'amirmmnn';
