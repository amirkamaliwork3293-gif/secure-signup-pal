CREATE TABLE IF NOT EXISTS public.user_data_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.user_data_backups TO service_role;

ALTER TABLE public.user_data_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_user_data_backups"
  ON public.user_data_backups FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS user_data_backups_user_created_idx
  ON public.user_data_backups (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.snapshot_user_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_at timestamptz;
BEGIN
  SELECT created_at INTO last_at
    FROM public.user_data_backups
   WHERE user_id = OLD.user_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF last_at IS NULL OR last_at < now() - interval '6 hours' THEN
    INSERT INTO public.user_data_backups (user_id, snapshot)
    VALUES (OLD.user_id, to_jsonb(OLD));

    DELETE FROM public.user_data_backups b
     WHERE b.user_id = OLD.user_id
       AND b.id NOT IN (
         SELECT id FROM public.user_data_backups
          WHERE user_id = OLD.user_id
          ORDER BY created_at DESC
          LIMIT 40
       );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_data_snapshot ON public.user_data;
CREATE TRIGGER user_data_snapshot
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_user_data();