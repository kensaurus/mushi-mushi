# @mushi-mushi/server

Backend for Mushi Mushi — Supabase Edge Functions powering the LLM pipeline, knowledge graph, and admin API.

## Architecture

```
supabase/functions/
  api/                       Hono-based REST API (ingest, admin CRUD, graph, NL queries, billing, plugins, SSO, integrations, organizations + invitations under /v1/org and /v1/invitations)
  fast-filter/               Stage 1 — Haiku extracts key facts and a structured evidence object, blocks spam (prompt-cached). **Internal-only** — rejects callers without `MUSHI_INTERNAL_CALLER_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` since 2026-04-21 (SEC-1)
  classify-report/           Stage 2 — Sonnet deep analysis with vision + RAG. AIR-GAPPED: only consumes Stage 1's structured evidence, never raw user strings (prompt-cached). **Internal-only + `airGap=true` required** — any caller omitting the flag gets `400 AIR_GAP_REQUIRED` (SEC-7, belt-and-braces around OWASP LLM01 prompt injection)
  judge-batch/               Nightly LLM quality scoring + prompt A/B auto-promotion
  intelligence-report/       Automated weekly summary generation
  generate-synthetic/        Synthetic test data generator
  stripe-webhooks/ D5 — handles Stripe subscription + invoice events
  usage-aggregator/ D5 — hourly cron pushing usage_events to Stripe Meter Events
  webhooks-github-indexer/   GitHub App webhook → codebase RAG indexer; `?mode=sweep` reindexes all installed repos for cron use
  sentry-seer-poll/          Polls Sentry Seer issues for proactive bug intake. verify_jwt=false — invoked only by pg_cron via Vault-stored token
  fix-worker/                Self-hosted fix-agent runner stub (used for restFixWorker integration tests). **Internal-only** since 2026-04-21 (SEC-1)
  _shared/                   Shared modules (db, auth, schemas, embeddings, notifications, prompt-ab,
                             telemetry, plugins, sanitize, stripe, invoice, quota, byok, region, age-graph,
                             audit, models, fix-schema, ...). `_shared/invoice.ts` exports the canonical
                             `subscriptionIdFromInvoice` helper used by `stripe-webhooks` to walk the
                             Stripe Basil 2025-03-31 `invoice.parent` shape; both production code and
                             `stripe-webhooks.test.ts` import from here so the test can never silently
                             diverge from the shipped resolution logic. `_shared/models.ts` is the single source of truth for
                             model IDs and stage → model defaults (Haiku 4.5 fast-filter, Sonnet 4.6
                             classify/judge/promoter). Opus 4.7 was briefly assigned to judge + promoter on
                             2026-04-22 then reverted on 2026-04-24 — Opus 4.7 dropped sampling knobs and
                             AI SDK v4's `generateObject` forces `tool_choice`, which Anthropic forbids when
                             thinking-mode is on; see SERVER-9 inline comments and
                             `_shared/models.ts#acceptsSamplingKnobs` for the full migration note. Admin UI
                             dropdowns and `project_settings.*_model` defaults read from here.

supabase/templates/          Branded HTML email templates (confirmation, recovery)
supabase/migrations/         PostgreSQL schema + RLS policies. Recent migrations:
                               - **Teams v1** — `organizations` + `organization_members`
                                 above projects, `invitations` table with
                                 `accept_invitation(token)` RPC, plan-gate trigger
                                 that rejects invites on hobby/starter, last-owner
                                 guard, and the `private.*` SECURITY DEFINER helpers
                                 used by org-aware RLS to avoid recursion.
                               - **`20260429000000_sdk_versions`** — `sdk_versions`
                                 catalogue + `reports.sdk_package` / `reports.sdk_version`
                                 columns; powers the SDK identity + outdated-banner flow.
                               - **`20260429001000_report_repro_timeline`** — `reports.repro_timeline`
                                 jsonb column with a partial GIN index for the SDK
                                 timeline payload (`route` / `click` / `screen` events).
                              - **`20260430000000_two_way_reply`** — `report_comments.author_kind`
                                + `report_comments.reporter_token_hash` columns
                                (admin / reporter author union with a CHECK constraint),
                                `reports.last_admin_reply_at` / `last_reporter_reply_at`,
                                partial indexes for reporter history, and the
                                `report_comments_fanout_to_reporter` trigger that
                                emits `reporter_notifications` on visible admin replies.
                              - **`20260430010000_migration_progress` (+ `20260430010001`
                                hardening)** — Migration Hub Phase 2. New
                                `public.migration_progress(user_id, project_id NULL,
                                guide_slug, completed_step_ids text[], …)` table with
                                two partial UNIQUE indexes (account-scoped via
                                `WHERE project_id IS NULL`, project-scoped via
                                `WHERE project_id IS NOT NULL`) so the same row shape
                                supports both "my progress across projects" and
                                "this project's shared migration". RLS reuses the
                                `private.is_project_member` helper from Teams v1
                                (project members read teammate rows; only the owner
                                writes), every policy uses the `(SELECT auth.uid())`
                                initplan pattern, and the hardening migration revokes
                                table-level GRANTs from `anon` + `authenticated` to
                                close `pg_graphql_*_table_exposed` advisor warnings —
                                the only intended caller is the Hono Edge Function
                                running as `service_role`.
