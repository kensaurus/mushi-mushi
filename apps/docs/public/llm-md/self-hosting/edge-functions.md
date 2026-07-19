# Edge Functions deploy

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/edge-functions

---
title: Edge Functions deploy
---

# Edge Functions deploy

Mushi ships Supabase Edge Functions under `packages/server/supabase/functions/` (run `pnpm docs-stats` for the live count — currently **55**). For a working self-host you only need the **minimal ingest + classification** set below; deploy every function directory except `_shared` (or mirror [`.github/workflows/deploy-edge-functions.yml`](https://github.com/kensaurus/mushi-mushi/blob/master/.github/workflows/deploy-edge-functions.yml)) for a complete instance. Include **`healthz`** for unauthenticated monitoring probes. The repo root guide [`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md) remains the authoritative step-by-step.

## Minimal required (ingest + classify)

```bash
cd packages/server

npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy fast-filter --no-verify-jwt
npx supabase functions deploy classify-report --no-verify-jwt
```

Also deploy **`mcp`** if you use the hosted MCP transport, and **`healthz`** for unauthenticated monitoring:

```bash
npx supabase functions deploy mcp --no-verify-jwt
npx supabase functions deploy healthz --no-verify-jwt
```

  Run every deploy command from `packages/server/` — the Supabase CLI looks for `supabase/functions/` relative to the current directory. Running from the repo root will fail with "entrypoint path does not exist".

## Common optional functions

```bash
npx supabase functions deploy fix-worker --no-verify-jwt
npx supabase functions deploy judge-batch --no-verify-jwt
npx supabase functions deploy intelligence-report --no-verify-jwt
npx supabase functions deploy generate-synthetic --no-verify-jwt
npx supabase functions deploy qa-story-runner --no-verify-jwt
npx supabase functions deploy pdca-runner --no-verify-jwt
npx supabase functions deploy inventory-crawler --no-verify-jwt
npx supabase functions deploy inventory-propose --no-verify-jwt
npx supabase functions deploy inventory-gates --no-verify-jwt
npx supabase functions deploy drift-walker --no-verify-jwt
npx supabase functions deploy contract-graph-builder --no-verify-jwt
npx supabase functions deploy a2a-push-notify --no-verify-jwt
npx supabase functions deploy test-gen-from-report --no-verify-jwt
```

For closed-loop evolution workers (`mistake-clusterer`, `mistake-summarizer`, `release-builder`, `experiment-analyzer`, `anomaly-detector`, …) and cron setup, follow [`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md).

## Function inventory (core pipeline)

| Function | Trigger | What it does |
| --- | --- | --- |
| `api` | HTTP (Hono gateway) | All admin console + SDK API calls — routes under `/v1/` |
| `fast-filter` | Invoked by `api` | Stage-1 cheap triage before full classification |
| `classify-report` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `mcp` | HTTP | Hosted MCP transport for Cursor / Claude |
| `fix-worker` | `fix_attempts` INSERT | Generates a git-diff fix via `generateObject` + Zod validation |
| `judge-batch` | cron | Grades fix quality; writes `judge_results` |
| `intelligence-report` | cron / manual | Weekly LLM narrative from KPI trends |
| `drift-walker` | HTTP | Crawls live routes and compares them against `inventory_nodes` |
| `contract-graph-builder` | HTTP | Fetches Postgres schema via `execute_sql` RPC and builds the API contract graph |
| `pdca-runner` | `pdca_runs` INSERT | Runs one PDCA iteration: fix → judge → promote cycle |
| `qa-story-runner` | cron (every minute) | Runs QA Coverage stories on schedule via Firecrawl / Browserbase |
| `generate-synthetic` | cron | Playwright-based synthetic smoke tests |
| `inventory-crawler` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-propose` | manual | Proposes user-story inventory from crawl data |
| `inventory-gates` | manual | Runs gate checks (dead handlers, mock leaks) |
| `a2a-push-notify` | manual / agents | Sends A2A protocol notifications to connected agents |
| `test-gen-from-report` | manual | Generates a Playwright test from a report, opens draft PR |

The remaining workers (billing, retention, SDK upgrade, skill-sync, rewards payout, …) live alongside these. Full list: `ls packages/server/supabase/functions/` or `pnpm docs-stats`.

## Required secrets

Set secrets before deploying — functions read them at cold-start:

```bash
cd packages/server

npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
npx supabase secrets set OPENAI_API_KEY=sk-…
npx supabase secrets set LANGFUSE_PUBLIC_KEY=pk-lf-…
npx supabase secrets set LANGFUSE_SECRET_KEY=sk-lf-…
npx supabase secrets set LANGFUSE_HOST=https://cloud.langfuse.com
npx supabase secrets set SENTRY_DSN=https://…@sentry.io/…
npx supabase secrets set GITHUB_APP_ID=…
npx supabase secrets set GITHUB_APP_PRIVATE_KEY="$(cat path/to/key.pem)"
npx supabase secrets set E2B_API_KEY=…
npx supabase secrets set FIRECRAWL_API_KEY=…
npx supabase secrets set ADMIN_BASE_URL=https://your-domain.example.com/admin
```

Tenants can override `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` per project via [BYOK](/security/byok).

## JWT verification

Functions set `verify_jwt = false` in `packages/server/supabase/config.toml`. Auth is enforced **inside** each handler via one of two patterns:

- **Service-role guard** (`requireServiceRoleAuth`) — cron-triggered functions (`intelligence-report`, `pdca-runner`, `judge-batch`, etc.) verify the Supabase service-role key in the `Authorization` header, so only the Supabase scheduler can call them.
- **User / API-key guard** — user-facing functions (`api`, `mcp`, `classify-report`, etc.) authenticate via API key or JWT inside the handler.

This two-layer approach lets functions be deployed with `--no-verify-jwt` while keeping security equivalent to the platform default. See `packages/server/supabase/config.toml` for the per-function settings.
