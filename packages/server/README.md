# @mushi-mushi/server

Backend for Mushi Mushi — Supabase Edge Functions powering the LLM pipeline, knowledge graph, and admin API.

## Architecture

```
supabase/functions/
  api/              Hono-based REST API (ingest, admin CRUD, graph, NL queries)
  fast-filter/      Stage 1 — Haiku extracts key facts, blocks spam (prompt-cached)
  classify-report/  Stage 2 — Sonnet deep analysis with vision + RAG (prompt-cached)
  judge-batch/      Nightly LLM quality scoring + prompt A/B auto-promotion
  intelligence-report/  Automated weekly summary generation
  generate-synthetic/   Synthetic test data generator
  _shared/          Shared modules (DB, auth, schemas, embeddings, notifications, prompt-ab, telemetry)

supabase/templates/   Branded HTML email templates (confirmation, recovery)
supabase/migrations/    PostgreSQL schema + RLS policies
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
| `SUPABASE_URL` | Auto | Set by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Set by Supabase runtime |

## API Routes

All routes are served from the `api` function under `/v1/`:

- `POST /v1/reports` — SDK report submission
- `POST /v1/reports/batch` — Batch report submission (up to 10)
- `GET/PATCH /v1/admin/reports` — Report management
- `GET /v1/admin/stats` — Dashboard statistics
- `GET /v1/admin/graph/*` — Knowledge graph queries
- `POST /v1/admin/query` — Natural language data queries
- `GET/PATCH /v1/admin/settings` — Project configuration
- See `supabase/functions/api/index.ts` for the full route table

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
