# @mushi-mushi/server

Backend for Mushi Mushi — Supabase Edge Functions powering the LLM pipeline, knowledge graph, and admin API.

## Architecture

```
supabase/functions/
  api/                  Hono-based REST API (ingest, admin CRUD, graph, NL queries, billing, plugins)
  fast-filter/          Stage 1 — Haiku extracts key facts, blocks spam (prompt-cached)
  classify-report/      Stage 2 — Sonnet deep analysis with vision + RAG (prompt-cached)
  judge-batch/          Nightly LLM quality scoring + prompt A/B auto-promotion
  intelligence-report/  Automated weekly summary generation
  generate-synthetic/   Synthetic test data generator
  stripe-webhooks/      Wave D D5 — handles Stripe subscription + invoice events
  usage-aggregator/     Wave D D5 — hourly cron pushing usage_events to Stripe Meter Events
  _shared/              Shared modules (db, auth, schemas, embeddings, notifications, prompt-ab,
                        telemetry, plugins, sanitize, stripe, byok, region, age-graph, ...)

supabase/templates/     Branded HTML email templates (confirmation, recovery)
supabase/migrations/    PostgreSQL schema + RLS policies (latest: billing, multi_repo_fixes)
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

- `POST /v1/reports` — SDK report submission
- `POST /v1/reports/batch` — Batch report submission (up to 10)
- `GET/PATCH /v1/admin/reports` — Report management. `GET` accepts `status`, `category`, `severity`, `component`, and `reporter` (reporter token hash) query params for filtered/cross-linked views in the admin console
- `GET /v1/admin/stats` — Dashboard statistics
- `GET /v1/admin/graph/*` — Knowledge graph queries
- `POST /v1/admin/query` — Natural language data queries
- `GET/PATCH /v1/admin/settings` — Project configuration
- `GET /v1/admin/billing` — Current customer + subscription + recent usage (Wave D D5)
- `POST /v1/admin/billing/checkout` — Start a Stripe Checkout session (Wave D D5)
- `POST /v1/admin/billing/portal` — Open the Stripe Billing Portal (Wave D D5)
- `GET/POST /v1/admin/plugins` — Marketplace registry CRUD (Wave D D1)
- `GET /.well-known/agent-card` — A2A agent card (Wave C C5)
- See `supabase/functions/api/index.ts` for the full route table

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
