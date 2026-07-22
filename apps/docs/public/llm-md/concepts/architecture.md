# Architecture

Source: https://kensaur.us/mushi-mushi/docs/concepts/architecture

---
title: Architecture
---

# Architecture

The whole system is intentionally boring at the seams: a Hono gateway in
front of Supabase, **51** specialised edge functions behind it, and three
data substrates (relational + vector + graph) that mirror each other for
their respective query shapes. Everything an SDK does is one POST to the
gateway; everything a contributor adds is either a route or a function.

## Wire-level flow

The four columns below correspond to the four "layers" of the stack —
left-to-right is the path a single bug report takes from a user's
device to a merged PR.

| ⓵ SDKs (client) | ⓶ Edge gateway | ⓷ Data | ⓸ External |
|---|---|---|---|
| `@mushi-mushi/web` + framework adapters | `api` *(Hono router)* | Postgres + RLS | Sentry *(User-Feedback webhook)* |
| `@mushi-mushi/react-native` | `fast-filter` *(spam triage)* | `pgvector` embeddings | Slack |
| Native iOS / Android / Flutter | `classify-report` *(2-stage LLM)* | Apache AGE graph | GitHub *(scoped App)* |
| `@mushi-mushi/capacitor` | `judge-batch` *(nightly cron)* | `blast_radius_cache` MV | Langfuse *(traces)* |
| `@mushi-mushi/mcp` *(stdio + Streamable HTTP)* | `fix-worker` *(sandbox PR + LLM agent)* | Supabase Vault *(BYOK + plugin secrets)* | Marketplace plugins *(PagerDuty, Linear, …)* |
| `@mushi-mushi/cli` *(init / connect / upgrade)* | `sdk-upgrade-worker` *(semver bump PR)* | `sdk_upgrade_jobs` | GitHub *(upgrade PRs)* |
| Admin **Connect & Update** (`/connect`) | `sdk-versions-cron` *(daily npm sync)* | `sdk_versions` | npm registry |
|  | `skill-sync` *(skills.sh ingest)* | `agent_skills` + pipeline runs | cursor-kenji / skills.sh |
|  | `intelligence-report` *(weekly digest)* | `contract_snapshots` *(drift baseline)* | Firecrawl *(research + crawl)* |
|  | `drift-walker` *(live crawl diff)* | `pdca_runs` + `fix_attempts` | Browserbase *(QA story execution)* |
|  | `contract-graph-builder` *(snapshot builder)* | `qa_stories` + `qa_story_runs` |  |
|  | `pdca-runner` *(Plan→Do→Check→Act)* | `integration_health_history` |  |
|  | `qa-story-runner` *(scheduled user-story tests)* |  |  |
|  | `soc2-evidence` *(control snapshot)* |  |  |

**Edges that matter** (everything else flows top-to-bottom inside a column):

- Every SDK posts to `api` — there is no client-direct DB write.
- `api → fast-filter → classify-report` is the canonical ingest path.
- `classify-report → pgvector + Apache AGE + plugins` happens in parallel.
- `judge-batch` reads from and writes back into `classify-report`'s prompts.
- `fix-worker → GitHub` dispatches automatically when autofix is enabled and the estimated cost is under the project's budget; it pauses for a console approval only when that cost exceeds `autofix_approval_cost_threshold_usd`.
- `pdca-runner` orchestrates `fix-worker` autonomously — one PDCA run may spawn multiple fix-worker calls.
- `drift-walker → contract-graph-builder` compares a fresh crawl against the stored `contract_snapshots` baseline.
- `api → Supabase Vault` resolves BYOK secrets per-request, never cached.
- All LLM-touching functions stream traces to Langfuse.

## Component summary

- **Edge gateway (`api`, Hono on Supabase Edge Functions)** authenticates with API
  keys (public SDK reports) or JWT (admin console), enforces rate limits, and routes
  to specialised functions. All admin routes live under `/v1/admin/*`.
- **`fast-filter`** triages high-volume garbage (form spam, duplicate one-liners)
  with the cheapest model the project's BYOK plan permits.
- **`classify-report`** runs the canonical two-stage classifier. Stage 1
  tags category/severity/component from text. Stage 2, only if a screenshot
  is present, runs an air-gapped vision pass that *cannot* see Stage 1's
  prompt (defence against prompt injection via screenshots).
- **`judge-batch`** is a nightly cron that scores classifier accuracy with a
  separate judge model, feeding the prompt-A/B framework that promotes new
  prompt versions automatically when they win statistically.
- **`fix-worker`** dispatches approved triage decisions to a sandboxed LLM agent
  (Anthropic / OpenAI BYOK) that generates code patches, validates them against
  a Zod schema, and opens a draft PR via a scoped GitHub App. Validation failures
  include Zod issue detail in `fix_attempts.error` for debugging.
