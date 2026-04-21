# @mushi-mushi/server

Backend for Mushi Mushi — Supabase Edge Functions powering the LLM pipeline, knowledge graph, and admin API.

## Architecture

```
supabase/functions/
  api/                       Hono-based REST API (ingest, admin CRUD, graph, NL queries, billing, plugins, SSO, integrations)
  fast-filter/               Stage 1 — Haiku extracts key facts and a structured evidence object, blocks spam (prompt-cached)
  classify-report/           Stage 2 — Sonnet deep analysis with vision + RAG. AIR-GAPPED: only consumes Stage 1's structured evidence, never raw user strings (prompt-cached)
  judge-batch/               Nightly LLM quality scoring + prompt A/B auto-promotion
  intelligence-report/       Automated weekly summary generation
  generate-synthetic/        Synthetic test data generator
  stripe-webhooks/           Wave D D5 — handles Stripe subscription + invoice events
  usage-aggregator/          Wave D D5 — hourly cron pushing usage_events to Stripe Meter Events
  webhooks-github-indexer/   GitHub App webhook → codebase RAG indexer; `?mode=sweep` reindexes all installed repos for cron use
  sentry-seer-poll/          Polls Sentry Seer issues for proactive bug intake. verify_jwt=false — invoked only by pg_cron via Vault-stored token
  fix-worker/                Self-hosted fix-agent runner stub (used for restFixWorker integration tests)
  _shared/                   Shared modules (db, auth, schemas, embeddings, notifications, prompt-ab,
                             telemetry, plugins, sanitize, stripe, quota, byok, region, age-graph, audit, ...)

supabase/templates/          Branded HTML email templates (confirmation, recovery)
supabase/migrations/         PostgreSQL schema + RLS policies (latest: SSO state, plugin marketplace alias view security_invoker, search_path hardening)
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

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for LLM pipeline |
| `OPENAI_API_KEY` | No | OpenAI fallback when Anthropic is down |
| `LANGFUSE_SECRET_KEY` | No | Langfuse LLM trace logging |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse LLM trace logging |
| `STRIPE_SECRET_KEY` | Cloud | Stripe server key (apps/cloud billing flow) |
| `STRIPE_WEBHOOK_SECRET` | Cloud | Verifies signatures on `stripe-webhooks` |
| `STRIPE_PRICE_ID_REPORTS` | Cloud | Metered price ID used by checkout |
| `E2B_API_KEY` | No | Managed sandbox provider for fix agents |
| `MUSHI_REGION` | No | `us` / `eu` / `jp` — data residency tag |
| `SUPABASE_URL` | Auto | Set by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Set by Supabase runtime |

## API Routes

All routes are served from the `api` function under `/v1/`:

- `POST /v1/reports` — SDK report submission. Returns **HTTP 402** + `{ code: 'QUOTA_EXCEEDED', limit, used }` when the project's free-tier monthly quota is hit (`_shared/quota.ts`); paid plans bypass via Stripe metered billing
- `POST /v1/reports/batch` — Batch report submission (up to 10), same quota gate
- `GET/PATCH /v1/admin/reports` — Report management. `GET` accepts `status`, `category`, `severity`, `component`, and `reporter` (reporter token hash) query params for filtered/cross-linked views in the admin console. Each returned row carries a `dedup_count` (number of reports sharing the same `report_group_id`) so the admin UI can collapse duplicates into a `+N similar` badge without an N+1 fetch
- `GET /v1/admin/stats` — Dashboard statistics
- `GET /v1/admin/dashboard` — Single-call payload for the admin dashboard. Includes a `pdcaStages` block (one entry per Plan / Do / Check / Act stage with `count`, `tone`, `bottleneck` caption, a `cta` deep-link, **and a 7-day `series: number[]` for sparkline rendering — Wave L**) plus a `focusStage` field indicating the current bottleneck. Powers the `PdcaCockpit` strip
- `GET /v1/admin/reports/severity-stats` — 14-day severity rollup. **Wave L:** also returns a `byDay: Array<{ day, critical, high, medium, low, total }>` matrix so the FE can render per-tile sparklines without a second round-trip
- `GET /v1/admin/query/history` — Returns `{ ok: true, history: [], degraded: 'schema_pending' }` instead of 500 when the `is_saved` column is missing (`pg_code='42703'`) so the Query page keeps rendering during partial schema deploys (Wave L)
- `GET /v1/admin/judge/evaluations` — Hydrates each row with the underlying report's `summary`, `severity`, and `status` so judge UIs can show human-readable summaries instead of opaque `report_id` hashes
- `GET /v1/admin/graph/*` — Knowledge graph queries
- `POST /v1/admin/query` — Natural language data queries
- `GET/PATCH /v1/admin/settings` — Project configuration
- `GET /v1/admin/billing` — Per-project plan, monthly usage, free-tier quota, `over_quota` flag
- `GET /v1/admin/billing/invoices` — Recent Stripe invoices for the project's customer (`stripe.listInvoices`)
- `POST /v1/admin/billing/checkout` — Start a Stripe Checkout session
- `POST /v1/admin/billing/portal` — Open the Stripe Billing Portal
- `POST /v1/admin/queue/flush-queued` — Force-process reports stuck in `status='queued'` (kicks `fast-filter` for each)
- `GET | POST | DELETE /v1/admin/integrations[/:type]` — Integration credentials CRUD. `GET` masks secrets; `POST` merges with existing masked values so partial updates don't drop tokens
- `GET | POST /v1/admin/sso`, `DELETE /v1/admin/sso/:id` — SAML provider self-service via Supabase Auth Admin API. Returns ACS URL + Entity ID for IdP setup. OIDC currently writes config and returns a hint pending GoTrue admin OIDC support
- `GET/POST /v1/admin/plugins` — Marketplace registry CRUD (Wave D D1)
- `GET /.well-known/agent-card` — A2A agent card (Wave C C5)
- See `supabase/functions/api/index.ts` for the full route table

## Error handling (Wave L)

Every Postgres error returned to the admin API flows through one helper —
`dbError(c, err)` in `supabase/functions/api/index.ts`. It:

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

## Stage 2 air-gap (Wave D — 2026-04-18)

Stage 2 (`classify-report`) **never receives raw user-supplied strings**. The
contract is enforced at the boundary: `fast-filter` produces a typed
`Stage1Evidence` object — title, normalised symptom buckets, suspected
component, severity hint, list of console-error frames (no payloads), list of
network failures (no bodies), reproducer steps. `classify-report` consumes only
that object plus the screenshot. Raw `description`, `userIntent`, console /
network bodies stay in the DB but never enter Stage 2 prompts. This closes the
prompt-injection / data-exfiltration vector raised in `MushiMushi_Critical_Analysis.md`.

## Security: prompt-injection defense (Wave D D8)

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
