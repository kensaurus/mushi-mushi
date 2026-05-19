# AGENTS.md — Mushi Mushi Agent Conventions

This file describes the autonomous agents, edge functions, and orchestration
patterns used across the Mushi Mushi monorepo. It follows the OpenAI
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
philosophy: self-contained, machine-readable plans that any AI coding agent
can execute without additional context.

---

## Agent Inventory

| Agent | Location | Trigger | Description |
|-------|----------|---------|-------------|
| `classify-report` | `supabase/functions/classify-report/` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `fix-worker` | `supabase/functions/fix-worker/` | manual / classify result | Opens a draft GitHub PR for a fix |
| `inventory-propose` | `supabase/functions/inventory-propose/` | manual / cron | Proposes user-story inventory from crawl data |
| `inventory-crawler` | `supabase/functions/inventory-crawler/` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-gates` | `supabase/functions/inventory-gates/` | manual | Runs gate checks (dead handlers, mock leaks, …) |
| `test-gen-from-report` | `supabase/functions/test-gen-from-report/` | manual | LLM generates a Playwright test from a report + opens a PR |
| `judge-batch` | `supabase/functions/judge-batch/` | cron | Grades LLM fix quality; feeds `judge_results` |
| `generate-synthetic` | `supabase/functions/generate-synthetic/` | cron | Synthetic-monitor smoke tests via Playwright |
| `qa-story-runner` | `supabase/functions/qa-story-runner/` | cron (every minute) | Executes QA Coverage stories via Firecrawl / Browserbase / local |
| `intelligence-report` | `supabase/functions/intelligence-report/` | cron | Weekly LLM narrative from KPI trends |
| `a2a-push-notify` | `supabase/functions/a2a-push-notify/` | manual / other agents | Sends A2A protocol notifications to connected agents |

---

## QA Coverage Suite

The QA Coverage Suite (`qa-story-runner`) is the primary agent orchestration
layer. It allows users to define user-story tests as NL prompts or full
Playwright scripts, schedule them via cron, and run them on three providers:

### Providers

| Provider | Where it runs | When to use |
|----------|---------------|-------------|
| `firecrawl_actions` | Firecrawl cloud (Deno-compatible, HTTP) | Default. No setup. Works for content verification and basic navigation. |
| `browserbase` | Browserbase cloud Chromium | Complex UI interactions. Requires `BYOK_BROWSERBASE_API_KEY` in project settings. |
| `local` | Operator's machine via CLI | Full Playwright access. Not schedulable via edge function. Use `mushi-dev run-qa-stories`. |

### Story lifecycle

```
User creates story (NL prompt or Playwright script)
  → stored in `qa_stories` table (schedule_cron default: '0 * * * *', hourly)
  → pg_cron fires qa-story-runner every minute
  → cron-matching gate: only run if story schedule aligns with current UTC time
  → enabled check: disabled stories are skipped entirely
  → rate-limit check: max 3 concurrent runs per project (MAX_CONCURRENT_PER_PROJECT)
  → BYOK key resolution (firecrawl / browserbase / openai from mushi_runtime_config)
  → execute via provider (inline HTTP or Browserbase REST)
  → write qa_story_runs (status, latency_ms, provider_session_url, assertion_failures)
  → write qa_story_evidence (screenshots, console logs, HAR, video, traces)
  → qa_story_coverage_24h MV refreshed by separate pg_cron (every 15 min)
  → if status = failed + A2A endpoint configured: push notification via a2a-push-notify
```

### Manual run trigger

`POST /v1/admin/projects/:pid/qa-stories/:sid/run` (requires story to be enabled, returns 409 otherwise) inserts a `pending` run row and fire-and-forgets a call to the `qa-story-runner` edge function with `{ trigger: 'manual', story_id, run_id }`. The runner picks it up immediately.

### AI-assisted authoring

When a user triggers "Generate test from report" in the Reports page:
1. `test-gen-from-report` edge function generates a Playwright TypeScript test
2. A draft GitHub PR is opened
3. A `qa_stories` row is automatically created (provider: `local`, weekly cron)

---

## BYOK (Bring Your Own Key) Providers

Project-level API keys are stored encrypted in the `byok_keys` table
(future) or referenced as text slugs in `qa_stories.byok_provider`.

| Slug | Secret env var (set via Settings → API Keys) | Used by |
|------|----------------------------------------------|---------|
| `firecrawl` | `BYOK_FIRECRAWL_API_KEY` | `qa-story-runner` (firecrawl_actions provider) |
| `browserbase` | `BYOK_BROWSERBASE_API_KEY` | `qa-story-runner` (browserbase provider) |
| `openai` | `BYOK_OPENAI_API_KEY` | `test-gen-from-report`, `inventory-propose` |
| `anthropic` | `BYOK_ANTHROPIC_API_KEY` | `test-gen-from-report`, `fix-worker`, `judge-batch` |

---

## Adding a New Agent

1. Create `packages/server/supabase/functions/<name>/index.ts`
2. Import `withSentry` wrapper and `getServiceClient`
3. Register `requireServiceRoleAuth` for cron-triggered functions
4. Add to `packages/server/supabase/config.toml` if needed
5. Deploy: `npx supabase functions deploy <name> --no-verify-jwt`
6. Add a cron if needed via `SELECT cron.schedule(...)` or a migration
7. Update this file and `docs/execplans/PLANS.md`

---

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
