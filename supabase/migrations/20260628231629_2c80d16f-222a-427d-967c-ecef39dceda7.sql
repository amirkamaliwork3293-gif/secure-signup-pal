
-- Lock down app_settings reads: payment card fields are no longer exposed to anon/authenticated.
-- A public server function (getPublicSettings) returns the safe display fields.
DROP POLICY IF EXISTS anyone_read_settings ON public.app_settings;

CREATE POLICY admins_read_settings ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Lock down signup_requests inserts: all inserts now go through server functions
-- using the service role, which bypasses RLS. Removing the permissive INSERT
-- policy prevents anon/authenticated clients from forging requests with
-- arbitrary target_user_id / payment_confirmed / password_set values.
DROP POLICY IF EXISTS anyone_create_signup_request ON public.signup_requests;
