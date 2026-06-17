# AGENTS.md — Mushi Mushi Agent Conventions

This file describes the autonomous agents, edge functions, and orchestration
patterns used across the Mushi Mushi monorepo. It follows the OpenAI
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
philosophy: self-contained, machine-readable plans that any AI coding agent
can execute without additional context.

---

## Agent Inventory

<sub>18 pipeline agents · 47 edge functions · 243 SQL migrations — updated Jun 16 2026 (one-click SDK install & upgrade: sdk-upgrade-worker + sdk-versions-cron + Connect & Update hub + SdkUpgradeCTA PR action).</sub>

| Agent | Location | Trigger | Description |
|-------|----------|---------|-------------|
| `classify-report` | `supabase/functions/classify-report/` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `fix-worker` | `supabase/functions/fix-worker/` | manual / classify result | Opens a draft GitHub PR for a fix; auto-readies PR via GraphQL `markPullRequestAsReady`. Refactored to import branch/commit/PR helpers from `_shared/github-pr.ts`. |
| `sdk-upgrade-worker` | `supabase/functions/sdk-upgrade-worker/` | POST from `sdk-upgrade` route | **NEW** Reads the connected repo's `package.json`(s), bumps `@mushi-mushi/*` to latest npm versions, opens a draft PR + marks ready. Writes result to `sdk_upgrade_jobs`. Guards: allow-listed paths, semver-only bumps, vault token resolution, `requireServiceRoleAuth`. |
| `sdk-versions-cron` | `supabase/functions/sdk-versions-cron/` | pg_cron daily 02:30 UTC + release.yml | **NEW** Fetches latest stable version for every `@mushi-mushi/*` package from the npm registry and upserts into `sdk_versions` so freshness chips are accurate between hand-authored migrations. `requireServiceRoleAuth`. |
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
```

### MCP Tools

Core MCP tools (`mcp:read` scope): `get_recent_reports`, `get_report_detail`, `get_lessons`, `list_qa_story_runs`, `get_qa_story_run`

Notification tools (`mcp:write` scope): `test_notification_channel`

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
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id` | `adminOrApiKey(mcp:write)` | Poll job status |
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id/stream` | `adminOrApiKey(mcp:write)` | SSE status stream |

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
| `ConnectPage` | `apps/admin/src/pages/ConnectPage.tsx` (route `/connect`) | Unified hub: GitHub connect → SDK install → MCP install → CLI install → Update center with "Create Upgrade PR" |
| `SdkUpgradeCTA` | `apps/admin/src/components/SdkUpgradeCTA.tsx` | Primary "Create Upgrade PR" button (when `projectId` supplied + GitHub connected); copy-cmd fallback always present |
| `SdkUpgradeBanner` | `apps/admin/src/components/dashboard/SdkUpgradeBanner.tsx` | Dashboard nudge when active project SDK is outdated/deprecated |
| `McpInstallButtons` | `apps/admin/src/components/McpInstallButtons.tsx` | Extracted from `McpPage` — reusable "Add to Cursor / VS Code" deeplink buttons |
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

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
