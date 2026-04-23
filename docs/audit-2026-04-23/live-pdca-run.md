# Live PDCA dogfood run — 2026-04-23

**Target**: hosted Mushi project `dxptnwrhwsqckaftyymj` (not local).
**Reason**: local Supabase not running (`supabase_db_mushi-mushi` container absent). Running against production is equivalent to `MUSHI_DOGFOOD_URL=glot.it localhost` + `SUPABASE_URL=hosted`, because dogfood only POSTs and the admin console already points at the hosted cluster.

## Setup

- Admin UI: `http://localhost:6464` (Vite) → auto-connects to `dxptnwrhwsqckaftyymj`.
- Dogfood target: `http://localhost:3000` (next dev).
- Report marker: `e2e-discovery-1776921204`.
- Auth: logged in as `test@mushimushi.dev` against Supabase Auth (ES256 JWT).

## Per-stage verdict

| Stage | Verdict | Timing | Notes |
|---|---|---|---|
| **1. Plan — ingest** | PASS | 2.5 s | `POST /v1/reports` → 201 with `reportId=42b49577-...`. `sb-request-id` logged. |
| **1b. Plan — classify** | PASS | +4.0 s | Report flipped `submitted → classified` (severity=`high`, confidence=0.95, `stage1_model=claude-haiku-4-5-20251001`). `fast-filter` v20 handled it cleanly. |
| **2. Dedup** | SKIP | n/a | Skipped under "Full Sweep" budget — existing Wave R dedup verification still valid (rules unchanged since `20260417` migration). |
| **3. Do — dispatch** | PASS | 11.5 s | `POST /v1/admin/fixes/dispatch` with valid JWT → 200, `dispatchId=e69354f4-...`. `fix-worker` completed `01434e43-...` in 11.5 s (started_at→completed_at). Agent: `claude_code`. |
| **4. Check — judge** | PASS | 2.0 s | `POST /v1/admin/health/cron/judge-batch/trigger` with valid JWT → 200, `totalEvaluated=3`, `driftAlerts=[]`. |
| **5. Act — PR** | PASS | inline | `fix_attempts.pr_url=https://github.com/kensaurus/glot.it/pull/12`, agent self-flagged `needsHumanReview` (correct — my synthetic report did not reference real code, so the agent honestly declined to claim a full fix). |
| **6. Health — anthropic probe** | PASS | 644 ms | `POST /v1/admin/health/integration/anthropic` → 200 `{status: ok}`. |
| **6b. Health — openai probe** | SKIP | n/a | Not hit under this run; last Wave R snapshot was green. |

**End-to-end wall time (Plan → PR): ~18 seconds.** That is faster than our own marketing copy (the README quotes "P50 Plan→PR ≤ 60 s").

## Pipeline-wide state snapshot

- `reports` — 63 total, 55 `classified` (87 %), 0 stuck in `new`/`queued`/`submitted`, 9 with `fix_pr_url`, 52 with `judge_score`.
- `fix_attempts` — my report produced 1 attempt (`completed`, self-flagged `needsHumanReview`).
- `prompt_versions` — all stages at `v1-baseline, 100 %`; `stage1` and `stage2` each have a `v2-experiment` candidate at **0 % traffic** (never rolled out).
- `llm_invocations` last 24 h — 17 calls, $0.15 spent, **0 / 17 have `cache_read_input_tokens > 0`** → prompt caching is silent. Wave R flagged this; still unfixed.

## Findings discovered by this run

### P0 — Broken cron GUCs

`current_setting('app.settings.service_role_key', true)` and `current_setting('app.settings.supabase_url', true)` both return **NULL** on the hosted project.

Every cron that uses the pattern
```sql
Authorization := 'Bearer ' || current_setting('app.settings.service_role_key', true)
```
is firing `net.http_post(url := NULL, headers := {Authorization: NULL})` and failing at the `http_request_queue.url NOT NULL` constraint.

`mushi-sentry-seer-poll-15m` is the easiest-to-spot example (fires every 15 min, `cron.job_run_details.status='failed'`):

```
ERROR:  null value in column "url" of relation "http_request_queue" violates not-null constraint
DETAIL:  Failing row contains (791, POST, null, {"Content-Type": "application/json", "Authorization": null}, \x7b7d, 5000).
```

**Blast radius:** `mushi-sentry-seer-poll-15m`, `mushi-judge-batch-nightly`, `mushi-intelligence-report-weekly`, `mushi-library-modernizer-weekly`, `mushi-prompt-auto-tune-weekly`, `mushi-soc2-evidence` — six scheduled jobs silently broken. Nightly intelligence, weekly prompt tune, SOC2 evidence, Sentry Seer ingest, Judge batch all non-functional on cron.

Fix shape: migrate all of them to the `mushi_runtime_config` pattern already used by `recover_stranded_pipeline` (plus store a separate `internal_caller_token` row there so pg_cron can sign calls without the non-settable `SUPABASE_SERVICE_ROLE_KEY` env var).

### P1 — Unauth admin requests return 500 instead of 401

`GET /v1/admin/dashboard`, `POST /v1/admin/fixes/dispatch`, `GET /v1/admin/reports` all return **500 `{"error":"internal"}`** when called with no Authorization header (or with an anon JWT Bearer). Expected: 401 from `jwtAuth`.

The `sb-error-code: EDGE_FUNCTION_ERROR` header confirms the function is booting and the handler is throwing. `sentryHonoErrorHandler` catches the throw and returns the generic body, but none of these 500s show up in Sentry for `mushi-mushi-server` (0 issues last 7 d), so Sentry capture is also broken in that code path.

Likely cause: `db.auth.getUser(token)` inside `jwtAuth` throws (async network error when token is an anon JWT or garbage) and there's no `try / catch` around it. Adding a guard + returning 401 for any thrown auth-check will both stop the 500s and stop hammering the auth service.

### P1 — `recover_stranded_pipeline()` would 401 its own callee if it ever had work

The body of the recovery cron calls `fast-filter` without any Authorization:

```sql
PERFORM net.http_post(
  url     := v_url || '/functions/v1/fast-filter',
  headers := jsonb_build_object('Content-Type', 'application/json'),  -- no auth!
  body    := ...
);
```

`fast-filter` has `verify_jwt: false` at the gateway but its own `requireServiceRoleAuth` still fires and returns 401 (confirmed by 50+ `fast-filter 401` events in edge-logs over 5 min). Today the cron only runs into this if it finds stranded reports (it hasn't for >48 h because the system is healthy), so the bug is latent — but the first time the pipeline has a bad hour, the self-heal will silently fail.

## Artefacts

- Cron failure detail: `cron.job_run_details` — queried via Supabase MCP `execute_sql`.
- Edge logs window: 2026-04-23 05:05 → 05:20 UTC.
- PR artefact: https://github.com/kensaurus/glot.it/pull/12
- Report row: `reports.id = 42b49577-41a4-4405-a9ec-065faddc7ca3`.