```

## Development

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (for local Supabase)

### Local Development

```bash
cd packages/server

# Start local Supabase (Postgres, Auth, Storage, Edge Functions)
pnpm dev:db

# Apply migrations
pnpm db:push

# Deploy functions locally
pnpm dev
```

### Run Tests

```bash
pnpm test                       # Vitest smoke tests for Edge Functions
```

### Deploy to Supabase

```bash
pnpm db:push                    # Run migrations
pnpm deploy                     # Deploy all Edge Functions
```

### Environment Variables

Set these as Supabase secrets:

| Variable                       | Required   | Description                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Yes        | Claude API key for LLM pipeline                                                                                                                                                                                                                                             |
| `OPENAI_API_KEY`               | No         | OpenAI fallback when Anthropic is down                                                                                                                                                                                                                                      |
| `LANGFUSE_SECRET_KEY`          | No         | Langfuse LLM trace logging                                                                                                                                                                                                                                                  |
| `LANGFUSE_PUBLIC_KEY`          | No         | Langfuse LLM trace logging                                                                                                                                                                                                                                                  |
| `STRIPE_SECRET_KEY`            | Cloud      | Stripe server key (apps/cloud billing flow)                                                                                                                                                                                                                                 |
| `STRIPE_WEBHOOK_SECRET`        | Cloud      | Verifies signatures on `stripe-webhooks`                                                                                                                                                                                                                                    |
| `STRIPE_PRICE_ID_REPORTS`      | Cloud      | Metered price ID used by checkout                                                                                                                                                                                                                                           |
| `E2B_API_KEY`                  | No         | Managed sandbox provider for fix agents                                                                                                                                                                                                                                     |
| `MUSHI_REGION`                 | No         | `us` / `eu` / `jp` — data residency tag                                                                                                                                                                                                                                     |
| `MUSHI_INTERNAL_CALLER_SECRET` | Yes (prod) | Shared secret for cross-function + `pg_cron` → edge-function calls. Must also be mirrored into `public.mushi_runtime_config` (`key='service_role_key'`) so `pg_net` can read it from SQL. See [Internal-caller authentication](#internal-caller-authentication-sec-1) below |
| `SUPABASE_URL`                 | Auto       | Set by Supabase runtime                                                                                                                                                                                                                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`    | Auto       | Set by Supabase runtime — auto-injected inside edge functions, not reachable from `pg_net`/`pg_cron`, which is why `MUSHI_INTERNAL_CALLER_SECRET` exists                                                                                                                    |

## API Routes

All routes are served from the `api` function under `/v1/`:

- `POST /v1/reports` — SDK report submission. Returns **HTTP 402** + `{ code: 'QUOTA_EXCEEDED', limit, used }` when the project's free-tier monthly quota is hit (`_shared/quota.ts`); paid plans bypass via Stripe metered billing. Now persists `sdk_package`, `sdk_version`, and `repro_timeline` from the SDK payload so triage can see what shipped and what the user did before the report
- `POST /v1/reports/batch` — Batch report submission (up to 10), same quota gate
- `GET /v1/sdk/latest-version?package=@mushi-mushi/web` — public, unauthenticated. Reads from `public.sdk_versions` and returns `{ package, latest, deprecated, deprecationMessage, releasedAt }` for the SDK's outdated-banner check. CORS allowlist explicitly admits `X-Mushi-Internal` so the SDK's own freshness call doesn't trip self-cascade detection
- `GET /v1/reporter/reports` — HMAC-authed list of the reporter's own reports for the widget's "Your reports" view. Auth is `X-Reporter-Token-Hash` (sha256 of the reporter token) + `X-Reporter-Ts` + `X-Reporter-Hmac` (sha256-hmac of `projectId.ts.tokenHash` keyed by the public API key); no Supabase auth user required. Each row carries `unread_count` derived from `last_admin_reply_at` vs the reporter's last poll
- `GET /v1/reporter/reports/:id/comments` — HMAC-authed comment thread, filtered to `visible_to_reporter = true` admin comments and the reporter's own replies (matched on `reporter_token_hash`)
- `POST /v1/reporter/reports/:id/reply` — HMAC-authed reply endpoint. Inserts into `report_comments` with `author_kind = 'reporter'`; the `report_comments_fanout_to_reporter` trigger flips `reports.last_reporter_reply_at` so the admin list-view can render a "reporter replied" badge
- `GET/PATCH /v1/admin/reports` — Report management. `GET` accepts `status`, `category`, `severity`, `component`, and `reporter` (reporter token hash) query params for filtered/cross-linked views in the admin console. Each returned row carries a `dedup_count` (number of reports sharing the same `report_group_id`) so the admin UI can collapse duplicates into a `+N similar` badge without an N+1 fetch
- `GET /v1/admin/stats` — Dashboard statistics
- `GET /v1/admin/dashboard` — Single-call payload for the admin dashboard. Includes a `pdcaStages` block (one entry per Plan / Do / Check / Act stage with `count`, `tone`, `bottleneck` caption, a `cta` deep-link, **and a 7-day `series: number[]` for sparkline rendering**) plus a `focusStage` field indicating the current bottleneck. Powers the `PdcaCockpit` strip
- `GET /v1/admin/reports/severity-stats` — 14-day severity rollup. Also returns a `byDay: Array<{ day, critical, high, medium, low, total }>` matrix so the FE can render per-tile sparklines without a second round-trip
- `GET /v1/admin/query/history` — Returns `{ ok: true, history: [], degraded: 'schema_pending' }` instead of 500 when the `is_saved` column is missing (`pg_code='42703'`) so the Query page keeps rendering during partial schema deploys
- `GET /v1/admin/judge/evaluations` — Hydrates each row with the underlying report's `summary`, `severity`, and `status` so judge UIs can show human-readable summaries instead of opaque `report_id` hashes
- `GET /v1/admin/graph/*` — Knowledge graph queries
- `POST /v1/admin/query` — Natural language data queries
- `GET/PATCH /v1/admin/settings` — Project configuration
- `GET /v1/admin/billing` — Per-project plan, monthly usage, free-tier quota, `over_quota` flag
- `GET /v1/admin/billing/invoices` — Recent Stripe invoices for the project's customer (`stripe.listInvoices`)
- `POST /v1/admin/billing/checkout` — Start a Stripe Checkout session
- `POST /v1/admin/billing/portal` — Open the Stripe Billing Portal
- `POST /v1/admin/queue/flush-queued` — Force-process reports stuck in `status='queued'` (kicks `fast-filter` for each)
- `GET /v1/admin/repo/overview?project_id=...` — Repo-wide rollup for the admin `/repo` page. Returns `{ repo: { repo_url, default_branch, github_app_installation_id, last_indexed_at }, counts: { open, ci_passing, ci_failed, merged, failed_to_open }, branches: FixAttempt[50] }`. Each branch row carries `id`, `branch`, `pr_url`, `pr_number`, `status`, `check_run_status`, `check_run_conclusion`, `files_changed`, `started_at`, `completed_at`, `report_id`, `report_summary`. RLS mirrors the `fix_attempts` table — requester must be a member of the project
- `GET /v1/admin/repo/activity?project_id=...&limit=100` — Chronological timeline of branch / PR events synthesised from `fix_attempts` (and `fix_events` where available): dispatched → branch created → commit → PR opened → CI resolved → completed / failed. Default limit 100, capped at 500. Same RLS as `/repo/overview`
- `GET | POST | DELETE /v1/admin/integrations[/:type]` — Integration credentials CRUD. `GET` masks secrets; `POST` merges with existing masked values so partial updates don't drop tokens
- `GET | POST /v1/admin/sso`, `DELETE /v1/admin/sso/:id` — SAML provider self-service via Supabase Auth Admin API. Returns ACS URL + Entity ID for IdP setup. OIDC currently writes config and returns a hint pending GoTrue admin OIDC support
- `GET/POST /v1/admin/plugins` — Marketplace registry CRUD
- `POST /v1/admin/ask-mushi/messages` — Ask Mushi single-shot (non-streaming) turn. Accepts `{ threadId?, route, intent?, context?, messages[] }`, returns the assistant reply with LLM telemetry (`model`, `latencyMs`, `inputTokens`, `outputTokens`, `costUsd`). Rate-limited to 300 rq/hr per user via `scoped_rate_limit_claim`
- `POST /v1/admin/ask-mushi/messages/stream` — Ask Mushi SSE streaming variant. Same payload as above, returns `event: start/delta/meta/done/error` over `text/event-stream`. Same 300 rq/hr rate limit
- `GET /v1/admin/ask-mushi/threads` — List conversation threads for the authenticated user. Supports `?route=` filter and `?limit=`/`?offset=` pagination
- `GET /v1/admin/ask-mushi/threads/:id` — Retrieve all messages in a thread
- `DELETE /v1/admin/ask-mushi/threads/:id` — Delete a thread and all its messages (PII purge). Owner-scoped via RLS
- `GET /v1/admin/ask-mushi/mentions?q=...` — Search reports, fixes, and branches for the `@` mention typeahead in the Ask Mushi composer
- `POST /v1/admin/assist` — Back-compat shim that internally transforms the legacy payload and forwards to the `/ask-mushi/messages` handler. Will be removed after one release cycle
- `GET /.well-known/agent-card` — A2A agent card
- `GET /v1/admin/auth/manifest` — RFC 8414-style discovery doc for A2A clients. Lists every advertised endpoint + supported `grant_types`. contract test (`src/__tests__/manifest-contract.test.ts`) asserts every URL listed here is registered as a Hono route, so the manifest can never advertise a 404 again
- `POST /v1/admin/auth/token`— OAuth-style endpoint with two modes: (1) `grant_type=refresh_token` + `refresh_token` body → calls `auth.refreshSession` and returns a fresh access token + expiry, (2) `Authorization: Bearer <jwt>` only → returns RFC 7662-shape `{ active, sub, email }` introspection for an A2A client to validate a token. Without these the manifest was lying to clients
- `POST /v1/admin/projects/:id/keys/rotate`— atomic API key rotation. Revokes every active key for the project (audit-logged with the revoked prefixes), generates a new one, and returns it in the same response (`mushi_<32hex>`, 201). The plaintext is shown exactly once — clients store it immediately or rotate again. Project ownership is enforced via `jwtAuth` + `owner_id` check, so cross-project rotation is impossible
- `GET | PUT | DELETE /v1/admin/migrations/progress[/:guide_slug]` — Migration Hub Phase 2 sync endpoints (`supabase/functions/api/routes/migration-progress.ts`). `GET` returns the caller's account-scoped rows plus any project-scoped rows they can read via `userCanAccessProject`, in one envelope, alongside the catalog's `knownGuideSlugs` so the docs sync hook can locally validate. `PUT /:guide_slug` accepts `{ completed_step_ids[], required_step_count?, completed_required_count?, source?, project_id?, client_updated_at? }`, runs through `migration-progress-helpers.ts > normalizeProgressUpsert` (sort + dedupe step ids, slug + UUID + source validation), and upserts via the partial-unique indexes on `(user_id, guide_slug) WHERE project_id IS NULL` / `(user_id, project_id, guide_slug) WHERE project_id IS NOT NULL`. `DELETE` clears one slug's remote row without touching the docs `localStorage` cache. **CORS exception:** these routes are the only `/v1/admin/*` surface that also accept the docs origin (`apps/docs` → `kensaur.us` / `docs.mushimushi.dev` / `localhost:3000-3001`); the per-route `app.use('/v1/admin/migrations/*', cors({ origin: MIGRATIONS_PROGRESS_ORIGINS, ... }))` block in `index.ts` is registered BEFORE the general `/v1/admin/*` block so Hono's first-match-wins ordering keeps the rest of the admin surface pinned to the admin allowlist. Pure helper logic is unit-tested in `src/__tests__/migration-progress-helpers.test.ts`; the live RLS contract is pinned by `supabase/tests/rls_migration_progress.test.sql`
- See `supabase/functions/api/index.ts` and `supabase/functions/api/routes/*.ts` for the full route table

## Manifest contract test

`src/__tests__/manifest-contract.test.ts` parses
`supabase/functions/api/index.ts` plus route modules, extracts every URL listed inside
`/v1/admin/auth/manifest`, and asserts each one is registered as a Hono
route via `app.<method>(<path>, ...)`. If a future PR adds an entry to the
manifest without wiring up the route — or deletes a route the manifest still
advertises — `pnpm test` fails with the offending URL named in the error.

This was added because static audit found two manifest entries
(`/v1/admin/auth/token`, `/v1/admin/projects/:id/keys/rotate`) that were
advertised but returned 404 in production. The test now blocks that class
of bug before it reaches a deploy.

## Error handling

Every Postgres error returned to the admin API flows through one helper —
`dbError(c, err)` in `supabase/functions/api/shared.ts`. It:

1. Logs to Sentry via `captureException` with `tags = { pg_code, route }` so
   alert filters can split `42703` (undefined column, signals schema drift) from
   `42501` (RLS denial), `23505` (unique violation), etc.
2. Returns a canonical `c.json({ error: 'database_error', code: pg_code, ... }, 500)`
   so the FE always knows the error shape regardless of which endpoint failed.

It replaced ~25 inline `if (error) { console.error(); return c.json(...) }`
sites that previously sidestepped Hono's `app.onError` and never reached
Sentry. **If you add a new admin route, use `return dbError(c, error)` instead
of building the 500 by hand** — otherwise the new route's errors will be
invisible to the on-call dashboard.

### PostgrestBuilder is _not_ a Promise — no `.catch()`

A recurring foot-gun: Supabase's `db.from(...).insert/.upsert/.update/.delete()`
and `db.rpc(...)` return a `PostgrestBuilder`. It is a _thenable_ (`.then` only)
— it does **not** implement `.catch`. Writing

```ts
// BROKEN — throws TypeError at runtime
await db.from('audit_log').insert({...}).catch(() => {})
```

crashes with `TypeError: db.from(...).insert(...).catch is not a function`,
which bubbles to `app.onError` and masks the _preceding_ work as a generic 500.
This silently erased a successful BYOK vault write in Apr 2026
([MUSHI-MUSHI-SERVER-F](https://sakuramoto.sentry.io/issues/MUSHI-MUSHI-SERVER-F)).

**Use `try/await` for fire-and-forget writes:**

```ts
try {
  await db.from('audit_log').insert({...})
} catch { /* best-effort */ }
```

Note: DB-level errors (unique violation, RLS denial) return `{data, error}`
synchronously — they never reject. `.catch()` wouldn't help there either; for
those, branch on `error` explicitly or let `dbError()` handle them.

## Stage 2 air-gap

Stage 2 (`classify-report`) **never receives raw user-supplied strings**. The
contract is enforced at the boundary: `fast-filter` produces a typed
`Stage1Evidence` object — title, normalised symptom buckets, suspected
component, severity hint, list of console-error frames (no payloads), list of
network failures (no bodies), reproducer steps. `classify-report` consumes only
that object plus the screenshot. Raw `description`, `userIntent`, console /
network bodies stay in the DB but never enter Stage 2 prompts. This closes the
prompt-injection / data-exfiltration vector raised in `MushiMushi_Critical_Analysis.md`.

## Internal-caller authentication (SEC-1)

Three internal-only edge functions — `fast-filter`, `classify-report`, and `fix-worker` — previously accepted any caller because Supabase deploys without `--no-verify-jwt` still pass anonymous `anon` requests through. The 2026-04-21 remediation (audit SEC-1) gates them behind a shared middleware in `_shared/auth.ts`:

```ts
import { requireServiceRoleAuth } from '../_shared/auth.ts';

