#!/usr/bin/env bash
# آزمون سرتاسری همگام‌سازی روی PostgreSQL + PostgREST محلیِ یک‌بارمصرف.
# هرگز روی دیتابیس واقعی اجرا نشود: دیتابیس آزمایشی را حذف و از نو می‌سازد.
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres POSTGREST=/path/to/postgrest scripts/e2e/run-real-server.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
M=supabase/migrations
POSTGREST=${POSTGREST:-postgrest}
SECRET=kamix-local-test-secret-kamix-local-test-secret
U=00000000-0000-0000-0000-0000000000e2
DB=kamix_sync_e2e
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" >/dev/null 2>&1; }

# delta: همهٔ مهاجرت‌ها · legacy: بدون مهاجرت 20261115 · legacy-blind: بدون هیچ تریگری
for mode in delta legacy legacy-blind; do
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
  run scripts/sql-tests/bootstrap.sql
  if [ "$mode" != legacy-blind ]; then
    run $M/20261002120000_data_safety_never_lose_rows.sql
    run $M/20261002120200_sync_realtime_signal.sql
  fi
  if [ "$mode" = delta ]; then run $M/20261115120000_sync_delta.sql; fi
  psql -v ON_ERROR_STOP=1 -q -d "$DB" >/dev/null <<SQL
INSERT INTO auth.users VALUES ('$U');
INSERT INTO public.user_data (user_id, products, customers, settings)
SELECT '$U',
  (SELECT jsonb_agg(jsonb_build_object('id', 'p-' || g, 'name', 'کالای شماره ' || g,
          'price', 1000, 'category', '', 'code', '', 'stock', 5))
     FROM generate_series(1, 300) g),
  '[{"id":"c1","firstName":"رضا","createdAt":1,"txs":[{"id":"t0","type":"debt","amount":1000,"at":1}]}]'::jsonb,
  '{"shopName":"فروشگاه"}'::jsonb;
SQL
  conf=$(mktemp)
  cat > "$conf" <<CONF
db-uri = "postgres://${PGUSER:-postgres}@/$DB?host=${PGHOST:-/tmp}&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 54330
CONF
  "$POSTGREST" "$conf" >/dev/null 2>&1 &
  pid=$!
  trap 'kill $pid 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null http://127.0.0.1:54330/; then break; fi
    sleep 0.2
  done
  status=0
  E2E_MODE=$mode E2E_JWT_SECRET=$SECRET E2E_USER_ID=$U \
    npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/sync-real-server.ts 2>&1 \
    | grep -v "^\[store\]\|^\[realtime\|MaxListeners\|trace-warnings" || status=$?
  kill $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
  rm -f "$conf"
  if [ "${PIPESTATUS[0]:-0}" != 0 ] || [ $status != 0 ]; then exit 1; fi
done
