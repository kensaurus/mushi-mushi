# Database Schema Audit — 2026-04-21

**Project:** `dxptnwrhwsqckaftyymj` (Supabase, Postgres 17.6.1.104)
**Method:** Live Supabase MCP (`list_tables`, `get_advisors`, `execute_sql`), migration spot-checks, whitepaper-claim verification, Postgres best-practices cross-check via Firecrawl.
**Inventory:** **60 public tables**, **207 indexes** (2.7 MB), **14 active cron jobs**, RLS enabled on **60/60 (100%)** tables, every table has a primary key. Live row counts indicate the DB is at very early operational stage (max 807 rows in `cron_runs`).

---

## TL;DR — top findings

| ID | Severity | Finding | Quick fix |
|----|----------|---------|-----------|
| **DB-1** | **P1** | **20 unindexed foreign keys** flagged by Supabase advisors. Every FK without an index forces a sequential scan on parent delete/update and degrades JOIN plans. | Generate `CREATE INDEX CONCURRENTLY` for each FK; ship as a single migration. |
| **DB-2** | **P1** | **64 "multiple permissive policies"** lints. The same role+action gets evaluated against several `PERMISSIVE` policies on a single statement — every one runs, every time. The hot tables are `byok_audit_log`, `usage_events`, `processing_queue`. | Consolidate into one PERMISSIVE policy per (role, action) and use RESTRICTIVE for the deny rules. |
| **DB-3** | **P2** | **62 unused indexes**. Some are dead weight from earlier migrations (e.g. `processing_queue_idx_queue_project`). DB is small now so cost is invisible, but every index slows down writes. | Drop indexes after 7 days of zero `idx_scan` (use `pg_stat_user_indexes`). |
| **DB-4** | **P2** | `pg_net` extension lives in the **`public` schema** (advisor WARN). Best practice is to install it in `extensions` so its functions don't pollute `public.*`. | Move via Supabase dashboard → Database → Extensions. |
| **DB-5** | **P2** | Auth advisors flag **`auth_leaked_password_protection`** disabled and **`auth_insufficient_mfa_options`** (only one MFA factor). | Enable HIBP password protection and add TOTP+WebAuthn in the Supabase Auth settings. |
| **DB-6** | **P2** | **Apache AGE is NOT installed** despite the Critical Analysis recommending it for the knowledge graph. The `graph_nodes` table currently holds 27 rows in plain Postgres — fine for now, but the whitepaper "graph" claim is delivered by an in-table representation, not a true graph DB. | Document the as-built reality; reassess at >100 k nodes. |
| **DB-7** | ✅ | **Whitepaper claim verified:** `llm_invocations` exists with `cost_usd`, `langfuse_trace_id`, `primary_model`, `used_model`, `latency_ms`, `input_tokens`, `output_tokens`. 84 rows, 83 status=success. Trace coverage: **54/84 (64%)** — see Langfuse audit. | — |
| **DB-8** | ✅ | All 60 public tables have RLS enabled and a primary key. Zero `TIMESTAMP WITHOUT TIME ZONE` columns. | — |

---

## 1. Topology

| Category | Count | Notes |
|----------|------:|-------|
| Public tables | 60 | All RLS-enabled, all with PK |
| Indexes | 207 | 2.7 MB total |
| Views | 2 | `fix_coordination_summary`, `plugin_marketplace` (both owned by `postgres`) |
| Active cron jobs | 14 | incl. `mushi-judge-batch-nightly`, `mushi-intelligence-report-weekly`, `mushi-data-retention-daily`, `mushi-sentry-seer-poll-15m` |
| Extensions | 9 | `pg_cron`, `pg_graphql`, `pg_net` (in `public` ⚠), `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`, `vector` |
| Migrations | 130+ | latest `20260420000200`, ordered, no gaps spot-checked |
| Apache AGE | **not installed** | Knowledge graph is implemented in plain tables (`graph_nodes`, `graph_edges`-style relations) |

Top 5 tables by row count:
1. `cron_runs` — 807 rows / 368 kB
2. `llm_invocations` — 84 rows / 184 kB
3. `byok_audit_log` — 69 rows / 48 kB
4. `reporter_notifications` — 56 rows / 128 kB
5. `reports` — 52 rows / 504 kB ← biggest per-row size, holds full JSON evidence

**Important caveat:** the database is at **dev/early-pilot scale**. Performance findings here cover schema *shape*, not measured query latency on production data volumes.

## 2. Supabase advisors — full breakdown

`get_advisors` returned **147 lints**. By category:

| Lint | Count | Severity | Notes |
|------|------:|----------|-------|
| Multiple Permissive Policies | **64** | WARN | DB-2 |
| Unused Index | **62** | INFO | DB-3 |
| Unindexed Foreign Key | **20** | INFO | DB-1 |
| Extension In Public Schema | **1** | WARN | `pg_net` — DB-4 |
| Auth: Leaked Password Protection | 1 | WARN | DB-5 |
| Auth: Insufficient MFA Options | 1 | WARN | DB-5 |

### DB-1 — 20 unindexed foreign keys (sample)

