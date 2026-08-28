-- ════════════════════════════════════════════════════════════════════════════
-- برگرداندن قیمت ۹۹۹۹ جعلی — هیچ کالا یا فاکتوری حذف نمی‌شود.
--
-- هکر قیمت کالاها را روی ۹۹۹۹ گذاشته؛ فاکتور همان را نشان می‌دهد.
-- این SQL فقط فیلد قیمت را از پشتیبان ۲۶–۲۷ اوت کپی می‌کند، آن هم فقط
-- وقتی قیمت زنده دقیقاً ۹۹۹۹ باشد و پشتیبان عدد دیگری داشته باشد.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kamix_is_9999(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT j IS NOT NULL
     AND jsonb_typeof(j) = 'number'
     AND (j::text)::numeric = 9999;
$$;

CREATE OR REPLACE FUNCTION public.kamix_fix_price_fields(live jsonb, backup jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN backup IS NULL THEN live
    ELSE live
      || CASE WHEN public.kamix_is_9999(live->'price') AND backup ? 'price' AND NOT public.kamix_is_9999(backup->'price')
              THEN jsonb_build_object('price', backup->'price') ELSE '{}'::jsonb END
      || CASE WHEN public.kamix_is_9999(live->'buyPrice') AND backup ? 'buyPrice' AND NOT public.kamix_is_9999(backup->'buyPrice')
              THEN jsonb_build_object('buyPrice', backup->'buyPrice') ELSE '{}'::jsonb END
      || CASE WHEN public.kamix_is_9999(live->'consumerPrice') AND backup ? 'consumerPrice' AND NOT public.kamix_is_9999(backup->'consumerPrice')
              THEN jsonb_build_object('consumerPrice', backup->'consumerPrice') ELSE '{}'::jsonb END
      || CASE WHEN public.kamix_is_9999(live->'sellerPrice') AND backup ? 'sellerPrice' AND NOT public.kamix_is_9999(backup->'sellerPrice')
              THEN jsonb_build_object('sellerPrice', backup->'sellerPrice') ELSE '{}'::jsonb END
      || CASE WHEN public.kamix_is_9999(live->'wholesalePrice') AND backup ? 'wholesalePrice' AND NOT public.kamix_is_9999(backup->'wholesalePrice')
              THEN jsonb_build_object('wholesalePrice', backup->'wholesalePrice') ELSE '{}'::jsonb END
      || CASE WHEN public.kamix_is_9999(live->'originalPrice') AND backup ? 'originalPrice' AND NOT public.kamix_is_9999(backup->'originalPrice')
              THEN jsonb_build_object('originalPrice', backup->'originalPrice') ELSE '{}'::jsonb END
  END;
$$;

CREATE OR REPLACE FUNCTION public.kamix_fix_products_9999(live jsonb, backup jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(public.kamix_fix_price_fields(l.p, b.p) ORDER BY l.ord)
      FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) WITH ORDINALITY AS l(p, ord)
      LEFT JOIN LATERAL (
        SELECT x.p
          FROM jsonb_array_elements(COALESCE(backup, '[]'::jsonb)) x(p)
         WHERE x.p->>'id' = l.p->>'id'
           AND COALESCE(x.p->>'id', '') <> ''
         LIMIT 1
      ) b ON true
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.kamix_fix_items_9999(items jsonb, backup_items jsonb, backup_products jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(public.kamix_fix_price_fields(
               public.kamix_fix_price_fields(l.it, bi.it),
               bp.p
             ) ORDER BY l.ord)
      FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) WITH ORDINALITY AS l(it, ord)
      LEFT JOIN LATERAL (
        SELECT x.it
          FROM jsonb_array_elements(COALESCE(backup_items, '[]'::jsonb)) x(it)
         WHERE x.it->>'productId' = l.it->>'productId'
           AND COALESCE(x.it->>'productId', '') <> ''
         LIMIT 1
      ) bi ON true
      LEFT JOIN LATERAL (
        SELECT x.p
          FROM jsonb_array_elements(COALESCE(backup_products, '[]'::jsonb)) x(p)
         WHERE x.p->>'id' = l.it->>'productId'
           AND COALESCE(x.p->>'id', '') <> ''
         LIMIT 1
      ) bp ON true
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.kamix_fix_invoices_9999(live jsonb, backup jsonb, backup_products jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
               (l.inv || jsonb_build_object(
                 'items',
                 public.kamix_fix_items_9999(l.inv->'items', b.inv->'items', backup_products)
               ))
               ORDER BY l.ord
             )
      FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) WITH ORDINALITY AS l(inv, ord)
      LEFT JOIN LATERAL (
        SELECT x.inv
          FROM jsonb_array_elements(COALESCE(backup, '[]'::jsonb)) x(inv)
         WHERE x.inv->>'id' = l.inv->>'id'
           AND COALESCE(x.inv->>'id', '') <> ''
         LIMIT 1
      ) b ON true
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.kamix_is_9999(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_fix_price_fields(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_fix_products_9999(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_fix_items_9999(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_fix_invoices_9999(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

WITH safe_window AS (
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
    CROSS JOIN safe_window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND jsonb_typeof(COALESCE(b.snapshot->'products', '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(b.snapshot->'products', '[]'::jsonb)) >= 1
   ORDER BY d.user_id, b.created_at DESC
),
planned AS (
  SELECT p.user_id,
         public.kamix_fix_products_9999(d.products, p.snapshot->'products') AS products,
         public.kamix_fix_invoices_9999(d.invoices, p.snapshot->'invoices', p.snapshot->'products') AS invoices,
         CASE
           WHEN d.current_invoice IS NULL THEN d.current_invoice
           ELSE (
             public.kamix_fix_invoices_9999(
               jsonb_build_array(d.current_invoice),
               CASE WHEN p.snapshot->'current_invoice' IS NULL THEN '[]'::jsonb
                    ELSE jsonb_build_array(p.snapshot->'current_invoice') END,
               p.snapshot->'products'
             )->0
           )
         END AS current_invoice
    FROM picked p
    JOIN public.user_data d ON d.user_id = p.user_id
)
INSERT INTO public.user_data_backups (user_id, snapshot)
SELECT d.user_id, to_jsonb(d)
  FROM public.user_data d
  JOIN planned x ON x.user_id = d.user_id
 WHERE COALESCE(d.products, '[]'::jsonb) IS DISTINCT FROM COALESCE(x.products, '[]'::jsonb)
    OR COALESCE(d.invoices, '[]'::jsonb) IS DISTINCT FROM COALESCE(x.invoices, '[]'::jsonb);

WITH safe_window AS (
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
    CROSS JOIN safe_window w
   WHERE b.created_at >= w.from_at
     AND b.created_at < w.to_at
     AND jsonb_typeof(COALESCE(b.snapshot->'products', '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(b.snapshot->'products', '[]'::jsonb)) >= 1
   ORDER BY d.user_id, b.created_at DESC
)
UPDATE public.user_data d
   SET products = public.kamix_fix_products_9999(d.products, p.snapshot->'products'),
       invoices = public.kamix_fix_invoices_9999(d.invoices, p.snapshot->'invoices', p.snapshot->'products'),
       current_invoice = CASE
         WHEN d.current_invoice IS NULL THEN d.current_invoice
         ELSE (
           public.kamix_fix_invoices_9999(
             jsonb_build_array(d.current_invoice),
             CASE WHEN p.snapshot->'current_invoice' IS NULL THEN '[]'::jsonb
                  ELSE jsonb_build_array(p.snapshot->'current_invoice') END,
             p.snapshot->'products'
           )->0
         )
       END,
       updated_at = now()
  FROM picked p
 WHERE d.user_id = p.user_id
   AND (
         COALESCE(d.products, '[]'::jsonb)
         IS DISTINCT FROM public.kamix_fix_products_9999(d.products, p.snapshot->'products')
      OR COALESCE(d.invoices, '[]'::jsonb)
         IS DISTINCT FROM public.kamix_fix_invoices_9999(d.invoices, p.snapshot->'invoices', p.snapshot->'products')
   );

-- چند کالا هنوز ۹۹۹۹ مانده (پشتیبان هم همان بوده یا کالا در پشتیبان نبود)
SELECT pr.username,
       pr.first_name,
       pr.last_name,
       COUNT(*)::integer AS still_9999
  FROM public.user_data d
  JOIN public.profiles pr ON pr.id = d.user_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
 WHERE public.kamix_is_9999(e->'price')
 GROUP BY pr.username, pr.first_name, pr.last_name
 ORDER BY still_9999 DESC
 LIMIT 30;
