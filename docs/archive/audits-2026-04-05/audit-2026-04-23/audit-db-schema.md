# Database schema audit — 2026-04-23

**Project**: `dxptnwrhwsqckaftyymj` (hosted Supabase, US region).
**Method**: Supabase MCP `list_tables`, `get_advisors(security|performance)`, direct SQL via `execute_sql`.
**Prior baseline**: `docs/audit-2026-04-21/audit-db-schema.md` (Wave R found 20 unindexed FKs and 1 unconfigured `app.settings.*` GUC).

## Executive summary

| Check | Verdict | Evidence |
|---|---|---|
| RLS on every public table | PASS | 62 / 62 tables with `rowsecurity=t`, 0 with `policies=0` |
| Unindexed foreign keys | PASS | 0 (Wave R's `20260420000000_blast_radius_indexes.sql` closed all 20) |
| Naming conventions (snake_case, `*_id` on FKs) | PASS | Spot-checked 62 tables, consistent |
| Canonical timestamps (`created_at` / `updated_at`) | PARTIAL | `created_at` missing on 13 tables (mostly aggregates / junctions); `updated_at` missing on 23 (same class) |
| Idempotency in migrations | PARTIAL | 58 files — most use `IF NOT EXISTS`, some `CREATE POLICY` still lacks the `DO $$ … EXISTS` guard |
| Security advisors (Supabase) | 3 WARN | See below |
| Performance advisors (Supabase) | 149 hints | 83 unused indexes (expected on fresh tables), 64 multiple-permissive-policies, 1 auth RLS initplan, 1 auth connection-strategy |
| **P0 — runtime config GUC** | **FAIL** | `current_setting('app.settings.service_role_key')` **NULL** on hosted project |

## P0: `app.settings.*` GUCs are unset

This is the headline finding. Six cron jobs take the form:

```sql
SELECT net.http_post(
  url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/<fn>',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
  ),
  body    := '{}'::jsonb
);
```

Both `app.settings.supabase_url` and `app.settings.service_role_key` return **NULL** on this project. That produces `net.http_post(null, { Authorization: "Bearer null" }, ...)` which violates `http_request_queue.url NOT NULL`. Failing jobs per `cron.job_run_details.status='failed'`:

- `mushi-sentry-seer-poll-15m` — every 15 min, fails every time
- `mushi-judge-batch-nightly`
- `mushi-intelligence-report-weekly`
- `mushi-library-modernizer-weekly`
- `mushi-prompt-auto-tune-weekly`
- `mushi-soc2-evidence`

Why the GUC is absent: Supabase hosted tier only lets platform admins set `app.settings.*` via `ALTER DATABASE`, and our `supabase db push` role does not own the cluster. The `mushi_runtime_config` table pattern (Wave M, `20260418005900`) was introduced precisely to sidestep this — but only `recover_stranded_pipeline()` actually uses it. The other six crons never got migrated.

**Fix**: one migration that (a) upserts `supabase_url` + `internal_caller_token` into `mushi_runtime_config`, (b) rewrites the six `cron.schedule(...)` commands to read from that table. `internal_caller_token` hits `requireServiceRoleAuth`'s `MUSHI_INTERNAL_CALLER_SECRET` path, bypassing the `SUPABASE_SERVICE_ROLE_KEY` env-var problem.

## Table counts and coverage

| Category | Count |
|---|---|
| Public tables | 62 |
| RLS enabled | 62 (100 %) |
| Tables with >= 1 policy | 62 (100 %) |
| Tables with `id` PK column | 52 |
| Tables missing `id` | 10 (all expected: `mushi_runtime_config`, aggregation MVs, junction tables) |
| Tables missing `created_at` | 13 |
| Tables missing `updated_at` | 23 |

## Security advisors (Supabase linter)

| Level | Lint | Table / Entity | Action |
|---|---|---|---|
| WARN | `extension_in_public` | `pg_net` | Move to `extensions` schema via `ALTER EXTENSION pg_net SET SCHEMA extensions` (must coordinate with all `net.http_post` callers — schema-qualify them) |
| WARN | `auth_leaked_password_protection` | Auth | Enable HaveIBeenPwned check in Supabase dashboard → Auth → Password Security |
| WARN | `auth_insufficient_mfa_options` | Auth | Enable TOTP + WebAuthn |

No ERRORs. No RLS gaps.

## Performance advisors (condensed)

| Lint | Count | Triage |
|---|---|---|
| `unused_index` | 83 | INFO only — most are new indexes from Wave Q/R on tables that have seen < 100 rows in production. Keep; will amortise as prod volume grows. |
| `multiple_permissive_policies` | 64 | WARN — pattern is "service_role policy + authenticated member policy for the same action". Best practice is to merge into one `FOR ALL TO {service_role, authenticated}` with an `OR`-combined `USING`. Queued for Phase 2 clean-up PR. |
| `auth_rls_initplan` | 1 | `fix_events.fix_events_owner_select` re-evaluates `auth.uid()` per row. One-line fix: wrap in `(select auth.uid())`. |
| `auth_db_connections_absolute` | 1 | INFO — auth server capped to 10 DB connections (absolute). Move to percentage mode once project leaves free tier. |

## Migration hygiene

- 58 migrations total. Spot-checked 10 most recent: all use `IF NOT EXISTS` for `CREATE TABLE/INDEX/FUNCTION`. `CREATE POLICY` is guarded with `DO $$ IF NOT EXISTS $$` in recent ones; three older ones (pre-`20260415`) still re-create the same policy on re-apply and will `SQLSTATE 42710` — fine in practice because migrations aren't re-run, but should be hardened during the Phase 2 sweep.
- No `DROP COLUMN` / `ALTER COLUMN TYPE` in the last 30 migrations → zero-downtime-safe.

## Wave R carry-over

| Wave R finding | State today |
|---|---|
| 20 unindexed FKs | CLOSED (`20260420000000_blast_radius_indexes.sql`) |
| Synthetic prompt hardcoded | OPEN (`generate-synthetic` still hardcodes; Phase 4 of Wave T will wire it to `prompt_versions`) |
| `recover_stranded_pipeline` hot in pg_stat_statements | CLOSED (now runs every 5 min, averages 0 rows affected, <1 s) |

## Recommended Phase 2 deliverable

One migration: `packages/server/supabase/migrations/20260423040000_wave_t_runtime_config_and_rls_initplan.sql`:

1. Upsert `supabase_url` (already present), `internal_caller_token` (new) into `mushi_runtime_config`.
2. Unschedule + re-schedule `mushi-sentry-seer-poll-15m`, `mushi-judge-batch-nightly`, `mushi-intelligence-report-weekly`, `mushi-library-modernizer-weekly`, `mushi-prompt-auto-tune-weekly`, `mushi-soc2-evidence` using `SELECT value FROM mushi_runtime_config WHERE key = …` instead of `current_setting`.
3. Replace `recover_stranded_pipeline`'s `net.http_post` to include `Authorization: Bearer <internal_caller_token>` so fast-filter's `requireServiceRoleAuth` accepts the call.
4. Drop + recreate `fix_events_owner_select` with `(select auth.uid())`.
