-- Tests for supabase/migrations/20261115120000_sync_delta.sql
-- Run through scripts/sql-tests/run.sh (throwaway local PostgreSQL only).
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ids(j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(x ->> 'id', ',' ORDER BY ord), '')
    FROM jsonb_array_elements(COALESCE(j, '[]'::jsonb)) WITH ORDINALITY t(x, ord);
$$;

INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');

-- Every statement below runs like a signed-in device: role authenticated + RLS.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- 1) First push of an account creates the row.
DO $$
DECLARE r jsonb; d public.user_data;
BEGIN
  r := public.kamix_sync_push('{"rows":{"products":[{"id":"p1","name":"A","updatedAt":1000},{"id":"p2","name":"B","updatedAt":1000}]},
                                "settings":{"set":{"shopName":"S"}}}');
  PERFORM pg_temp.ok(r -> 'prev_seq' = 'null'::jsonb, '1: prev_seq of a new account must be null');
  PERFORM pg_temp.ok((r ->> 'seq')::bigint > 0, '1: seq must be positive');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(pg_temp.ids(d.products) = 'p1,p2', '1: products ' || pg_temp.ids(d.products));
  PERFORM pg_temp.ok(d.settings ->> 'shopName' = 'S', '1: settings');
  PERFORM pg_temp.ok(d.sync_seq = (r ->> 'seq')::bigint, '1: returned seq = stored seq');
  PERFORM pg_temp.ok((public.kamix_sync_pull(0) ->> 'full')::boolean, '1: a device with cursor 0 must do a full read after the row was created');
END $$;

-- 2) A changed row is replaced in place, a new row goes first, others untouched;
--    the pull returns exactly those rows.
DO $$
DECLARE r jsonb; d public.user_data; s0 bigint; pull jsonb;
BEGIN
  SELECT sync_seq INTO s0 FROM public.user_data;
  r := public.kamix_sync_push('{"rows":{"products":[{"id":"p3","name":"C","updatedAt":2000},{"id":"p1","name":"A2","updatedAt":2000}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(pg_temp.ids(d.products) = 'p3,p1,p2', '2: order ' || pg_temp.ids(d.products));
  PERFORM pg_temp.ok(d.products -> 1 ->> 'name' = 'A2', '2: p1 not updated');
  PERFORM pg_temp.ok((r ->> 'prev_seq')::bigint = s0, '2: prev_seq');
  pull := public.kamix_sync_pull(s0);
  PERFORM pg_temp.ok(NOT (pull ->> 'full')::boolean, '2: must be a delta');
  PERFORM pg_temp.ok(pg_temp.ids(pull -> 'fields' -> 'products' -> 'rows') = 'p3,p1', '2: delta rows ' || (pull -> 'fields')::text);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_object_keys(pull -> 'fields')) = 1, '2: only products changed');
  PERFORM pg_temp.ok((pull ->> 'seq')::bigint = d.sync_seq, '2: pull seq');
  pull := public.kamix_sync_pull(d.sync_seq);
  PERFORM pg_temp.ok(pull -> 'fields' = '{}'::jsonb AND NOT (pull ->> 'full')::boolean, '2: nothing after the current version');
  PERFORM pg_temp.ok((public.kamix_sync_pull(NULL) ->> 'full')::boolean, '2: null cursor → full');
  PERFORM pg_temp.ok((public.kamix_sync_pull(d.sync_seq + 1000) ->> 'full')::boolean, '2: cursor from the future → full');
END $$;

