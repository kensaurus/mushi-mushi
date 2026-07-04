# AGENTS.md — Mushi Mushi Agent Conventions

This file describes the autonomous agents, edge functions, and orchestration
patterns used across the Mushi Mushi monorepo. It follows the OpenAI
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
philosophy: self-contained, machine-readable plans that any AI coding agent
can execute without additional context.

---

## Positioning — read this before you touch any user-facing surface

> The canonical constitution is [`/VISION.md`](./VISION.md). This block is the
> compressed copy so on-message behavior survives even when an agent only loads
> `AGENTS.md`. If this and `VISION.md` ever disagree, `VISION.md` wins — fix it
> here, don't fork it. Drift is enforced against by
> [`scripts/check-positioning-consistency.mjs`](./scripts/check-positioning-consistency.mjs).

**North star.** Your AI shipped it. Mushi tells you why it broke — in plain English, in your editor, with the fix ready to go — so a bug costs you five minutes instead of your whole afternoon.

**Category we own.** The comprehension layer for AI-built apps. (Not "error monitoring", not "observability", not "synthesis layer / integration hub" — those are the drift.)

**Primary buyer.** The solo / indie **vibe coder** who builds fast with AI (Cursor, Claude Code, Lovable, Bolt), ships to real users, then loses afternoons when something breaks because they don't fully grasp the generated code. Small teams and agencies are secondary; the enterprise SRE running Sentry + Datadog + Firebase is explicitly *not* who we lead with.

**The three things we will not do** (drift tripwires):

1. **We will not require a monitoring stack to get value.** Standalone-first, always — never assume the reader already runs Sentry + Datadog + Firebase.
2. **We will not lead with the integration-hub / enterprise-plumbing story.** It can live in `docs/operators/`; it never leads.
3. **We will not let the surfaces diverge.** The tagline, the north-star sentence, and the buyer stay identical across npm, repo, landing, and this file.

The "is this drift?" test for any feature you build or surface you write: *"Does this help a solo vibe-coder understand and fix a bug faster, without leaving their editor?"* Yes → it can lead. No, but operators need it → `docs/operators/`, never the hero.

---

## Agent Inventory

<sub>19 pipeline agents — run <code>pnpm docs-stats</code> for live edge-function, migration, and package counts. Updated Jun 18 2026 (reporter incentives: automatic report.submitted/report.triaged point awards + one-click reward presets + vault-backed reward webhooks + `@mushi-mushi/node` receiver; page-aware in-SDK assistant: `POST /v1/sdk/assistant` BYOK + knowledge corpus + audit log).</sub>

