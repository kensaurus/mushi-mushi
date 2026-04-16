# @mushi-mushi/server

Backend for Mushi Mushi — Supabase Edge Functions powering the LLM pipeline, knowledge graph, and admin API.

## Architecture

```
supabase/functions/
  api/              Hono-based REST API (ingest, admin CRUD, graph, NL queries)
  fast-filter/      Stage 1 — Haiku extracts key facts, blocks spam
  classify-report/  Stage 2 — Sonnet deep analysis with vision + RAG
  judge-batch/      Weekly LLM quality scoring
  intelligence-report/  Automated weekly summary generation
  generate-synthetic/   Synthetic test data generator
  _shared/          Shared modules (DB, auth, schemas, embeddings, notifications)

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
| `SUPABASE_URL` | Auto | Set by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Set by Supabase runtime |

## API Routes

All routes are served from the `api` function under `/v1/`:

- `POST /v1/ingest` — SDK report submission
- `GET/PATCH /v1/admin/reports` — Report management
- `GET /v1/admin/stats` — Dashboard statistics
- `GET /v1/admin/graph/*` — Knowledge graph queries
- `POST /v1/admin/query` — Natural language data queries
- `GET/PATCH /v1/admin/settings` — Project configuration
- See `supabase/functions/api/index.ts` for the full route table

## License

[BSL 1.1](./LICENSE) — converts to Apache 2.0 on April 15, 2029.
