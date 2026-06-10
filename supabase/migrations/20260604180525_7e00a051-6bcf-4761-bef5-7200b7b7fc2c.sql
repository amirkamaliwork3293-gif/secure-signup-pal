
-- Clean slate for legacy profiles table from previous version
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ─── Roles enum & user_roles table ───────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role    public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "users_read_own_roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ─── profiles ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.profile_status AS ENUM ('pending', 'active', 'expired', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_plan AS ENUM ('1month', '3month', '6month');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE NOT NULL,
  first_name  TEXT,
  last_name   TEXT,
  plan        public.subscription_plan,
  status      public.profile_status NOT NULL DEFAULT 'pending',
  start_date  TIMESTAMPTZ,
  end_date    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "admins_read_all_profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_update_profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX profiles_username_idx ON public.profiles (username);
CREATE INDEX profiles_status_idx ON public.profiles (status);

-- ─── signup_requests ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.signup_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  username          TEXT NOT NULL,
  plan              public.subscription_plan NOT NULL,
  payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status            public.request_status NOT NULL DEFAULT 'pending',
  password_set      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ
);

GRANT INSERT, SELECT ON public.signup_requests TO anon;
GRANT SELECT, INSERT, UPDATE ON public.signup_requests TO authenticated;
GRANT ALL ON public.signup_requests TO service_role;
ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can create a signup request
CREATE POLICY "anyone_create_signup_request" ON public.signup_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Anyone can read by username (to check status / set password) — only public fields effectively
CREATE POLICY "anyone_read_own_request_by_username" ON public.signup_requests
  FOR SELECT TO anon, authenticated USING (true);

-- Admins can update requests
CREATE POLICY "admins_update_requests" ON public.signup_requests
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX signup_requests_username_idx ON public.signup_requests (username);
CREATE INDEX signup_requests_status_idx ON public.signup_requests (status);

-- ─── app_settings ────────────────────────────────────────────────────────────
CREATE TABLE public.app_settings (
  id           INT PRIMARY KEY DEFAULT 1,
  card_number  TEXT NOT NULL DEFAULT '',
  card_holder  TEXT NOT NULL DEFAULT '',
  bank_name    TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO public.app_settings (id, card_number, card_holder, bank_name)
VALUES (1, '6037-9975-1234-5678', 'امیر کمالی', 'بانک ملی')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_settings" ON public.app_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admins_update_settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