| Agent | Location | Trigger | Description |
|-------|----------|---------|-------------|
| `classify-report` | `supabase/functions/classify-report/` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `fix-worker` | `supabase/functions/fix-worker/` | manual / classify result | Opens a draft GitHub PR for a fix; auto-readies PR via GraphQL `markPullRequestAsReady`. Refactored to import branch/commit/PR helpers from `_shared/github-pr.ts`. |
| `sdk-upgrade-worker` | `supabase/functions/sdk-upgrade-worker/` | POST from `sdk-upgrade` route | **NEW** Reads the connected repo's `package.json`(s), bumps `@mushi-mushi/*` to latest npm versions, opens a draft PR + marks ready. Writes result to `sdk_upgrade_jobs`. Guards: allow-listed paths, semver-only bumps, vault token resolution, `requireServiceRoleAuth`. |
| `sdk-versions-cron` | `supabase/functions/sdk-versions-cron/` | pg_cron daily 02:30 UTC + release.yml | **NEW** Fetches latest stable version for every `@mushi-mushi/*` package from the npm registry and upserts into `sdk_versions` so freshness chips are accurate between hand-authored migrations. `requireServiceRoleAuth`. |
| `sdk-release-sync` | `supabase/functions/sdk-release-sync/` | pg_cron every 5 min | **NEW** Polls GitHub for active SDK upgrade jobs (`pr_opened \| ready_to_merge \| blocked \| merged \| deploying`): fetches PR detail, latest check-run, and deployment status (normalized via `normalizeDeployStatus`), then upserts CI/deploy/release status into `sdk_upgrade_jobs` to drive the release-cockpit chips. `requireServiceRoleAuth`. |
| `inventory-propose` | `supabase/functions/inventory-propose/` | manual / cron | Proposes user-story inventory from SDK observation data |
| `story-mapper` | `supabase/functions/story-mapper/` | POST /map-from-live | Crawls live app URL (Firecrawl/Browserbase) → Claude drafts `inventory.yaml` → `inventory_proposals` (source=live_crawl); opt-in Cursor Cloud PR |
| `test-gen-from-story` | `supabase/functions/test-gen-from-story/` | POST /stories/:id/generate-test | User story → Playwright TypeScript test + Firecrawl YAML + draft GitHub PR + `qa_stories` row; gated by `automation_mode` |
| `test-gen-from-report` | `supabase/functions/test-gen-from-report/` | manual | LLM generates a Playwright test from a bug report + opens a PR |
| `pdca-runner` | `supabase/functions/pdca-runner/` | queued runs / cron | Producer/Critic PDCA loop; **mode=qa_story_improve** analyzes failed qa_story_runs and proposes improved tests (source=pdca) |
| `inventory-crawler` | `supabase/functions/inventory-crawler/` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-gates` | `supabase/functions/inventory-gates/` | manual | Runs gate checks (dead handlers, mock leaks, …) |
| `judge-batch` | `supabase/functions/judge-batch/` | cron | Grades LLM fix quality; feeds `judge_results` |
| `generate-synthetic` | `supabase/functions/generate-synthetic/` | cron | Synthetic-monitor smoke tests via Playwright |
| `qa-story-runner` | `supabase/functions/qa-story-runner/` | cron (every minute) | Executes QA Coverage stories via Firecrawl / Browserbase / local; gates on `approval_status = 'approved'` |
| `intelligence-report` | `supabase/functions/intelligence-report/` | cron | Weekly LLM narrative from KPI trends |
| `a2a-push-notify` | `supabase/functions/a2a-push-notify/` | manual / other agents | Sends A2A protocol notifications to connected agents |
| `backend-drift-scanner` | `supabase/functions/backend-drift-scanner/` | cron daily 03:05 UTC | Snapshots each linked project's Supabase schema via read-only MCP, diffs vs previous snapshot, writes `gate_findings` of type `schema_drift` for dropped columns / missing RLS / unexpected table changes |
| `skill-sync` | `supabase/functions/skill-sync/` | cron daily + POST /v1/admin/skills/sources/:id/sync | Fetches SKILL.md files from allowlisted GitHub repos (any skills.sh-compatible repo, default: kensaurus/cursor-kenji), parses frontmatter + chain_slugs, embeds descriptions (pgvector), upserts `agent_skills` catalog; secret-pattern scan guard; drives `classify-report` Stage 2 skill recommendation |

### Infrastructure worker edge functions (not pipeline agents)

Cron, billing, retention, and platform hygiene workers live alongside the 19 pipeline agents above. They are **not** user-facing agents but must be deployed for a **complete self-host**. Full list: run `pnpm docs-stats` and inspect `packages/server/supabase/functions/`.

| Function | Role |
| --- | --- |
| `ci-sync` | Polls GitHub check-runs for open fix PRs |
| `retention-sweep` | Applies data-retention policies |
| `stripe-webhooks` | Stripe subscription + invoice events |
| `slack-interactions` | Slack interactive payloads + threaded replies |
| `webhooks-github-indexer` | GitHub App push → codebase RAG indexer |
| `usage-aggregator` / `usage-alerts` | Stripe meter events + quota alerts |
| `anomaly-detector` | Hourly anomaly scoring |
| `codebase-analyze-worker` | Builds symbol graph on push / manual re-analyze |
| `console-knowledge-build` | Rebuilds console knowledge corpus |
| `integration-health-probe` | BYOK + integration probe cron |
| `plugin-dispatch-retry` | Retries failed outbound plugin deliveries |
| `qa-story-runner` | Scheduled QA story execution (also listed above) |
| `sdk-versions-cron` / `sdk-release-sync` | SDK freshness catalog + upgrade PR CI sync |
| `sentinel-audit` | Inventory drift vs SDK observations |
| `sentry-seer-poll` | Proactive Sentry Seer intake |
| `soc2-evidence` | Compliance evidence snapshots |
| `status-reconciler` | Inventory action status derivation |
| `synthetic-monitor` | Periodic health-check + post-PR probes |
| `tremendous-redemption-worker` | Reward payout fulfillment |

Also: **`api`** (Hono REST router) and **`mcp`** (Streamable HTTP MCP transport) — infrastructure, not agents.

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
| `local` | Operator's machine via CLI | Full Playwright access. Not schedulable via edge function. Use `mushi qa run <story-id>`. |

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
  → update qa_stories state columns (last_run_status, consecutive_failures, slack_failure_ts, last_notified_at)
  → qa_story_coverage_24h MV refreshed by separate pg_cron (every 15 min)
  → Slack notification policy (transition-aware):
      • pass→fail or error: post new Block Kit message to project's Slack channel (store thread ts)
      • consecutive failures: threaded reply with backoff (1st, 3rd, 10th, then daily)
      • fail→pass: threaded "recovered after N failures" message, state reset
  → dispatchPluginEvent('qa_story.failed' | 'qa_story.recovered') for fan-out to Discord, Teams, etc.
  → Discord: direct webhook post to project_settings.discord_webhook_url (no relay plugin required)
```

**Important correction (Jun 2026):** The `a2a-push-notify` agent is listed in the agent inventory but is NOT invoked on QA story failure. The previous `a2a_push_deliveries` insert in `qa-story-runner` and `notifyA2A` in `pdca-runner` were schema-mismatched and silently failing; they have been removed. QA failure notification now routes through the Slack Block Kit policy and `dispatchPluginEvent`.

### Manual run trigger

`POST /v1/admin/projects/:pid/qa-stories/:sid/run` (requires story to be enabled, returns 409 otherwise) inserts a `pending` run row and fire-and-forgets a call to the `qa-story-runner` edge function with `{ trigger: 'manual', story_id, run_id }`. The runner picks it up immediately.

### AI-assisted authoring

When a user triggers "Generate test from report" in the Reports page:
1. `test-gen-from-report` edge function generates a Playwright TypeScript test
2. A draft GitHub PR is opened
3. A `qa_stories` row is automatically created (provider: `local`, weekly cron)

---

## Code Health Ingest (Jun 2026)

`POST /v1/ingest/metrics` — CI-push endpoint that records host-app bundle sizes and god-file LOC
findings into `metric_series` (time-series) and `gate_runs` / `gate_findings` (the new
`code_health` gate). Uses the same `apiKeyAuth` middleware as all other SDK ingest routes.

| Payload key | Type | Description |
|---|---|---|
| `metrics[]` | `MetricPoint` | `{ metric_name, dimension?, value, ts? }` — prefix allow-list: `bundle.`, `code_health.` |
| `findings[]` | `CodeHealthFinding` | `{ rule_id, severity, file_path?, line?, message, suggested_fix? }` |