-- 3) Newest edit of a row wins, whatever the arrival order.
DO $$
DECLARE d public.user_data;
BEGIN
  PERFORM public.kamix_sync_push('{"rows":{"products":[{"id":"p2","name":"late","updatedAt":900000}]}}');
  PERFORM public.kamix_sync_push('{"rows":{"products":[{"id":"p2","name":"stale","updatedAt":5000}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(d.products -> 2 ->> 'name' = 'late', '3: an older copy replaced a newer row');
  PERFORM public.kamix_sync_push('{"rows":{"products":[{"id":"p2","name":"newest","updatedAt":950000}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(d.products -> 2 ->> 'name' = 'newest', '3: a newer copy did not replace the row');
  -- no usable timestamp on either side (legacy rows): the sent copy wins
  PERFORM public.kamix_sync_push('{"rows":{"categories":[{"id":"c1","name":"x","date":"1403/01/01"}]}}');
  PERFORM public.kamix_sync_push('{"rows":{"categories":[{"id":"c1","name":"y","date":"1403/01/01"}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(d.categories -> 0 ->> 'name' = 'y', '3: legacy row not updated');
END $$;

-- 4) Customer ledgers: entries from both sides survive; a deleted entry stays deleted.
DO $$
DECLARE d public.user_data; c jsonb; s0 bigint; pull jsonb;
BEGIN
  PERFORM public.kamix_sync_push('{"rows":{"customers":[{"id":"cu1","firstName":"R","updatedAt":1000,
     "txs":[{"id":"t0","amount":1,"at":10}]}]}}');
  -- device A adds t1 (newer row), device B (older copy, did not see t1) adds t2
  PERFORM public.kamix_sync_push('{"rows":{"customers":[{"id":"cu1","firstName":"R","updatedAt":900000,
     "txs":[{"id":"t1","amount":2,"at":30},{"id":"t0","amount":1,"at":10}]}]}}');
  PERFORM public.kamix_sync_push('{"rows":{"customers":[{"id":"cu1","firstName":"R","phone":"0912","updatedAt":5000,
     "txs":[{"id":"t2","amount":3,"at":20},{"id":"t0","amount":1,"at":10}]}]}}');
  SELECT * INTO d FROM public.user_data;
  c := d.customers -> 0;
  PERFORM pg_temp.ok(pg_temp.ids(c -> 'txs') = 't1,t2,t0', '4: txs ' || pg_temp.ids(c -> 'txs'));
  PERFORM pg_temp.ok(c ->> 'phone' IS NULL, '4: the older copy must not win the row itself');
  -- delete t0 (tombstone) and send a copy that still has it
  SELECT sync_seq INTO s0 FROM public.user_data;
  PERFORM public.kamix_sync_push('{"settings":{"tombstones":{"customers.txs":["t0"]}},
     "rows":{"customers":[{"id":"cu1","firstName":"R","updatedAt":990000,
     "txs":[{"id":"t1","amount":2,"at":30},{"id":"t2","amount":3,"at":20}]}]}}');
  PERFORM public.kamix_sync_push('{"rows":{"customers":[{"id":"cu1","firstName":"R","updatedAt":995000,
     "txs":[{"id":"t1","amount":2,"at":30},{"id":"t2","amount":3,"at":20},{"id":"t0","amount":1,"at":10}]}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(pg_temp.ids(d.customers -> 0 -> 'txs') = 't1,t2', '4: deleted tx came back: ' || pg_temp.ids(d.customers -> 0 -> 'txs'));
  pull := public.kamix_sync_pull(s0);
  PERFORM pg_temp.ok(pull -> 'tombstones' -> 'customers.txs' = '["t0"]'::jsonb, '4: tombstone delta ' || (pull -> 'tombstones')::text);
  PERFORM pg_temp.ok(NOT (pull -> 'fields' ? 'settings'), '4: only a tombstone changed; settings must not be re-sent');
END $$;

-- 5) Settings: set / unset keys, tombstones are a union and never forgotten.
DO $$
DECLARE d public.user_data; s0 bigint; pull jsonb;
BEGIN
  PERFORM public.kamix_sync_push('{"settings":{"set":{"a":1,"b":2},"tombstones":{"products":["x2","x1"]}}}');
  SELECT sync_seq INTO s0 FROM public.user_data;
  PERFORM public.kamix_sync_push('{"settings":{"set":{"a":5,"catalogTombstones":{"products":[]}},"unset":["b","catalogTombstones"],"tombstones":{"products":["x3","x1"]}}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(d.settings ->> 'a' = '5' AND NOT d.settings ? 'b' AND d.settings ->> 'shopName' = 'S', '5: settings ' || d.settings::text);
  PERFORM pg_temp.ok(d.settings -> 'catalogTombstones' -> 'products' = '["x1","x2","x3"]'::jsonb, '5: tombstones ' || (d.settings -> 'catalogTombstones')::text);
  pull := public.kamix_sync_pull(s0);
  PERFORM pg_temp.ok(pull -> 'tombstones' -> 'products' = '["x3"]'::jsonb, '5: only the new tombstone travels');
  PERFORM pg_temp.ok(pull -> 'fields' -> 'settings' -> 'whole' ->> 'a' = '5', '5: settings delta');
  PERFORM pg_temp.ok(NOT (pull -> 'fields' -> 'settings' -> 'whole' ? 'catalogTombstones'), '5: settings delta must not carry the tombstone list');
END $$;

-- 6) An old app version writes user_data directly: new devices still get a delta.
DO $$
DECLARE d public.user_data; s0 bigint; pull jsonb;
BEGIN
  SELECT * INTO d FROM public.user_data;
  s0 := d.sync_seq;
  UPDATE public.user_data
     SET invoices = '[{"id":"i1","total":10,"createdAt":5}]'::jsonb,
         products = jsonb_set(d.products, '{0,name}', '"C-old-app"') || '[{"id":"p9","name":"old app"}]'::jsonb,
         current_invoice = '{"open":[{"id":"o1","items":[]}],"activeId":"o1"}'::jsonb
   WHERE user_id = auth.uid();
  pull := public.kamix_sync_pull(s0);
  PERFORM pg_temp.ok(NOT (pull ->> 'full')::boolean, '6: delta expected');
  PERFORM pg_temp.ok(pg_temp.ids(pull -> 'fields' -> 'products' -> 'rows') = 'p3,p9', '6: products delta ' || (pull -> 'fields' -> 'products')::text);
  PERFORM pg_temp.ok(pg_temp.ids(pull -> 'fields' -> 'invoices' -> 'rows') = 'i1', '6: invoices delta');
  PERFORM pg_temp.ok(pull -> 'fields' -> 'current_invoice' -> 'whole' ->> 'activeId' = 'o1', '6: board');