const authErr = requireServiceRoleAuth(req);
if (authErr) return authErr;
```

The middleware accepts **either** token in the `Authorization: Bearer …` header:

1. `MUSHI_INTERNAL_CALLER_SECRET` — a non-reserved shared secret. Used by `pg_cron` → `pg_net.http_post` callers, because Postgres cannot read runtime-injected Supabase env vars. The same value is mirrored into `public.mushi_runtime_config` (row `key='service_role_key'`) so migrations like `recover_stranded_pipeline()` can look it up without a deploy.
2. `SUPABASE_SERVICE_ROLE_KEY` — auto-injected into the edge runtime. Used for function-to-function calls (`api` → `fast-filter`, `fast-filter` → `classify-report`, etc.) without any bespoke plumbing.

Both paths return `401 UNAUTHORIZED` otherwise. `classify-report` _additionally_ requires `body.airGap === true` (SEC-7) so a compromised Stage 1 cannot bypass the air-gap by handing Stage 2 raw user strings.

**To rotate the secret**:

```bash
export NEW_SECRET="$(openssl rand -hex 32)"
supabase secrets set MUSHI_INTERNAL_CALLER_SECRET="$NEW_SECRET" --project-ref <ref>
# Mirror into the DB so pg_cron reads the new value on its next tick.
# mushi_runtime_config is a (key, value) table — update the service_role_key row.
supabase db query --linked <<SQL
UPDATE public.mushi_runtime_config
   SET value = '$NEW_SECRET', updated_at = now()
 WHERE key = 'service_role_key';