`byok_audit_log_actor_user_id_fkey`, `byok_keys_user_id_fkey`, `processing_queue_project_id_fkey`, `reports_project_id_fkey` (verify), `classification_evaluations_report_id_fkey`, `notifications_recipient_user_id_fkey`, `fix_coordinations_report_id_fkey`, etc.

Generate-and-apply pattern:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS byok_audit_log_actor_user_id_idx
  ON byok_audit_log(actor_user_id);
-- repeat for each
```

### DB-2 — 64 multiple-permissive-policies

Hot example: `byok_audit_log` has both `byok_audit_log_authenticated_SELECT` and `byok_audit_log_service_role_ALL` as PERMISSIVE for `authenticated` SELECT — both evaluate on every read. The pattern across the codebase is to write one policy per role *and* per access path, which compounds.

**Fix pattern:** keep a single PERMISSIVE policy for the read path and demote everything else to RESTRICTIVE. Postgres evaluates RESTRICTIVE as `AND` and PERMISSIVE as `OR`.

### DB-3 — 62 unused indexes

These are indexes Postgres has never used since stats were last reset. Examples: `processing_queue_idx_queue_project`, `byok_audit_log_idx_target_project`, `notifications_idx_user_unread`. At dev scale they cost nothing; at production scale they slow every INSERT/UPDATE on those tables. Establish a **drop-after-30-days-of-zero-idx_scan** policy.

## 3. Whitepaper-claim verification

| Claim | Verdict | Evidence |
|-------|:------:|----------|
| `llm_invocations` table exists with cost, model, latency, tokens | ✅ | live `\d+ llm_invocations` |
| `langfuse_trace_id` is captured | ✅ partial | 54/84 rows populated (64% coverage; see Langfuse audit) |
| `classification_evaluations` carries judge scores | ✅ | 42 scored rows, avg_score 0.719 |
| `nl_query_history.is_saved` exists | ✅ | column present |
| Knowledge graph backed by Apache AGE | ❌ | not installed; using plain tables |
| `pgvector` for embeddings | ✅ | `vector` extension installed |
| `pg_cron` for scheduled jobs | ✅ | 14 active jobs |
| Stripe idempotency table `stripe_processed_events` | ✅ | exists, used by `stripe-webhooks` |

## 4. Recent migration spot-checks

Last 12 migrations (newest first): `20260420000200`, `20260420000100`, `20260420000000`, `20260419000200`, `20260419000100`, `20260419000000`, `20260418010000`, `20260418005900`, `20260418005800`, `20260418005700`, `20260418005600`, `20260418005500`. Naming convention is `YYYYMMDDHHMMSS` and the chronology is monotonic — no gaps or out-of-order entries. Migration cadence is healthy (~1–3 per day in the recent window, indicating active dev).

## 5. Cron jobs (active)

14 jobs are scheduled. Notables:
- `mushi-judge-batch-nightly` — runs the judge over the previous day's classifications
- `mushi-intelligence-report-weekly` — generates the modernization findings the FE renders on `/intelligence`
- `mushi-data-retention-daily` — supports the SOC2/Compliance posture
- `mushi-sentry-seer-poll-15m` — drives the Sentry-Seer enrichment loop
- `mushi-anti-gaming-evaluator-hourly`, `mushi-finetune-runner-hourly`, etc.

Jobs are tracked in `cron_runs` (807 rows). Recommendation: add an alert in Sentry for any cron run that exits non-zero — currently the table records it but nothing pages.

## 6. Schema design quality

- **Naming:** `snake_case` consistently; FK columns are `<other>_id`. ✅
- **Time columns:** all `TIMESTAMPTZ`. ✅
- **JSON:** `reports` and `processing_queue` use `jsonb`. ✅
- **PII:** `reports.user_intent`, `reports.console_logs`, `reports.network_logs` are scrubbed by `_shared/pii-scrubber.ts` before persistence (verified in `classify-report/index.ts:92`). ✅

## 7. Postgres best-practices cross-check (Firecrawl 2026)

- **Connection pooling:** Supabase Edge Functions use Supavisor by default — ✅.
- **`vacuum`/autovacuum:** default Supabase settings; OK at this scale.
- **Partitioning:** none used. `cron_runs`, `audit_logs`, and `usage_events` are candidates once they hit ~10 M rows.
- **`pg_stat_statements`:** enabled — ✅. Top-by-mean-time queries today are system queries (Supabase introspection, etc.), so no production hotspots are visible yet.

---

## Priority recommendations

1. **(P1)** Ship one migration adding the 20 missing FK indexes via `CREATE INDEX CONCURRENTLY`.
2. **(P1)** Consolidate RLS on `byok_audit_log`, `usage_events`, `processing_queue` to a single PERMISSIVE per (role, action) and use RESTRICTIVE for deny logic.
3. **(P2)** Move `pg_net` from `public` to `extensions` schema.
4. **(P2)** Enable Auth leaked-password protection and a second MFA factor.
5. **(P2)** Implement an "unused index sweeper" cron job that nominates indexes for drop after 30 days of `idx_scan = 0` (with a manual gate).
6. **(P2)** Document explicitly that the "knowledge graph" is implemented in plain Postgres tables, not Apache AGE — to keep the whitepaper honest. Reassess at >100 k nodes.
