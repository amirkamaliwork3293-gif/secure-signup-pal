-- ============================================================================
-- F2 — ثبت هر حذف (audit log) — فقط افزودنی؛ هیچ جدول/ستون موجودی تغییر نمی‌کند.
-- اجرا: یک‌بار در Supabase SQL Editor، «قبل از» دیپلوی کد F2. تکرار اجرا بی‌خطر است.
--
-- حذف در این برنامه یعنی شناسهٔ ردیف به settings.catalogTombstones اضافه شود و
-- همراه user_data به سرور برسد. این تریگر در «همان تراکنشِ» همان upsert برای هر
-- شناسهٔ تازه‌حذف‌شده یک ردیف لاگ می‌نویسد: اگر نوشتن لاگ شکست بخورد، خود ذخیره
-- هم رد می‌شود و گوشی دوباره تلاش می‌کند؛ پس حذفِ بی‌لاگ روی سرور ممکن نیست.
--
-- برگرداندن: DROP TRIGGER IF EXISTS user_data_log_deletes ON public.user_data;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_data_delete_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL,        -- اکانتی که داده‌اش حذف شد (بدون FK تا لاگ با حذف اکانت نرود)
  field       text NOT NULL,        -- products / invoices / categories / customers / ...
  row_id      text NOT NULL,
  row_label   text,                 -- نام کالا / مشتری / عنوان، اگر ردیف هنوز در ابر باشد
  actor_id    text,                 -- auth.uid() درخواست؛ خالی = ابزار ادمین/سرویس
  session_id  text,                 -- شناسهٔ نشست ورود Supabase (claim session_id در JWT)
  user_agent  text,                 -- مرورگر/گوشی ارسال‌کننده
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_data_delete_log_user_created_idx
  ON public.user_data_delete_log (user_id, created_at DESC);

ALTER TABLE public.user_data_delete_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_data_delete_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_data_delete_log TO authenticated;
GRANT ALL ON public.user_data_delete_log TO service_role;

DROP POLICY IF EXISTS "owner_or_admin_read_delete_log" ON public.user_data_delete_log;
CREATE POLICY "owner_or_admin_read_delete_log" ON public.user_data_delete_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
-- هیچ policy برای INSERT/UPDATE/DELETE نیست: فقط تریگر (SECURITY DEFINER) می‌نویسد
-- و هیچ کاربری نمی‌تواند لاگ را پاک یا جعل کند.

CREATE OR REPLACE FUNCTION public.log_user_data_deletes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_ts  jsonb := CASE WHEN jsonb_typeof(NEW.settings -> 'catalogTombstones') = 'object'
                        THEN NEW.settings -> 'catalogTombstones' ELSE '{}'::jsonb END;
  old_ts  jsonb := '{}'::jsonb;
  claims  jsonb := '{}'::jsonb;
  headers jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.settings -> 'catalogTombstones') = 'object' THEN
    old_ts := OLD.settings -> 'catalogTombstones';
  END IF;
  IF new_ts = old_ts THEN
    RETURN NULL;
  END IF;

  -- فقط خواندن متادیتای درخواست محافظت می‌شود؛ خود INSERT لاگ محافظت نمی‌شود
  -- تا شکستش کل ذخیره را رد کند.
  BEGIN
    claims  := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    headers := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
  EXCEPTION WHEN others THEN
    claims := '{}'::jsonb;
    headers := '{}'::jsonb;
  END;

  INSERT INTO public.user_data_delete_log
    (user_id, field, row_id, row_label, actor_id, session_id, user_agent)
  SELECT NEW.user_id, t.field, tid.id,
         (SELECT COALESCE(e ->> 'name',
                          NULLIF(concat_ws(' ', e ->> 'firstName', e ->> 'lastName'), ''),
                          e ->> 'title')
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(to_jsonb(NEW) -> t.field) = 'array'
                        THEN to_jsonb(NEW) -> t.field ELSE '[]'::jsonb END) AS e
           WHERE e ->> 'id' = tid.id
           LIMIT 1),
         claims ->> 'sub',
         claims ->> 'session_id',
         left(headers ->> 'user-agent', 300)
    FROM jsonb_each(new_ts) AS t(field, ids)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.ids) = 'array' THEN t.ids ELSE '[]'::jsonb END) AS tid(id)
   WHERE t.field <> 'current_invoice'   -- بستن تب پیش‌نویس فاکتور، حذف رکورد نیست
     AND NOT (CASE WHEN jsonb_typeof(old_ts -> t.field) = 'array'
                   THEN old_ts -> t.field ELSE '[]'::jsonb END ? tid.id);

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_user_data_deletes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_log_deletes ON public.user_data;
CREATE TRIGGER user_data_log_deletes
  AFTER INSERT OR UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.log_user_data_deletes();

-- بررسی بعد از اجرا:
-- SELECT * FROM public.user_data_delete_log ORDER BY created_at DESC LIMIT 50;
