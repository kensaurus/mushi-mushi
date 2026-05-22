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
| `tremendous-redemption-worker` | `supabase/functions/tremendous-redemption-worker/` | pg_cron (every minute) | Drains `tremendous_orders` with `status='pending'`; calls Tremendous `/v2/orders`; updates status on delivery. Cloud-only. |
| `recompute-tester-reputation` | `supabase/functions/recompute-tester-reputation/` | pg_cron (daily 04:30 UTC) | Recomputes `tester_reputation` score, `signal_pct`, `impact_pct`, `leaderboard_rank_30d` for all testers using the HackerOne-style formula. |
| `tester-submission-router` | `packages/server/supabase/functions/api/routes/tester-marketplace.ts` | HTTP (API route) | Routes `POST /v1/tester/submissions` through `ingestReport()`, creates `tester_submissions` row, tags Sentry event per published-app DSN. |

---

## Codebase Explorer API

The admin console's `/explore` page is backed by two project-scoped REST endpoints in `billing-projects-queue-graph.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/admin/projects/:id/codebase/explore` | `GET` | Returns the full codebase graph: `nodes` (files/symbols with layer, language, line range, content preview), `edges` (import relationships), `layers` (count per layer), `total_files`. Add `?symbols=1` for symbol-level granularity. |
| `/v1/admin/projects/:id/codebase/search` | `POST` | Semantic search. Body: `{ query: string, k?: number }`. Generates an embedding for the query and calls the `match_codebase_files` RPC for vector similarity ranking. Returns ranked `results[]` with `similarity` scores. |

**Data source:** `project_codebase_files` table. Populated by `mushi index` (CLI) or Settings → Codebase Indexing.

**Architectural layers** (detected by `detectExploreLayer` on the backend, mirrored by `detectLayer` on the frontend):

| Layer | Key | Heuristic |
|-------|-----|-----------|
| UI | `ui` | `app/`, `pages/`, `screens/`, `components/` directories; `.tsx/.jsx` extension |
| Library | `lib` | `lib/`, `utils/`, `hooks/`, `shared/`, `common/` directories |
| Backend | `backend` | `server/`, `api/`, `supabase/functions/`, `routes/` directories |
| Tests | `test` | `tests/`, `__tests__/`, `spec/`, `.test.ts` / `.spec.ts` files |
| Config | `config` | `config/`, `.github/`, `tooling/`; `.json`, `.yaml`, `.toml` files |
| Other | `other` | Anything else |

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

## Mushi Bounties — Tester Marketplace

The **Mushi Bounties** sub-product (crowd-testing marketplace) adds the following
surfaces on top of the core evolution loop:

| Surface | Location | Audience |
|---|---|---|
| Public browse + signup | `apps/testers/` Next.js at `kensaur.us/mushi-mushi/testers/` | Anyone; no auth required to browse |
| Tester dashboard | `apps/admin /tester/*` (Vite SPA, `<TesterRoute>`) | Logged-in testers |
| Publishing controls | `apps/admin /rewards?tab=publishing` | Dev/PM (Pro+ only; cloud-only) |
| Tester API | `api/routes/tester-marketplace.ts` | Testers via JWT |
| Published-app admin API | `api/routes/published-apps.ts` | Dev/PM via JWT |
| Redemption worker | `supabase/functions/tremendous-redemption-worker/` | cron (platform) |

Key design constraints:
- **Cloud-only.** Self-hosted installs see an upgrade CTA.
- **No crypto, no prize draws.** mushi-points redeem for Mushi Pro (1.3× coupon) or Tremendous gift cards ($599/yr cap).
- **Testers are NOT org members.** They use `auth.users` + `mushi_testers` table; never added to `organization_members`.
- **Legal review required before gift-card cash-out.** See `docs/runbooks/tester-marketplace-launch.md`.

Concept doc: [`apps/docs/content/concepts/bounty-marketplace.mdx`](apps/docs/content/concepts/bounty-marketplace.mdx).
Research: [`docs/research/tester-marketplace-research-2026-05-22.md`](docs/research/tester-marketplace-research-2026-05-22.md).

---

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