The admin console `/code-health` page reads the data back via `GET /v1/admin/code-health?project_id=`.

**yen-yen integration**: `scripts/scan-god-files.mjs` scans `apps/mobile/app`, `apps/mobile/components`, `apps/mobile/lib` for files over 2,000 LOC. `.github/workflows/bundle-budget.yml` posts bundle KB + scan findings on every push to `main`. Requires `MUSHI_API_URL` + `MUSHI_INGEST_KEY` repo secrets on `kensaurus/yen-yen` (mint via Projects → SDK ingest key; `scripts/setup-yen-yen-ingest-secrets.mjs` automates Playwright + `gh secret set`).

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
| `qa_stories` | Test scripts; notable columns: `source`, `approval_status`, `automation_mode`, `origin_story_node_id`, `parent_story_id`, `pdca_iteration`, `target_url`, `last_run_status`, `consecutive_failures`, `slack_failure_ts`, `last_notified_at` |

### CLI Quick Reference

| Group | Commands |
| --- | --- |
| **Setup & account** | `mushi init`, `mushi setup`, `mushi connect`, `mushi login`, `mushi upgrade`, `mushi reset`, `mushi whoami`, `mushi doctor`, `mushi completion` |
| **Project & deploy** | `mushi project`, `mushi config`, `mushi console`, `mushi deploy check`, `mushi index`, `mushi sourcemaps upload` |
| **Reports** | `mushi reports list/show/search/triage/…`, `mushi feedback board` |
| **Fixes** | `mushi fix`, `mushi fixes tail/refresh-ci/merge`, `mushi watch` |
| **QA / TDD** | `mushi qa stories/runs/run`, `mushi tdd gen/pending/approve/improve`, `mushi stories map` |
| **Skills / pipeline** | `mushi skills list/show/sync`, `mushi pipeline start/watch/checkin` |
| **Integrations** | `mushi integrations list/test`, `mushi slack status/test`, `mushi keys list/add` |
| **Billing** | `mushi usage`, `mushi billing status/cap` |

```bash
# ── Integrations ──────────────────────────────────────────────────────────
# List all configured integrations and their health status
mushi integrations list

# Run a health probe for a specific integration
mushi integrations test slack
mushi integrations test sentry
mushi integrations test github

# ── Slack ─────────────────────────────────────────────────────────────────
# Check whether Slack is connected
mushi slack status

# Send a test Slack message to verify the channel works
mushi slack test

# ── QA Stories ────────────────────────────────────────────────────────────
# List all QA stories and their last run status
mushi qa stories

# Show recent runs for a story (with error heads)
mushi qa runs <story-id>

# Manually trigger a QA story run
mushi qa run <story-id>

# ── Doctor checks ─────────────────────────────────────────────────────────
# Full pre-flight + server + QA story health check
mushi doctor --server --qa-stories

# ── TDD / Story mapping ───────────────────────────────────────────────────
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

# ── Fix lifecycle (dispatch → CI → merge) ─────────────────────────────────
mushi fix <reportId> --agent cursor_cloud --wait
mushi fixes tail --report-id <reportId>
mushi fixes refresh-ci <fixId>
mushi fixes merge <fixId>              # squash-merge PR + mark report Fixed

# ── Diagnoses usage + billing ─────────────────────────────────────────────
mushi usage                            # diagnoses used / limit / cap for this period
mushi billing status                   # full billing summary (plan, usage, cap, overage)
mushi billing cap                      # show current spend cap
mushi billing cap 100                  # set $100/mo hard spend cap
mushi billing cap 0                    # clear spend cap
```

### MCP Tools

Full catalog: **71 tools** in [`packages/mcp/src/catalog.ts`](packages/mcp/src/catalog.ts) — generated docs at [`apps/docs/content/sdks/mcp-tools.generated.mdx`](apps/docs/content/sdks/mcp-tools.generated.mdx). Vibe-coder incident loop: [`apps/docs/content/quickstart/incident-loop.mdx`](apps/docs/content/quickstart/incident-loop.mdx) (`get_fix_context` → `summarize_report_for_fix`).

Core MCP tools (`mcp:read` scope): `get_recent_reports`, `get_report_detail`, `get_fix_context`, `get_lessons`, `list_qa_story_runs`, `get_qa_story_run`

Notification tools (`mcp:write` scope): `test_notification_channel`

Usage / billing tool (`mcp:read` scope): `get_usage` — diagnoses used / limit / spend cap for the current period.

TDD MCP tools: `map_user_stories`, `get_map_run_status`, `generate_tdd_from_story`, `improve_qa_story`,
`run_qa_story`, `list_byok_keys`, `add_byok_key`, `list_pending_review_stories`, `approve_qa_story`

**New in Jun 2026 Slack overhaul:**
- `list_qa_story_runs` — recent runs for a story with error heads
- `get_qa_story_run` — full run detail with screenshots and assertion failures
- `test_notification_channel` — send a test ping to verify Slack or Discord is wired up

---

## Skill-Driven Triage Pipelines