END $$;

-- 7) Rows without an id cannot be a per-row delta: the whole field is sent.
DO $$
DECLARE s0 bigint; pull jsonb; d public.user_data;
BEGIN
  SELECT sync_seq INTO s0 FROM public.user_data;
  PERFORM public.kamix_sync_push('{"rows":{"expenses":[{"title":"no id"},{"id":"e1","title":"with id"}]}}');
  PERFORM public.kamix_sync_push('{"rows":{"expenses":[{"title":"no id"}]}}');
  SELECT * INTO d FROM public.user_data;
  PERFORM pg_temp.ok(jsonb_array_length(d.expenses) = 2, '7: the id-less row was duplicated: ' || d.expenses::text);
  pull := public.kamix_sync_pull(s0);
  PERFORM pg_temp.ok(jsonb_array_length(pull -> 'fields' -> 'expenses' -> 'whole') = 2, '7: expected the whole field: ' || (pull -> 'fields')::text);
END $$;

-- 7b) A device that remembers a version from before this installation re-reads everything.
DO $$
DECLARE m bigint;
BEGIN
  SELECT min_seq INTO m FROM public.user_data_sync_meta;
  PERFORM pg_temp.ok(m > 1000000000000, '7b: versions must start at a time-based value');
  PERFORM pg_temp.ok((public.kamix_sync_pull(m - 1) ->> 'full')::boolean, '7b: older-era cursor → full');
  PERFORM pg_temp.ok((SELECT sync_seq FROM public.user_data) > m, '7b: saved rows are above min_seq');
END $$;

-- 8) Nothing sent → nothing written.
DO $$
DECLARE s0 bigint; r jsonb;
BEGIN
  SELECT sync_seq INTO s0 FROM public.user_data;
  r := public.kamix_sync_push('{"rows":{"products":[]},"settings":{"set":{"a":5}}}');
  PERFORM pg_temp.ok((r ->> 'noop')::boolean AND (r ->> 'seq')::bigint = s0, '8: an empty push must not write');
  r := public.kamix_sync_push('{}');
  PERFORM pg_temp.ok((r ->> 'noop')::boolean, '8: {} must not write');
END $$;

-- 9) Another account sees and changes nothing of this one.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
DO $$
DECLARE pull jsonb; n int;
BEGIN
  pull := public.kamix_sync_pull(0);
  PERFORM pg_temp.ok(NOT (pull ->> 'exists')::boolean, '9: account B must not see account A');
  SELECT count(*) INTO n FROM public.user_data_row_seq;
  PERFORM pg_temp.ok(n = 0, '9: account B can read A''s change log');
  PERFORM public.kamix_sync_push('{"rows":{"products":[{"id":"b1","name":"B"}]}}');
  SELECT count(*) INTO n FROM public.user_data;
  PERFORM pg_temp.ok(n = 1, '9: B sees more than its own row');
  PERFORM pg_temp.ok(pg_temp.ids((SELECT products FROM public.user_data)) = 'b1', '9: B products');
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
DO $$
BEGIN
  PERFORM pg_temp.ok(NOT (SELECT products FROM public.user_data) @> '[{"id":"b1"}]'::jsonb, '9: B''s row leaked into A');
