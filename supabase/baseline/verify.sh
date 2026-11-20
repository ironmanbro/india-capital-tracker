#!/usr/bin/env bash
# Builds the baseline into an empty scratch database and checks object counts against the values recorded from production.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/baseline/verify.sh      (needs psql; creates and drops database ict_baseline_check)
set -euo pipefail
cd "$(dirname "$0")"
DB=ict_baseline_check
psql -qv ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
for f in stubs.sql 01_tables.sql 02_views_functions.sql 03_rls_policies.sql 04_cron_jobs.sql; do
  psql -qv ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done
got=$(psql -Atq -d "$DB" -c "select (select count(*) from pg_tables where schemaname='public')||' '||(select count(*) from pg_views where schemaname='public')||' '||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')||' '||(select count(*) from pg_policies where schemaname='public')||' '||(select count(*) from pg_indexes where schemaname='public')")
want="36 11 24 42 69"   # tables views functions policies indexes (production, 2026-11-20)
echo "objects (tables views functions policies indexes): got [$got] want [$want]"
[ "$got" = "$want" ] || { echo "MISMATCH: update the baseline (or the expected counts) deliberately"; exit 1; }
echo "baseline OK"