The Skill Pipeline feature (Jun 2026) integrates the [cursor-kenji / skills.sh](https://github.com/kensaurus/cursor-kenji) agent-skill ecosystem into Mushi as a first-class pipeline concept.

### Architecture

```
git repo skills/SKILL.md
  → skill-sync edge fn (daily cron + manual POST)
  → agent_skills catalog (pgvector embeddings)
  → classify-report Stage 2 (recommended_skills on reports)
  → api/routes/skills.ts
  → skill_pipeline_runs + step_runs (Realtime)
  → Console SkillPipelinesPage (React Flow, live updates)
  → CLI: mushi skills / mushi pipeline
  → MCP tools (list_skills, start_skill_pipeline, …)
  → plugin-cursor-cloud (cloud mode auto-dispatch)
```

### Execution Modes

| Mode | Description |
|------|-------------|
| `handoff` | Composes a "run packet" (skill instructions + report context) for the dev's local Cursor agent via CLI/MCP |
| `cloud` | Each step dispatches a Cursor Cloud agent run via the existing plugin; step status streams to the console |

### CLI Quick Reference

```bash
# Skill catalog
mushi skills list [--category workflow] [--search "fix bug"]
mushi skills show workflow-fix-and-ship
mushi skills sync [--source-id <id>]

# Pipeline runs
mushi pipeline start <reportId> --skill workflow-fix-and-ship [--mode cloud]
mushi pipeline watch <runId-or-prefix>
mushi pipeline checkin <runId-or-prefix> --step 0 --status passed [--notes "Fixed null check"]
```

### MCP Tools (Jun 2026 Skill Pipelines)

Skill tools (`mcp:read` scope): `list_skills`, `get_skill`

Pipeline tools (`mcp:write` scope): `start_skill_pipeline`, `get_pipeline_run`, `checkin_pipeline_step`

### Key Tables

| Table | Purpose |
|-------|---------|
| `skill_sources` | Allowlisted git repos whose SKILL.md files are synced |
| `agent_skills` | Global catalog; one row per SKILL.md; carries pgvector embedding for Stage 2 semantic recommendation |
| `skill_pipeline_runs` | One run per "attach skill to report" action; stores `context_packet`, `mode`, `status` |
| `skill_pipeline_step_runs` | One step per skill in the chain; Realtime-enabled for live console updates |

### Guardrails

- **Allowlist only**: `skill-sync` only fetches from `skill_sources.repo_slug` rows (no arbitrary URL ingestion)
- **Secret-pattern scan**: every SKILL.md body is scanned for leaked keys/tokens before upsert
- **Description length**: enforced at ≤ 1024 chars per Agent Skills spec
- **Packet budget**: `context_packet` is capped at 40,000 chars (configurable in `_shared/skill-packet.ts`)
- **Rate limit**: pipeline starts are limited per project (enforced in `api/routes/skills.ts`)
- **Air-gap**: skill content flows *into* LLM prompts only — never executed against raw user strings

---

## Console merge loop (Jun 2026)

User-confirmed PR merge from the admin console or CLI — closes the gap between
"draft PR open" and report **Fixed** without requiring a manual GitHub merge +
webhook.

### Endpoints

| Route | Auth | Purpose |
| ----- | ---- | ------- |
| `POST /v1/admin/fixes/:id/merge` | `adminOrApiKey(mcp:write)` | Merge PR on GitHub + `finalizeFixMerge()` |
| `POST /v1/admin/fixes/:id/refresh-ci` | `adminOrApiKey(mcp:write)` | On-demand `ci-sync` for check-run badge |

Shared logic: `_shared/fix-merge.ts` (`mergeGithubPullRequest`, `finalizeFixMerge`).

### Draft → ready → merge

1. `fix-worker` opens a **draft** PR, then calls `markPullRequestReady()` (GraphQL —
   REST `draft: false` is unreliable).
2. Console/CLI merge calls `mergeGithubPullRequest()` which re-readies if still draft.
3. GitHub squash-merge (default) → webhook or inline `finalizeFixMerge()` sets
   `merged_at`, report → `fixed`, reporter notification, `fix.applied` plugins.

### CLI

```bash
mushi fixes refresh-ci <fixId>
mushi fixes merge <fixId> [--method squash|merge|rebase]
```

Admin UI: `MergeFixPreflight`, `FixCiFeedback`, `pickPrimaryFixAttempt()` in
`apps/admin/src/lib/mergeFix.ts`.

---

## One-click SDK Install & Upgrade (Jun 2026)

Extends the "one-click MCP install" to **SDK/CLI install and upgrades**. The
headline capability is a **"Create Upgrade PR"** that opens a reviewed GitHub PR
bumping `@mushi-mushi/*` in the connected repo, reusing the existing GitHub App
+ draft-PR machinery.

### Architecture

```
Console "Create Upgrade PR" button
 → POST /v1/admin/projects/:pid/sdk-upgrade (sdk-upgrade route)
 → insert sdk_upgrade_jobs (queued)
 → waitUntil → invoke sdk-upgrade-worker
 → worker: resolveProjectGithubToken + Contents API + computeBumpPlan
 → createPrFromFiles (_shared/github-pr.ts) → draft PR → markReady
 → pr_url stored in sdk_upgrade_jobs
 → GET /stream SSE polling → Console status chip → PR link
```

### New API routes

| Route | Auth | Description |
| ----- | ---- | ----------- |
| `POST /v1/admin/projects/:pid/sdk-upgrade` | `adminOrApiKey(mcp:write)` | Enqueue upgrade job; fire-and-forget worker |
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id` | `jwtAuth` | Poll job status (console JWT) |
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id/stream` | `adminOrApiKey(mcp:read)` | SSE status stream |

### New tables

| Table | Purpose |
|-------|---------|
| `sdk_upgrade_jobs` | Tracks upgrade PR jobs; columns: `id, project_id, requested_by, status, pr_url, pr_number, branch, commit_sha, plan jsonb, error, timestamps`. RLS: service-role only. |

### Shared modules

| File | Role |
|------|------|
| `_shared/sdk-upgrade-plan.ts` | Pure `computeBumpPlan(pkg, latestVersions)` — mirrors CLI's `planUpgrade()` guards. Never replaces `workspace:` / `file:` / git specifiers. Always uses live npm registry at PR time. |
| `_shared/github-pr.ts` | Generic `createPrFromFiles()` + `ghFetch` / `ghFetchOptional`. Shared by `fix-worker` and `sdk-upgrade-worker`. |

### Frontend surfaces

| Surface | Location | What it adds |
|---------|----------|-------------|
| `ConnectPage` | `apps/admin/src/pages/ConnectPage.tsx` (route `/connect`) | Unified hub: **ConnectStudio** hero (3 lanes: MCP one-click, CLI, Skills) + GitHub connect → SDK install → Update center with "Create Upgrade PR" |
| `ConnectStudio` | `apps/admin/src/components/connect/ConnectStudio.tsx` | Higgsfield-style "pick your client → connect in one click" hero. 9-client picker + 3 lanes (MCP / CLI / Skills). Collapses old activation/snapshot/provenance strips into a single collapsible "Connection status" disclosure. |
| `ClientConnectButton` | `apps/admin/src/components/ClientConnectButton.tsx` | Registry-driven install button: handles deeplink (opens IDE), config-json, cli-command, and remote-url methods. Mints a per-project key before building the artifact. |
| `MCP_CLIENTS` registry | `packages/mcp/src/clients.ts` | Pure shared registry of all 9 AI clients (Cursor, VS Code, VS Code Insiders, Windsurf, Cline, Claude Code, Claude Desktop, Zed, Any). Consumed by both the admin console and the public docs `/connect` landing — single source of truth so the two never drift. |
| Public Connect landing | `apps/docs/app/connect/page.tsx` | Public Higgsfield-style landing at `/connect` on the docs site. Same 3-lane picker but with placeholder keys + "Sign in to mint & one-click install" CTA. Registered in docs nav. |
| `SdkUpgradeCTA` | `apps/admin/src/components/SdkUpgradeCTA.tsx` | Primary "Create Upgrade PR" button (when `projectId` supplied + GitHub connected); copy-cmd fallback always present |
| `SdkUpgradeBanner` | `apps/admin/src/components/dashboard/SdkUpgradeBanner.tsx` | Dashboard nudge when active project SDK is outdated/deprecated |
| `McpInstallButtons` | `apps/admin/src/components/McpInstallButtons.tsx` | Back-compat thin wrapper around `ClientConnectButton` for Cursor + VS Code — keeps `McpPage` working unchanged |
| `useSdkUpgrade` | `apps/admin/src/lib/useSdkUpgrade.ts` | React hook mirroring `useDispatchFix`: POST → SSE stream with poll fallback |

### sdk_versions catalog sync

The `sdk_versions` catalog is kept fresh via two paths:
1. **publish-time** — `release.yml` runs `scripts/sync-sdk-versions.mjs` after
   Changesets publish, posting the exact published versions via Supabase REST.
2. **daily cron** — `sdk-versions-cron` edge function (02:30 UTC) queries the
   npm registry for every `@mushi-mushi/*` package and upserts the latest stable
   version. Backstop for publish-time sync failures.

---

## Native CI Secrets Diagnostic & Auto-Write (Jun 2026)

For Capacitor, Expo, and React Native apps, the Mushi SDK environment variables
(`NEXT_PUBLIC_MUSHI_PROJECT_ID`, `NEXT_PUBLIC_MUSHI_API_KEY`,
`NEXT_PUBLIC_MUSHI_API_ENDPOINT`) must be **baked into the native bundle at
compile time** — Next.js inlines `NEXT_PUBLIC_*` vars at build time and they
cannot be injected at runtime. A missing secret silently disables `initMushi()`
and the lime feedback banner never appears in the downloaded store app.

### Detection

`GET /v1/admin/projects/:id/sdk-diagnostics` returns a fused verdict combining:
- **Authoritative**: repo Actions secrets/variables are listed via the stored GitHub
  token and compared against the required names from `projectMushiEnv` (per-project
  var map). Missing name → definitive `ci-secret-missing` verdict.
- **Telemetry fallback** (no GitHub token): scans `project_api_keys.last_seen_origin`
  / `last_seen_user_agent`; flags `native-never-seen` when web/server heartbeats
  exist but no `capacitor://` / `okhttp` / `CFNetwork` origin appears.

Response shape: `{ status, platformHint, endpointMatches, bannerEnabled, launcherMode,
requiredVars, presentVars, missingVars, lastSeenAt, recommendedFix, repoUrl, hasGithubToken }`.

### Auto-write

`POST /v1/admin/projects/:id/sync-ci-secrets` — the one-click operation:

1. Resolves repo from `project_repos` (primary row).
2. Resolves token via `resolveProjectGithubToken`.
3. Mints a project-scoped `report:write` key labelled `ci-auto:<repo>`; deactivates
   prior `ci-auto:*` keys (idempotent-by-name — avoids key sprawl).
4. Writes each required var via sealed-box encryption (libsodium `crypto_box_seal` +
   GitHub `PUT .../actions/secrets/{name}`) or plain `PUT .../actions/variables/{name}`.
5. Logs audit event; returns `{ ok, written, skipped, failed }`.

### GitHub App vs PAT permission boundary (critical for agent implementers)

The **Mushi GitHub App** currently requests only `Contents: write` and
`Pull requests: write`. It does **not** have `Actions secrets: write`. This means:

- Auto-write works **only** when a **fine-grained PAT** with
  `Actions secrets: Read and write` is stored in the project's GitHub connection
  settings (`project_settings.github_installation_token_ref`).
- When the GitHub App installation token is used and lacks the secrets scope,
  GitHub returns HTTP 403. The backend detects this and returns:
  `{ ok: false, error: { code: "GH_SECRETS_FORBIDDEN" }, fallback: { commands, envBlock } }`.
- The console `SdkNativeConnectivityCard` surfaces this as an inline warning with
  explanatory text and auto-expands the guided fallback (copy-paste `gh secret set`
  commands + CI `env:` block).

**To enable full auto-write via the GitHub App** (instead of a PAT):
1. Add `Secrets: Read and write` to the App's requested permissions on GitHub.
2. This forces a re-consent for all installations (users must approve the new scope).
3. Until then, the guided PAT path is the supported route for CI secret auto-write.

### Guided fallback

When auto-write is forbidden or no GitHub token is stored, the backend always
returns `fallback.commands` (one `gh secret set` / `gh variable set` command per
required var, prefixed with `.env.local`-sourced value substitution) and
`fallback.envBlock` (the `env:` YAML snippet to add to the CI workflow). The
console presents these as copyable code blocks so developers are never dead-ended.

### Frontend surfaces

| Surface | Location | What it adds |
|---------|----------|-------------|
| `SdkNativeConnectivityCard` | `apps/admin/src/components/SdkNativeConnectivityCard.tsx` | Fetches `/sdk-diagnostics`, renders status badge, one-click sync CTA, forbidden explanation, guided fallback commands |
| `ConnectPage` section "Native app CI secrets" | `apps/admin/src/pages/ConnectPage.tsx` | Wires the card into the Connect hub beside SDK install |
| `sdkCiSecrets.ts` | `apps/admin/src/lib/sdkCiSecrets.ts` | Pure helpers: required var names per project slug, `buildGuidedFallbackCommands`, `sdkCiStatusMeta` |
| `useCiSecretSync` | `apps/admin/src/lib/useCiSecretSync.ts` | React hook for the POST → sync flow (synchronous, no SSE needed) |
| `sdkClientPlatform.ts` | `apps/admin/src/lib/sdkClientPlatform.ts` | `sdkOriginKind` + `isNativeOrigin` classify `capacitor://`, `okhttp`, `CFNetwork` signals |

### Build-time guard (glot.it reference implementation)

`scripts/check-mushi-env.mjs` (non-fatal by default, strict with `MUSHI_ENV_STRICT=1`) is
invoked from `prebuild:native` and emits a prominent warning block when
`NEXT_PUBLIC_MUSHI_PROJECT_ID` or `NEXT_PUBLIC_MUSHI_API_KEY` are empty during a
native build. Copy this pattern into any Capacitor/RN project using the Mushi SDK.

---

## Codebase Atlas (`/explore`)

Server-hosted **Codebase Understand** surface in the admin console — parity with [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) commands.

| Tab group | Routes | Backend |
|-----------|--------|---------|
| Summary | `overview` | `GET /v1/admin/explore/stats` |
| Understand | `ask`, `tour`, `domains`, `knowledge` | `api/routes/codebase-understand.ts` |
| Map | `graph`, `layers` | `GET …/codebase/explore` (+ UA graph JSON when `symbols=1`) |
| Search | `search` | `POST …/codebase/search` (semantic + name modes) |
| Index | `index` (Advanced mode) | scope settings + analyze job debug |

**Workers & tables (Jun 2026):**

| Object | Role |
|--------|------|
| `codebase-analyze-worker` | Builds UA-shaped graph JSON from `project_codebase_files`; enqueued on push + manual Re-analyze |
| `project_codebase_graph` | Symbol-level graph JSONB per project |
| `codebase_analyze_jobs` | Job queue (service-role only) |
| `project_codebase_wiki_sources` / `…_knowledge_*` | Wiki ingest + RAG merge via `match_knowledge_chunks` |
| `project_settings.codebase_index_scope_paths` | Scoped subdirectory indexing |

**MCP tools:** `ask_codebase`, `get_file_summary`, `get_codebase_tour`, `search_codebase`, `get_codebase_domains`, `analyze_codebase_impact`, `analyze_wiki_knowledge`.

Graph builder concepts attributed to **Understand-Anything (MIT)** — see `packages/codebase-graph/README.md` and `_shared/codebase-graph-build.ts`.

---

## Production deployment

Maintainers shipping Mushi Cloud or npm SDK releases should follow
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (repo runbook) and the public summary at
[`apps/docs/content/operating/deployment.mdx`](apps/docs/content/operating/deployment.mdx).
Key points: Changesets version PR → merge → **manual `release.yml` dispatch** when
GitHub suppresses the bot merge trigger; Edge Functions / admin / docs deploy on
path-filtered pushes; **DB migrations are manual** (`supabase db push`).

---

## Reporter incentives & page-aware assistant (Jun 18 2026)

Closes three SDK pain points across the four host repos: (1) reporters had no
reason to come back, (2) the reward economy needed console wiring + a turnkey
host receiver, and (3) the console's page-aware chatbot had no in-SDK
equivalent. **All three migrations are applied and verified on remote
(`dxptnwrhwsqckaftyymj`); the `api` edge function is deployed.**

### Automatic point awards (no console config required)

Reporters now earn points on the two moments that matter, awarded server-side
inside the ingest + triage pipeline so incentives work out of the box:

| Moment | Where | Action | Default points |
|--------|-------|--------|----------------|
| Report submitted | `api/helpers.ts` `ingestReport` (after `end_user` link) | `report.submitted` | 10 |
| Report triaged | `classify-report/index.ts` (after classification) | `report.triaged` | 50 |

Both calls go through `awardPointsForEndUser` (`_shared/reputation.ts`), which
enforces `reward_rules` velocity caps, propagates to the tier-evaluator, and
fires the `points_awarded` notification. The dotted actions are seeded in
`LEGACY_POINT_TABLE` so they award with **zero** console config; a project can
override base/cap by adding a `reward_rules` row of the same name.

- **Fire-and-forget**: a rewards failure never blocks ingest or triage.
- **Idempotency**: `report.triaged` is guarded by an explicit prior-award check
  (`end_user_activity.action='report.triaged'` + `metadata->>report_id`) so
  re-classification / stage-2 retries can't double-award.

### One-click reward presets

`POST /v1/admin/rewards/presets/apply` (`jwtAuth` — console only) idempotently installs
recommended default rules (`report.submitted` / `report.triaged` /
`comment_posted`) and a 4-tier ladder (Explorer → Contributor → Champion →
Legend, with `host_credit_payload` grant instructions). Only inserts
actions/slugs that don't already exist, so it's safe to re-run and never
clobbers operator customisations. Surfaced as the "Use recommended defaults"
CTA on the empty-state of `apps/admin/src/pages/RewardsPage.tsx` — ease of
setup before customizability.

### Vault-backed reward webhook secrets + `@mushi-mushi/node` receiver

- `reward_webhooks.vault_secret_id` (migration `20260618140000`) stores the raw
  HMAC signing secret in Supabase Vault; `secret_hash` is retained for
  display/equality only. `_shared/reward-webhooks.ts` `loadWebhookSecret` reads
  the raw value back via `vault_get_secret`, falling back to the legacy env var.
  The same migration **restores the canonical `vault_store_secret(text,text,uuid)`**
  function (it was missing on remote, which also broke BYOK key saves).
- `POST /v1/admin/rewards/webhooks` now **mints** a `mushi_whk_…` secret when the
  caller omits one, stores it in Vault, and returns it **once** (API-key style).
- `@mushi-mushi/node` exports `createMushiRewardsHandler({ secret, onTierChanged,
  onPointsAwarded })` — a framework-agnostic receiver (Express middleware +
  Web-standard `fetch` handler) that timing-safely verifies `X-Mushi-Signature`
  and routes events. This is the Mushi → host-repo "grant a role / grant a Stripe
  membership" trigger. See `packages/node/README.md`.

### Cross-app "My Reports" fix

`mushi_get_my_cross_app_reports` (migration `20260618130000`) selected
`reports.short_id` / `reports.title`, neither of which exists — every call 500'd.
Now derives `short_id` from the UUID's first 8 hex chars and `title` from
`summary` (falling back to a trimmed `description`). The web widget's My Reports
tab, leaderboard (rank/points), account rank, and rewards "X pts to <next tier>"
display consume this.

### Page-aware in-SDK assistant

A knowledge-grounded "Ask" tab in the widget. **v1 has zero cross-user data
surface** — it answers only from the page context the SDK publishes and the
operator-authored knowledge corpus, so it structurally cannot leak another
user's data, source, or env.

```
Widget "Ask" tab → apiClient.askAssistant({ message, threadId, context })
  → POST /v1/sdk/assistant (apiKeyAuth, per-project 240/hr cap)
  → verify optional X-Mushi-User-Token (audit only — no user data fetched)
  → BYOK LLM via withAnthropicOrOpenAi (Anthropic primary → OpenAI fallback)
  → structured { kind: 'answer' | 'clarify', … } (generateObject + Zod)
  → log both turns to sdk_assistant_messages (route, model, tokens, cost, latency)
  → return MushiAssistantReply + threadId
```

| Object | Role |
|--------|------|
| `project_settings.assistant_*` | `assistant_enabled`, `assistant_label`, `assistant_greeting`, `assistant_suggestions`, `assistant_knowledge` (corpus, 40k cap) — migration `20260618150000` |
| `sdk_assistant_messages` | Per-turn audit log; RLS `RESTRICTIVE` deny-all (service-role/edge-fn only) |
| `POST /v1/sdk/assistant` | `apiKeyAuth` — the assistant turn (security-hardened system prompt, BYOK, structured output, logging) |
| `GET /v1/sdk/config` | Now returns the `assistant` block so the widget shows the tab without a rebuild |
| `GET\|PUT /v1/admin/projects/:id/assistant` | `jwtAuth` — read/update config; the knowledge corpus is **secret-scanned** (rejects keys/tokens/connection strings with `SECRET_DETECTED`) and 40k-capped before persist |
| `GET /v1/admin/projects/:id/assistant/logs` | `jwtAuth` — recent turns for audit/cost review |

**Frontend surfaces:**

| Surface | Location | What it adds |
|---------|----------|-------------|
| `AssistantConfigCard` | `apps/admin/src/components/AssistantConfigCard.tsx` | One-toggle enable + greeting/label/chips; collapsed "Advanced" holds the knowledge editor + recent-turns log |
| SDK configurator | `apps/admin/src/pages/ProjectsPage.tsx` | Mounts `AssistantConfigCard` under `SdkInstallCard` |

**Security model:** the system prompt hard-forbids revealing secrets/source/env
and treats the user's message as untrusted data (prompt-injection resistant);
the knowledge corpus is the only operator-supplied text and is secret-scanned on
write; every turn is logged. Full doc: [`docs/SDK_ASSISTANT.md`](docs/SDK_ASSISTANT.md).

---

## Screenshot preview & consent caption (Jun 19 2026)

Finance and health hosts often disabled screenshot capture because reporters
could not see what would be sent. **v1.19.0** adds a visible preview on the
details step plus a configurable privacy caption — so capture can stay on with
an explicit review-and-remove gate.

```
Reporter opens widget (capture.screenshot on-report/auto)
  → SDK captures screen → data URL
  → Web: <img> preview on step 3  |  RN: thumbnail in bottom sheet
  → Optional caption from widget.screenshotSensitiveHint
  → Reporter Remove / Mark up (web) / Submit
  → POST ingest with or without screenshot blob
```

| Object | Role |
|--------|------|
| `MushiWidgetConfig.screenshotSensitiveHint` | `true` = localized default, `string` = custom, `false` = hide caption |
| `project_settings.sdk_screenshot_sensitive_hint` | Console/runtime store: `NULL` = default, `''` = hidden, string = custom (≤ 200 chars) — migration `20260619100000` |
| `GET /v1/sdk/config` | Emits `widget.screenshotSensitiveHint` for runtime merge |
| `PUT /v1/admin/projects/:id/sdk-config` | Persists via `coerceSdkConfigUpdate()` in `api/helpers.ts` |

**Frontend surfaces:**

| Surface | Location | What it adds |
|---------|----------|-------------|
| SdkInstallCard | `apps/admin/src/components/SdkInstallCard.tsx` | Checkbox + optional custom text for screenshot privacy caption |
| ConfigHelp | `sdk-install.screenshot_sensitive_hint` in `configDocs.ts` | Operator docs + link to deep-dive |

**Introduced in:** `@mushi-mushi/core` / `@mushi-mushi/web` **1.19.0** (current: **1.22.5** — see root `CHANGELOG.md`).
`@mushi-mushi/react-native` **0.19.0** (current: **0.20.1**). Full doc:
[`docs/SDK_SCREENSHOT_PREVIEW.md`](docs/SDK_SCREENSHOT_PREVIEW.md).

---

## SDK reliability overhaul (Jul 2026)

Fixes CLI browser sign-in desync, host-vs-console config clobbering, and several
backend hardening gaps. User docs:
[runtime config concept](https://kensaur.us/mushi-mushi/docs/concepts/runtime-config),
[CLI loop](https://kensaur.us/mushi-mushi/docs/quickstart/cli-console-loop).
Operator checklist: [`docs/operators/sdk-reliability-overhaul.md`](docs/operators/sdk-reliability-overhaul.md).

### CLI device auth

| Route | Auth | Role |
| --- | --- | --- |
| `POST /v1/cli/auth/device/start` | Public + IP rate limit | Mint device code; accepts `client_id` |
| `POST /v1/cli/auth/device/approve` | JWT | User approves code |
| `POST /v1/cli/auth/device/token` | Public + IP rate limit | CLI polls; sets `cli_token_claimed_at` |
| `GET /v1/cli/auth/device/status` | JWT | Approval page polls until claimed |

Shared logic: `_shared/cli-auth-helpers.ts` (`parseClientId`, `evaluateTokenDelivery`,
60s re-delivery grace). Migration: `20260702090000_cli_auth_two_phase_claim.sql`.

### SDK runtime config

| Object | Role |
| --- | --- |
| `_shared/sdk-config.ts` | Single `normalizeSdkConfig` / `coerceSdkConfigUpdate` (explicit-only emission) |
| `packages/web/src/runtime-merge.ts` | Client merge — host banner/capture win over console defaults |
| `GET /v1/sdk/config` | Runtime payload for SDK |

Full precedence: [`docs/SDK_RUNTIME_CONFIG.md`](docs/SDK_RUNTIME_CONFIG.md).

### Backend hardening (same release)

| Change | Migration / file |
| --- | --- |
| Idempotency cache not readable by project viewers | `20260702100000_request_idempotency_restrict_member_read.sql` |
| Rate limits work for IP-derived actors | `20260702110000_scoped_rate_limits_generalize_actor.sql` |
| MCP JWT validation for write scope | `functions/mcp/index.ts` |
| Canonical hosted tool manifest | `_shared/mcp-hosted-tool-manifest.json` |
| Readiness probe | `GET /health/ready` in `api/routes/discovery.ts` |
| LLM transient retry before key rotation | `_shared/llm-failover.ts` |

---

## HTTP API surfaces — operator reference

Generated manifest: [`docs/API_ROUTE_MANIFEST.generated.md`](docs/API_ROUTE_MANIFEST.generated.md) (`pnpm gen:route-manifest`). OpenAPI subset: `GET /functions/v1/api/openapi.json`.

### SDK ingest (`apiKeyAuth`)

| Route | Role |
| --- | --- |
| `POST /v1/reports` | Single report ingest |
| `POST /v1/reports/batch` | Batch ingest |
| `POST /v1/ingest/spans` | OTel span ingest |
| `POST /v1/ingest/metrics` | Code-health + bundle metrics |
| `POST /v1/sdk/activity` | Reporter activity events |
| `POST /v1/sdk/discovery` | SDK observation inventory |
| `POST /v1/sdk/assistant` | In-widget Ask tab |
| `GET /v1/sdk/config` | Runtime SDK config pull |
| `GET /v1/reports/:id/status` | Report status poll |
| `/v1/sdk/me/*` | Cross-app reporter rewards surface (`rewards.ts`) |

### MCP / CLI sync mirror (`adminOrApiKey` or scoped JWT)

Prefix **`/v1/sync/*`** — reports, lessons, ingest-setup mirrors for MCP and CLI offline sync. See `api/routes/sync.ts`.

### Skills HTTP routes (`requireAuthOrApiKey`)

Under **`/v1/admin/skills/*`**: catalog (`GET /`, `GET /:slug`), sources CRUD + `POST /sources/:id/sync`, pipeline runs + checkin, `GET /cloud-readiness`. See `api/routes/skills.ts`.

---

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
