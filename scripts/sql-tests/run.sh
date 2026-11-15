#!/usr/bin/env bash
# Runs the SQL tests of the delta-sync migration on a THROWAWAY local PostgreSQL.
# Never point this at a real database: it drops and recreates the test databases.
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/sql-tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
M=supabase/migrations
R=supabase/rollbacks
run() { psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$2" >/dev/null; }

for mode in alone full; do
  db="kamix_sync_test_$mode"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null
  run "$db" scripts/sql-tests/bootstrap.sql
  if [ "$mode" = full ]; then
    # the earlier data-safety migrations, in order (as on a fully migrated project)
    run "$db" $M/20261002120000_data_safety_never_lose_rows.sql
    run "$db" $M/20261002120200_sync_realtime_signal.sql
  fi
  run "$db" $M/20261115120000_sync_delta.sql
  run "$db" $M/20261115120000_sync_delta.sql            # idempotent
  run "$db" $R/20261115120000_sync_delta.rollback.sql   # rollback …
  run "$db" $M/20261115120000_sync_delta.sql            # … and re-apply
  echo "── $mode ──"
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f scripts/sql-tests/sync-delta.test.sql
done
