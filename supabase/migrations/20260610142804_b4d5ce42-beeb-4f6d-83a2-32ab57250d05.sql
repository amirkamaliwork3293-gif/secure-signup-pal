
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS plans jsonb NOT NULL DEFAULT jsonb_build_object(
    'trial',    jsonb_build_object('enabled', true, 'price', 0,       'duration_minutes', 60,     'discount_percent', 0, 'discount_until', null),
    '1month',   jsonb_build_object('enabled', true, 'price', 100000,  'duration_minutes', 43200,  'discount_percent', 0, 'discount_until', null),
    '3month',   jsonb_build_object('enabled', true, 'price', 280000,  'duration_minutes', 129600, 'discount_percent', 0, 'discount_until', null),
    '6month',   jsonb_build_object('enabled', true, 'price', 500000,  'duration_minutes', 259200, 'discount_percent', 0, 'discount_until', null),
    '12month',  jsonb_build_object('enabled', true, 'price', 1500000, 'duration_minutes', 525600, 'discount_percent', 0, 'discount_until', null)
  );

UPDATE public.app_settings
SET plans = jsonb_build_object(
    'trial',    jsonb_build_object('enabled', true, 'price', 0,                                  'duration_minutes', 60,     'discount_percent', 0, 'discount_until', null),
    '1month',   jsonb_build_object('enabled', true, 'price', COALESCE(price_1month, 100000),     'duration_minutes', 43200,  'discount_percent', 0, 'discount_until', null),
    '3month',   jsonb_build_object('enabled', true, 'price', COALESCE(price_3month, 280000),     'duration_minutes', 129600, 'discount_percent', 0, 'discount_until', null),
    '6month',   jsonb_build_object('enabled', true, 'price', COALESCE(price_6month, 500000),     'duration_minutes', 259200, 'discount_percent', 0, 'discount_until', null),
    '12month',  jsonb_build_object('enabled', true, 'price', COALESCE(price_12month, 1500000),   'duration_minutes', 525600, 'discount_percent', 0, 'discount_until', null)
  )
WHERE id = 1;