SQL
supabase functions deploy fast-filter classify-report fix-worker judge-batch api \
  usage-aggregator soc2-evidence intelligence-report --project-ref <ref>
```

## Security: prompt-injection defense

`_shared/sanitize.ts` exposes `sanitizeForLLM` and `wrapUserContent`. Every
user-supplied string headed for an LLM prompt **must** flow through one of
those before being embedded — they neutralise OWASP LLM01 instruction-hijack
patterns, role-flip mimicry, system-prompt look-alikes, control characters,
and base64-wrapped variants.

The Node-side mirror (`@mushi-mushi/core/injection-defense`) and the full
vitest regression corpus are tracked under follow-up
`waveD-d8-node-mirror`. The Deno module is the source of truth until then.

## LLM Pipeline

### Prompt Caching

All LLM calls use Anthropic's ephemeral prompt caching (`experimental_providerMetadata`) to reduce token costs on repeated system prompts.

### Prompt A/B Testing

The `_shared/prompt-ab.ts` module enables per-project, per-stage prompt experimentation:

1. **Traffic routing** — candidate prompts receive a configurable % of traffic
2. **Score tracking** — `judge-batch` records running-average judge scores per prompt version
3. **Auto-promotion** — candidates that exceed the active prompt's score by >5% after 30+ evaluations are promoted automatically

Stages: `stage1` (fast-filter), `stage2` (classify-report), `judge`.

### Observability

LLM traces are sent to Langfuse via direct REST API calls from `_shared/observability.ts`. Each pipeline stage logs input tokens, output tokens, latency, and model used.

### Telemetry & Realtime

The `_shared/telemetry.ts` module writes best-effort structured events to:

- `llm_invocations` — every LLM call with model, fallback, latency, tokens
- `cron_runs` — scheduled job outcomes (success/error, last run, duration)
- `anti_gaming_events` — multi-account / velocity-anomaly / manual-flag events
- `reporter_notifications` — classified / fixed / reward events surfaced to reporters

Admin pages subscribe to these tables via Supabase Realtime (`apps/admin/src/lib/realtime.ts`) so the `/health`, `/anti-gaming`, and `/notifications` dashboards update live without polling. RLS for these tables is in `migrations/20260417000001_admin_realtime_policies.sql`.

## License

[BSL 1.1](./LICENSE) — converts to Apache 2.0 on April 15, 2029.
