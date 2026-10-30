-- ════════════════════════════════════════════════════════════════════════════
-- برگرداندن همهٔ مشتریانِ حذف‌شدهٔ یک کاربر (سوپابیس → SQL Editor → Run)
--
-- فقط v_username را عوض کنید. هیچ چیزی پاک نمی‌شود:
--   • اول از کل دادهٔ کاربر یک نسخهٔ پشتیبان دائمی در user_data_backups
--     (_archived_reason = before_customer_restore) گرفته می‌شود.
--   • هر مشتری حذف‌شده یک کپی با شناسهٔ تازه (شناسهٔ قبلی + -r<زمان>) و
--     restoredFrom می‌گیرد، با همهٔ بدهی/پرداخت‌هایش. شناسهٔ قبلی عمداً حذف
--     می‌ماند: گوشی‌ها آن را حذف‌شده به خاطر دارند و دوباره پنهانش می‌کنند.
--   • فاکتورها، خریدها و یادآوری‌هایی که به شناسهٔ قبلی وصل بودند به شناسهٔ
--     تازه وصل می‌شوند تا در پروفایل مشتری دیده شوند.
--   • دوباره اجرا کردن بی‌خطر است: مشتری‌ای که قبلاً برگشته تکرار نمی‌شود.
--   • همه‌چیز در یک تراکنش است؛ اگر جایی خطا بدهد هیچ تغییری ثبت نمی‌شود.
-- گوشی‌ها در همگام‌سازی بعدی (معمولاً فوری) مشتریان را می‌بینند.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_username text   := 'erfangolnar';   -- ← یوزرنیم کاربر
  v_uid      uuid;
  v_now_ms   bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_suffix   text   := '-r' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_map      jsonb;  -- {شناسهٔ قبلی: شناسهٔ تازه}
  v_new      jsonb;  -- مشتریان برگشته
BEGIN
  SELECT id INTO v_uid FROM public.profiles WHERE username = v_username;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'کاربر % پیدا نشد', v_username;
  END IF;

  PERFORM 1 FROM public.user_data WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'دادهٔ کاربر % پیدا نشد', v_username;
  END IF;

  SELECT jsonb_object_agg(s.old_id, s.old_id || v_suffix),
         jsonb_agg(s.c || jsonb_build_object('txs', s.txs,
                                             'id', s.old_id || v_suffix,
                                             'restoredFrom', s.old_id,
                                             'updatedAt', v_now_ms) ORDER BY s.ord)
    INTO v_map, v_new
    FROM (
      -- تراکنشی که کاربر جداگانه حذف کرده بود برنمی‌گردد
      SELECT DISTINCT ON (c ->> 'id') c, c ->> 'id' AS old_id, ord,
             COALESCE((SELECT jsonb_agg(tx ORDER BY o)
                         FROM jsonb_array_elements(
                                CASE WHEN jsonb_typeof(c -> 'txs') = 'array' THEN c -> 'txs' ELSE '[]'::jsonb END
                              ) WITH ORDINALITY AS x(tx, o)
                        WHERE NOT COALESCE(d.settings -> 'catalogTombstones' -> 'customers.txs', '[]'::jsonb)
                                  ? COALESCE(tx ->> 'id', '')), '[]'::jsonb) AS txs
        FROM public.user_data d
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(d.customers) = 'array' THEN d.customers ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS t(c, ord)
       WHERE d.user_id = v_uid
         AND COALESCE(c ->> 'id', '') <> ''
         AND COALESCE(d.settings -> 'catalogTombstones' -> 'customers', '[]'::jsonb) ? (c ->> 'id')
         AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(d.customers) AS x
                WHERE x ->> 'restoredFrom' = c ->> 'id')
       ORDER BY c ->> 'id', ord
    ) s;

  IF v_new IS NULL THEN
    RAISE NOTICE 'مشتری حذف‌شده‌ای برای برگرداندن نیست (یا قبلاً برگشته‌اند).';
    RETURN;
  END IF;

  INSERT INTO public.user_data_backups (user_id, snapshot)
  SELECT d.user_id, to_jsonb(d) || jsonb_build_object('_archived_reason', 'before_customer_restore')
    FROM public.user_data d
   WHERE d.user_id = v_uid;

  UPDATE public.user_data d
     SET customers = d.customers || v_new,
         invoices = CASE WHEN jsonb_typeof(d.invoices) <> 'array' THEN d.invoices ELSE (
           SELECT COALESCE(jsonb_agg(
                    CASE WHEN v_map ? (i -> 'customer' ->> 'customerId')
                         THEN jsonb_set(i, '{customer,customerId}', v_map -> (i -> 'customer' ->> 'customerId'))
                              || jsonb_build_object('updatedAt', v_now_ms)
                         ELSE i END ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(d.invoices) WITH ORDINALITY AS t(i, o)) END,
         purchases = CASE WHEN jsonb_typeof(d.purchases) <> 'array' THEN d.purchases ELSE (
           SELECT COALESCE(jsonb_agg(
                    CASE WHEN v_map ? (p ->> 'supplierCustomerId')
                         THEN p || jsonb_build_object('supplierCustomerId', v_map -> (p ->> 'supplierCustomerId'),
                                                      'updatedAt', v_now_ms)
                         ELSE p END ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(d.purchases) WITH ORDINALITY AS t(p, o)) END,
         reminders = CASE WHEN jsonb_typeof(d.reminders) <> 'array' THEN d.reminders ELSE (
           SELECT COALESCE(jsonb_agg(
                    CASE WHEN v_map ? (r ->> 'customerId')
                         THEN r || jsonb_build_object('customerId', v_map -> (r ->> 'customerId'),
                                                      'updatedAt', v_now_ms)
                         ELSE r END ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(d.reminders) WITH ORDINALITY AS t(r, o)) END
   WHERE d.user_id = v_uid;

  RAISE NOTICE '% مشتری برگشت.', jsonb_array_length(v_new);
END;
$$;

-- بررسی: bargashte باید برابر تعداد مشتریان برگشته باشد.
SELECT count(*) FILTER (WHERE c ? 'restoredFrom') AS bargashte,
       count(*)                                    AS hame_dar_server
  FROM public.user_data d
  JOIN public.profiles p ON p.id = d.user_id
  CROSS JOIN LATERAL jsonb_array_elements(d.customers) c
 WHERE p.username = 'erfangolnar';