END $$;

-- 10) Not signed in → refused.
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN PERFORM public.kamix_sync_push('{"rows":{"products":[{"id":"zz"}]}}');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  PERFORM pg_temp.ok(refused, '10: push without a user must be refused');
  refused := false;
  BEGIN PERFORM public.kamix_sync_pull(0);
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  PERFORM pg_temp.ok(refused, '10: pull without a user must be refused');
END $$;
RESET ROLE;
SET ROLE anon;
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN PERFORM public.kamix_sync_pull(0);
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  PERFORM pg_temp.ok(refused, '10: anon must not be able to call the functions');
END $$;
RESET ROLE;

-- 11) A heavy account: 10,000 invoices, 2,000 customers, 3,000 products.
INSERT INTO public.user_data (user_id, products, invoices, customers)
SELECT '00000000-0000-0000-0000-00000000000c',
  (SELECT jsonb_agg(jsonb_build_object('id', 'p' || g, 'name', 'کالای شماره ' || g, 'price', g * 1000, 'stock', 5, 'updatedAt', 1000)) FROM generate_series(1, 3000) g),
  (SELECT jsonb_agg(jsonb_build_object('id', 'i' || g, 'createdAt', g, 'total', g * 10,
            'items', (SELECT jsonb_agg(jsonb_build_object('productId', 'p' || k, 'name', 'کالای شماره ' || k, 'price', 1000, 'quantity', 2)) FROM generate_series(1, 6) k)))
     FROM generate_series(1, 10000) g),
  (SELECT jsonb_agg(jsonb_build_object('id', 'c' || g, 'firstName', 'مشتری ' || g, 'createdAt', g,
            'txs', (SELECT jsonb_agg(jsonb_build_object('id', 't' || g || '-' || k, 'amount', k, 'at', k)) FROM generate_series(1, 5) k)))
     FROM generate_series(1, 2000) g);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
DO $$
DECLARE t0 timestamptz; s0 bigint; r jsonb; pull jsonb; ms_push numeric; ms_pull numeric; ms_idle numeric;
BEGIN
  SELECT sync_seq INTO s0 FROM public.user_data;
  t0 := clock_timestamp();
  r := public.kamix_sync_push('{"rows":{
     "invoices":[{"id":"inew","createdAt":999999,"total":5,"items":[{"productId":"p7","name":"x","price":1,"quantity":1}]}],
     "products":[{"id":"p7","name":"کالای شماره 7","price":7000,"stock":4,"updatedAt":999999}],
     "customers":[{"id":"c9","firstName":"مشتری 9","createdAt":9,"updatedAt":999999,"txs":[{"id":"tnew","amount":5,"at":999}]}]}}');
  ms_push := extract(epoch FROM clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp();
  pull := public.kamix_sync_pull(s0);
  ms_pull := extract(epoch FROM clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp();
  PERFORM public.kamix_sync_pull((r ->> 'seq')::bigint);
  ms_idle := extract(epoch FROM clock_timestamp() - t0) * 1000;
  PERFORM pg_temp.ok(pg_temp.ids(pull -> 'fields' -> 'invoices' -> 'rows') = 'inew', '11: invoices delta');
  PERFORM pg_temp.ok(pg_temp.ids(pull -> 'fields' -> 'products' -> 'rows') = 'p7', '11: products delta');
  PERFORM pg_temp.ok(jsonb_array_length(pull -> 'fields' -> 'customers' -> 'rows' -> 0 -> 'txs') = 6, '11: customer ledger');
  PERFORM pg_temp.ok((SELECT jsonb_array_length(invoices) FROM public.user_data) = 10001, '11: invoice count');
  PERFORM pg_temp.ok((SELECT invoices -> 0 ->> 'id' FROM public.user_data) = 'inew', '11: new invoice first');
  PERFORM pg_temp.ok(length(pull::text) < 2000, '11: delta is small: ' || length(pull::text));
  RAISE WARNING 'heavy account: push % ms, delta pull % ms (% bytes), idle poll % ms', round(ms_push), round(ms_pull), length(pull::text), round(ms_idle, 2);
  PERFORM pg_temp.ok(ms_push < 6000, '11: push too slow for the 8s statement timeout: ' || ms_push);
END $$;
RESET ROLE;
\echo sync-delta tests passed