- **`pdca-runner`** orchestrates autonomous Plan → Do → Check → Act cycles:
  crawls a target URL, identifies issues, calls `fix-worker` for each, verifies
  the result, and writes per-run + per-iteration records to `pdca_runs`.
- **`drift-walker`** fetches the live app (using `contract-graph-builder`) and
  diffs the result against the stored `contract_snapshots` baseline. Structured
  error codes (`BUILDER_FAILED`, `SNAPSHOT_MISSING`) flow through to the
  [Drift scanner](/admin/drift) UI.
- **`contract-graph-builder`** crawls a URL via Firecrawl and builds a contract
  graph (routes, components, API endpoints). Called by `drift-walker` and also
  when the SDK registers a new inventory snapshot.
- **`qa-story-runner`** executes `qa_stories` records on schedule (pg_cron, every
  minute) using Firecrawl, Browserbase, or local Playwright. Writes results to
  `qa_story_runs` and `qa_story_evidence` with screenshots.
- **`intelligence-report`** generates weekly bug-intelligence digests with
  optional cross-customer benchmarking (k-anonymity enforced via materialized view).
  Runs with `verify_jwt = false`; authenticated via service-role header internally.
- **`soc2-evidence`** snapshots control state for SOC 2 Type 1 readiness.
- **`sdk-upgrade-worker`** reads a linked GitHub repo's `package.json`(s), computes a
  semver-only bump plan (`computeBumpPlan`), opens a draft PR via shared
  `createPrFromFiles`, and writes status to `sdk_upgrade_jobs`. Triggered from
  **Connect & Update → Create Upgrade PR** or `POST /v1/admin/projects/:pid/sdk-upgrade`.
- **`sdk-versions-cron`** upserts latest stable `@mushi-mushi/*` versions from npm
  (daily pg_cron + post-publish sync) into `sdk_versions` so freshness chips stay
  accurate between releases.
- **`skill-sync`** ingests allowlisted `SKILL.md` files (default:
  `kensaurus/cursor-kenji`), embeds descriptions, and powers **Skill Pipelines**
  (`/skills`) — attach a skill chain to a report and stream step status over Realtime.

## MCP surface (2026)

The same tool catalog ships on two transports:

| Transport | Entry | Notes |
|---|---|---|
| **stdio** | `npx @mushi-mushi/mcp` | Local editor subprocess; env from `.env.local` or `mcp.json` |
| **Streamable HTTP** | `/functions/v1/mcp` | Remote orchestrators; `?features=triage,fixes,inventory,setup,docs` for lean default |

Catalog source of truth: `packages/mcp/src/catalog.ts`, mirrored in
`apps/admin/src/lib/mcpCatalog.ts`, guarded by `pnpm check:catalog-sync`.
Destructive tools carry MCP annotations; scope enforcement is `mcp:read` vs `mcp:write`.

## Connect & Update (console)

`/connect` consolidates onboarding paths that previously lived across Settings,
Onboarding, and MCP:

1. **GitHub** — prerequisite for upgrade PRs and autofix.
2. **SDK install** — live snippet + trigger-mode preview (`SdkInstallCard`).
3. **MCP** — **Add to Cursor** deeplink + hosted/stdio snippets (`McpInstallButtons`).
4. **CLI** — `npm i -g @mushi-mushi/cli@latest`.
5. **Update center** — per-package freshness + **Create Upgrade PR** (`SdkUpgradeCTA`).

CLI mirror: `mushi connect --wait` writes the same artifacts locally (Cursor MCP is wired by default; pass `--no-ide` to skip).

## Knowledge graph

Reports embed into pgvector for semantic dedup. The same edges are mirrored
asynchronously into Apache AGE so customers who care about graph queries
(e.g. "find all reports touching the same component within a release
window") get true Cypher.

## A2A Agent Card

Public discovery endpoints at `/.well-known/agent-card` and `/v1/agent-card`
expose the agent's identity, skills, supported A2A version, MCP transport,
and auth requirements. Other agents can negotiate with Mushi without
out-of-band config.

## Data residency

Each project pins to a region (`us` / `eu` / `jp`). The gateway returns
`307 Temporary Redirect` when a request reaches the wrong region, and the
Core SDK transparently follows it (caching the resolved region in
`localStorage`). The US cluster remains the **catalog of record** for
plugin marketplace + project metadata.

The 307 routing itself is implemented and live today; dedicated EU/JP
Supabase clusters are reserved but not yet provisioned, so an `eu` or `jp`
project currently redirects to the same single production cluster — see
[Data residency](/security/data-residency) for the exact regional rollout
status.

## Storage

Per-project storage settings ([BYO Storage](/security/byo-storage)) let
you keep screenshots and intelligence-report PDFs in your own
S3 / R2 / GCS / MinIO bucket. Supabase Storage is the default.
