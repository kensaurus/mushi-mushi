#!/bin/sh
# Apply Mushi Mushi's database migrations to a self-hosted Supabase database,
# then point the database's own jobs (pg_cron, pg_net) at this install.
#
# Runs once per `docker compose up` (the `mushi-migrate` service) and exits.
# Applied versions are recorded in supabase_migrations.schema_migrations, the
# table the Supabase CLI uses, so `supabase db push` and this runner agree.
#
# Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (libpq),
#      MUSHI_FUNCTIONS_URL   base URL the database calls functions on
#                            (default http://api-gw:8000, the internal gateway)
#      MUSHI_INTERNAL_CALLER_SECRET  shared with the functions container
#      MUSHI_PLAN_LIMITS     "off" (default) lifts the hosted plan caps
set -eu

: "${MUSHI_INTERNAL_CALLER_SECRET:?set MUSHI_INTERNAL_CALLER_SECRET (install.sh generates it)}"
MUSHI_FUNCTIONS_URL=${MUSHI_FUNCTIONS_URL:-http://api-gw:8000}
MUSHI_PLAN_LIMITS=${MUSHI_PLAN_LIMITS:-off}
export PGOPTIONS="-c client_min_messages=warning"

q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
val() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }

until pg_isready -q; do echo "waiting for the database"; sleep 2; done
# Auth and Storage create their schemas on first start; the migrations use them.
for t in auth.users storage.buckets; do
  until [ "$(val "select to_regclass('$t') is not null")" = t ]; do echo "waiting for $t"; sleep 2; done
done

q -c "create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"

if [ "$(val 'select count(*) from supabase_migrations.schema_migrations')" = 0 ]; then
  echo "fresh database: adding the objects the migrations expect"
  q -f /mushi/sql/00-hosted-compat.sql
fi

total=0
applied=0
for f in $(ls /mushi/migrations/*.sql | sort); do
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  total=$((total + 1))
  [ "$(val "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = 1 ] && continue
  echo "applying $base"
  # CREATE INDEX CONCURRENTLY cannot run in a transaction; everything else
  # applies all-or-nothing.
  if grep -qi 'concurrently' "$f"; then q -f "$f"; else q -1 -f "$f"; fi
  q -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  applied=$((applied + 1))
done
echo "migrations: $applied applied, $total in total"

q -v functions_url="$MUSHI_FUNCTIONS_URL" -v secret="$MUSHI_INTERNAL_CALLER_SECRET" \
  -v plan_limits="$MUSHI_PLAN_LIMITS" -f /mushi/sql/90-selfhost-config.sql
echo "self-host settings written; done"
