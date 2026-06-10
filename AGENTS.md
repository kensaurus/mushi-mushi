# AGENTS.md — Mushi Mushi Agent Conventions

This file describes the autonomous agents, edge functions, and orchestration
patterns used across the Mushi Mushi monorepo. It follows the OpenAI
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
philosophy: self-contained, machine-readable plans that any AI coding agent
can execute without additional context.

---

## Agent Inventory

<sub>14 pipeline agents · 43 edge functions · 234 SQL migrations — verified June 2026 via <code>pnpm docs-stats</code> (<a href="docs/stats.md">docs/stats.md</a>).</sub>

| Agent | Location | Trigger | Description |
|-------|----------|---------|-------------|
| `classify-report` | `supabase/functions/classify-report/` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `fix-worker` | `supabase/functions/fix-worker/` | manual / classify result | Opens a draft GitHub PR for a fix |
| `inventory-propose` | `supabase/functions/inventory-propose/` | manual / cron | Proposes user-story inventory from SDK observation data |
| `story-mapper` | `supabase/functions/story-mapper/` | POST /map-from-live | **NEW** Crawls live app URL (Firecrawl/Browserbase) → Claude drafts `inventory.yaml` → `inventory_proposals` (source=live_crawl); opt-in Cursor Cloud PR |
| `test-gen-from-story` | `supabase/functions/test-gen-from-story/` | POST /stories/:id/generate-test | **NEW** User story → Playwright TypeScript test + Firecrawl YAML + draft GitHub PR + `qa_stories` row; gated by `automation_mode` |
| `test-gen-from-report` | `supabase/functions/test-gen-from-report/` | manual | LLM generates a Playwright test from a bug report + opens a PR |
| `pdca-runner` | `supabase/functions/pdca-runner/` | queued runs / cron | Producer/Critic PDCA loop; **mode=qa_story_improve** analyzes failed qa_story_runs and proposes improved tests (source=pdca) |
| `inventory-crawler` | `supabase/functions/inventory-crawler/` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-gates` | `supabase/functions/inventory-gates/` | manual | Runs gate checks (dead handlers, mock leaks, …) |
| `judge-batch` | `supabase/functions/judge-batch/` | cron | Grades LLM fix quality; feeds `judge_results` |
| `generate-synthetic` | `supabase/functions/generate-synthetic/` | cron | Synthetic-monitor smoke tests via Playwright |
| `qa-story-runner` | `supabase/functions/qa-story-runner/` | cron (every minute) | Executes QA Coverage stories via Firecrawl / Browserbase / local; gates on `approval_status = 'approved'` |
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
| `browserbase` | Browserbase cloud Chromium | Complex UI interactions. Requires a Browserbase API key — configure via **Settings → Browserbase** in the admin console (stored in Supabase Vault; see [BYOK Providers](#byok-bring-your-own-key-providers)). |
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

Project-level API keys are stored encrypted in the `byok_keys` table via
Supabase Vault (`vault_store_secret` / `vault_get_secret` helpers). The unified
`resolveLlmKey(provider, projectId)` function in `_shared/byok.ts` reads from
`byok_keys` first, falls back to legacy `project_settings.byok_<provider>_key_ref`
columns for backwards compatibility, then falls back to the environment variable.

Keys are managed self-service via **Settings → API Keys** in the admin console
(a single table listing all four providers). Set via Settings UI, rotated by
calling `PUT /v1/admin/byok/:provider` with a new key value.

| Slug | Settings UI label | Used by |
|------|-------------------|---------|
| `firecrawl` | Firecrawl API Key | `qa-story-runner` (firecrawl_actions provider) |
| `browserbase` | Browserbase API Key | `qa-story-runner` (browserbase provider) |
| `openai` | OpenAI API Key | `test-gen-from-report`, `inventory-propose`, fine-tune jobs |
| `anthropic` | Anthropic API Key | `test-gen-from-report`, `fix-worker`, `judge-batch` |
| `aws-bedrock` | AWS Bedrock (Access Key ID + Secret) | Fine-tune jobs via `bedrockAdapter` (requires `MUSHI_BEDROCK_FINETUNE_ENABLED=1`) |

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

## TDD / PDCA Story Engine

The TDD engine combines story discovery, automated test generation, and PDCA-driven improvement into a closed loop:

```
Live App URL
  → story-mapper (Firecrawl/Browserbase crawl → Claude drafts user stories)
  → inventory_proposals (source='live_crawl', reviewed in Discovery tab)
  → Accept proposal
  → [Per story] test-gen-from-story (Claude → Playwright spec + Firecrawl YAML)
  → qa_stories (source='test_gen_from_story', approval_status by automation_mode)
  → [Review/Approve in QA Coverage page or CLI/MCP]
  → qa-story-runner executes on schedule
  → Failures → pdca-runner (mode='qa_story_improve')
  → Improved qa_stories (source='pdca', parent_story_id chain)
  → A2A notification if configured
```

### Automation Modes

| Mode | Behavior |
|------|----------|
| `auto` | Generated tests enabled immediately, no human review |
| `review` | Test created with `approval_status='pending_review'`, shown in QA Coverage queue |
| `approve` | Same as review — alias for explicit human approval workflow |

### Key Tables

| Table | Purpose |
|-------|---------|
| `story_map_runs` | Tracks live crawl jobs (pending → running → completed/failed) |
| `inventory_proposals` | Stores drafted inventory.yaml; `source` column: `passive_discovery` / `live_crawl` / `manual` |
| `qa_stories` | Test scripts; new columns: `source`, `approval_status`, `automation_mode`, `origin_story_node_id`, `parent_story_id`, `pdca_iteration` |

### CLI Quick Reference

```bash
# Map user stories from live app
mushi stories map --url https://your-app.com --wait

# Generate Playwright TDD test from a story
mushi tdd gen user-login --mode review

# Review pending tests
mushi tdd pending

# Approve a generated test
mushi tdd approve <qa-story-id>

# Trigger PDCA improvement on failing tests
mushi tdd improve

# Manage API key pool
mushi keys list
# Prefer the env var so the key is not captured in shell history:
MUSHI_BYOK_KEY=sk-ant-... mushi keys add --provider anthropic --label "Backup key"
```

### MCP Tools

New TDD MCP tools available with `mcp:write` or `mcp:read` scope:
`map_user_stories`, `get_map_run_status`, `generate_tdd_from_story`, `improve_qa_story`,
`run_qa_story`, `list_byok_keys`, `add_byok_key`, `list_pending_review_stories`, `approve_qa_story`

---

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
