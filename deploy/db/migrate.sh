#!/usr/bin/env bash
# FILE: deploy/db/migrate.sh
# PURPOSE: Apply Mushi Mushi's migrations to a Postgres that already has the
#          Supabase Auth and Storage schemas, then point mushi_runtime_config
#          at this stack instead of Mushi Mushi Cloud.
#
# - Each file runs in one transaction with ON_ERROR_STOP, and is recorded in
#   supabase_migrations.schema_migrations (the ledger `supabase db push` uses),
#   so a re-run applies only new files and the first failure stops the run.
# - Reads libpq env (PGHOST, PGUSER, PGPASSWORD, PGDATABASE), MIGRATIONS_DIR
#   (default /migrations), MUSHI_GATEWAY_URL and MUSHI_INTERNAL_CALLER_SECRET.
#   Secrets are read with \getenv, never put on a command line.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
: "${MUSHI_GATEWAY_URL:?MUSHI_GATEWAY_URL is required}"
: "${MUSHI_INTERNAL_CALLER_SECRET:?MUSHI_INTERNAL_CALLER_SECRET is required}"

psql_() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_ <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

applied="$(psql -X -At -c 'select version from supabase_migrations.schema_migrations')"
count=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if grep -qxF "$version" <<<"$applied"; then continue; fi
  if [[ ! "$base" =~ ^[0-9]+_[A-Za-z0-9_.-]+$ ]]; then
    echo "✗ unexpected migration file name: $base" >&2
    exit 1
  fi
  echo "→ $base"
  # CREATE INDEX CONCURRENTLY cannot run inside a transaction; such a file runs statement by
  # statement (as `supabase db push` does), every other file all-or-nothing.
  tx=--single-transaction
  if grep -qi concurrently "$f"; then tx=; fi
  {
    cat "$f"
    printf "\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" \
      "$version" "$name"
  } | psql_ $tx
  count=$((count + 1))
done
echo "✓ applied $count new migration(s)"

psql_ <<'SQL'
\getenv gateway MUSHI_GATEWAY_URL
\getenv token MUSHI_INTERNAL_CALLER_SECRET
insert into public.mushi_runtime_config (key, value) values
  ('supabase_url', :'gateway'),
  ('service_role_key', :'token'),
  ('internal_caller_token', :'token')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Self-hosted: no billing, so lift the Mushi Mushi Cloud plan limits on every
-- plan (300 diagnoses/month, 3 apps, 1 seat, 30-day retention on Free). Same
-- SQL as SELFHOST_PLAN_SQL in packages/cli/src/commands/selfhost.ts.
update public.pricing_plans set
  included_diagnoses_per_month = null,
  max_projects = null,
  seat_limit = null,
  retention_days = greatest(coalesce(retention_days, 0), 3650),
  feature_flags = coalesce(feature_flags, '{}'::jsonb) || '{"byok": true, "sso": true, "plugins": true, "intelligence_reports": true, "audit_log": true, "self_hosted": true, "teams": true}'::jsonb
where true;
SQL
echo "✓ mushi_runtime_config points at $MUSHI_GATEWAY_URL; plan limits lifted"
