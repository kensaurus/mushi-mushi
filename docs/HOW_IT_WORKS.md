# How Mushi Works — Developer Reference

> This document complements the [architecture overview](../apps/docs/content/concepts/architecture.mdx)
> and [admin console guide](../apps/docs/content/admin/index.mdx). It answers the question
> **"why does the system behave the way it does?"** by mapping every admin page and edge function
> to the data that flows through it.

---

## The core loop in one sentence

A user shakes their phone → a report lands → AI classifies it → similar reports cluster into a named
lesson → the lesson is injected into every future PR review and every AI agent run → the user who
reported it gets credit. Repeat until the bug class disappears.

---

## PDCA map — every admin page and where it sits

The sidebar is organised around **Plan → Do → Check → Act**, matching the admin console's navigation.

```
PLAN                DO                  CHECK               ACT
────────────────    ──────────────────  ──────────────────  ──────────────────
/reports            /fixes              /judge              /iterate
/stories            /repo               /health             /drift
/graph              /prompt-lab         /qa-coverage        /experiments
/queue                                  /lessons            /anomalies
/anti-gaming                            /intelligence       /releases
                                        /research
```

| Page | PDCA stage | What it connects to in the DB/functions |
|------|-----------|----------------------------------------|
| `/reports` | Plan | `reports` table → `classify-report` fn → `graph_nodes/edges` |
| `/stories` (User stories) | Plan | `inventories` + `inventory_proposals` tables |
| `/graph` | Plan | Apache AGE graph via `graph_nodes` + `graph_edges` |
| `/queue` | Plan | `processing_queue` + `fix_dispatch_jobs` |
| `/anti-gaming` | Plan | `anti_gaming_events` + `anti_gaming_flags` + `reporter_devices` |
| `/fixes` | Do | `fix_attempts` ← `fix-worker` fn ← `fix_coordinations` |
| `/repo` | Do | `project_repos` + `repo_branches` ← GitHub App |
| `/prompt-lab` | Do | `prompt_versions` → `judge-batch` fn |
| `/judge` | Check | `classification_evaluations` ← `judge-batch` nightly cron |
| `/health` | Check | `integration_health_history` ← `integration-probes.ts` |
| `/qa-coverage` | Check | `qa_stories` + `qa_story_runs` ← `qa-story-runner` fn |
| `/lessons` | Check | `lessons` + `mistake_clusters` ← BIRCH clusterer in `classify-report` |
| `/intelligence` | Check | `intelligence_reports` ← `intelligence-report` fn (weekly cron) |
| `/research` | Check | `research_sessions` + `firecrawl_cache` ← Firecrawl API |
| `/iterate` | Act | `pdca_runs` + `pdca_iterations` ← `pdca-runner` fn |
| `/drift` | Act | `drift_findings` ← `drift-walker` + `contract-graph-builder` fns |
| `/experiments` | Act | `experiments` + `experiment_variants` + `experiment_assignments` |
| `/anomalies` | Act | `anomaly_detections` ← `anomaly-detector` fn |
| `/releases` | Act | `releases` + `release_credits` ← `release-builder` fn |

---

## Follow one bug — end-to-end trace

```
1.  User presses the Mushi widget in your app
    └─ POST /v1/report (SDK) → api fn → fast-filter (spam check)

2.  classify-report runs (2-stage LLM)
    ├─ Stage 1: text → severity / category / component tags
    │            writes: reports.severity, reports.category, reports.component_tag
    ├─ Stage 2: screenshot (if present) → visual description
    │            writes: reports.visual_description  [air-gapped from Stage 1]
    └─ Embeds report text → pgvector similarity index
         writes: report_embeddings.embedding

3.  Graph ingestion (parallel)
    ├─ Upserts a node for the affected component
    ├─ Creates graph_edge (reports_against → component)
    └─ If spec traceability on: creates graph_edge (trace_to → inventory action)

4.  Plugin dispatch (parallel, optional)
    └─ Configured outbound plugins (Sentry, Slack, Jira, …) receive webhook

5.  Reporter shown on /reports
    ├─ Admin reads AI triage, adjusts if needed
    └─ Admin clicks "Dispatch fix"
         writes: fix_dispatch_jobs.status = 'queued'
         triggers: fix-worker fn

6.  fix-worker runs
    ├─ Pulls RAG context from lessons (vector similarity)
    ├─ Pulls contract snapshot from drift-walker
    ├─ Calls LLM (Anthropic/OpenAI BYOK) → structured FixResult
    │    writes: fix_attempts row with status, diff, PR URL
    └─ Opens draft GitHub PR via scoped App

7.  judge-batch nightly cron
    ├─ Re-scores classify-report's decisions against ground-truth
    │    writes: classification_evaluations.score
    └─ Runs A/B tournament if a challenger prompt exists
         promotes: prompt_versions.is_active if challenger wins

8.  BIRCH clusterer (inside classify-report)
    ├─ Groups semantically-similar reports by embedding distance
    │    writes: mistake_clusters + report_cluster_membership
    └─ Promotes coherent cluster → named lesson
         writes: lessons row with lesson_text, severity, component_tag

9.  Lesson injection
    ├─ mushi sync-lessons pulls /lessons endpoint → .mushi/lessons.json
    ├─ lessons.query MCP tool returns token-budget-ranked lessons to LLM prompts
    └─ fix-worker automatically includes top-K lessons in every fix dispatch

10. Reporter rewarded
    └─ When fix ships (PR merged webhook):
         writes: reward_payouts + end_user_points
         SDK toast: "Your report made it into v{X}"
```

---

## Edge functions — what each one does

All functions live in `packages/server/supabase/functions/`.

| Function | Trigger | Reads | Writes | Max runtime |
|----------|---------|-------|--------|-------------|
| `api` | Every request (Hono router) | all tables | most tables | unbounded (streaming) |
| `fast-filter` | POST /v1/report via api | `scoped_rate_limits` | `reports` (reject/pass) | 5 s |
| `classify-report` | `reports` INSERT trigger | `report_embeddings`, BYOK keys | `reports`, `graph_*`, `report_embeddings` | 30 s |
| `judge-batch` | pg_cron nightly | `classification_evaluations`, `prompt_versions` | `classification_evaluations`, `prompt_versions` | 5 min |
| `fix-worker` | `fix_dispatch_jobs` queue | `lessons`, `contract_snapshots`, BYOK keys | `fix_attempts`, GitHub PR | 5 min |
| `contract-graph-builder` | Called by drift-walker | `projects`, `inventories`, `inventory_nodes` | `contract_snapshots` | 30 s |
| `drift-walker` | Manual or `/drift` page | `contract_snapshots` | `drift_findings` | 2 min |
| `pdca-runner` | `/iterate` page | `pdca_runs`, `pdca_iterations` | `pdca_runs`, `pdca_iterations`, draft PR | 5 min |
| `intelligence-report` | pg_cron weekly | `reports`, `lessons`, `releases` | `intelligence_reports` | 3 min |
| `release-builder` | Manual | `reports`, `lessons` | `releases` | 60 s |
| `qa-story-runner` | pg_cron every minute | `qa_stories`, BYOK keys | `qa_story_runs`, `qa_story_evidence` | 5 min |
| `anomaly-detector` | pg_cron hourly | `metric_series` | `anomaly_detections` | 2 min |

---

## Key data tables and what they mean

```
reports                 — every user-submitted bug. Root of the graph.
report_embeddings       — pgvector: 1536-dim text embedding per report
mistake_clusters        — BIRCH cluster: group of semantically-similar reports
lessons                 — promoted clusters: named rules injected into LLM prompts
fix_attempts            — each agent run: prompt, diff, PR URL, score
contract_snapshots      — point-in-time: OpenAPI spec + inventory + pg schema
drift_findings          — delta between two snapshots
pdca_runs/iterations    — PDCA actor/critic loop state machine
qa_stories/runs         — user-story test definitions and execution history
experiment_*            — A/B assignment, variant config, CUPED stats
anomaly_detections      — STL/Page-Hinkley detectors on metric_series
graph_nodes/edges       — Apache AGE: component → report → fix topology
integration_health_*    — health check results per BYOK integration (LLM, GitHub, etc.)
project_storage_settings — per-project BYO bucket config (S3/R2/GCS/Supabase)
```

---

## Auth model

```
Public (no auth)    → /v1/report   (SDK posts with project API key, not JWT)
Authenticated user  → /v1/admin/*  (JWT from Supabase Auth, RLS enforces project scope)
Server-to-server    → internal fn  (service role bearer, validated by requireServiceRoleAuth)
Super-admin         → /v1/super-admin/* (JWT + app_metadata.role === 'super_admin')
MCP / CI            → /v1/mcp, gates actions (scoped API key, adminOrApiKey middleware)
```

The **service role key** is never sent to the browser. All admin routes run under the user's JWT,
and RLS policies on every table enforce `owner_id = auth.uid()`. The only surface that bypasses
RLS is function-to-function calls — those use `requireServiceRoleAuth()`.

---

## Why 404 for non-super-admin on /users

`/v1/super-admin/*` deliberately returns a `404 NOT_FOUND` (not a 403) when the caller is not
`super_admin`. This is **opaque by design**: a scanner probing the API cannot distinguish "this
route doesn't exist" from "you don't have permission" — so it can't confirm the surface exists.
The gate logs every blocked attempt at `info` level for operator visibility.

---

## Drift scanner — how the three pieces connect

```
/drift page
  └─ POST /v1/admin/drift/scan
       └─ api fn → drift-walker fn
            ├─ calls contract-graph-builder fn
            │    └─ fetches: OpenAPI spec + inventory nodes + pg schema (execute_sql RPC)
            │    └─ stores: contract_snapshots row
            └─ compares current snapshot vs previous snapshot
                 └─ writes: drift_findings rows
                 └─ returns structured BUILDER_FAILED / NO_SNAPSHOT / etc. error codes
                      → forwarded (not re-wrapped) by api/routes/drift.ts
                      → rendered by DriftPage SCAN_ERROR_TIPS map
```

The `execute_sql` RPC (migration `20260519100000`) is the only way the edge function can query
`information_schema` — direct Supabase client queries from Deno don't have visibility into the
schema catalog. The RPC runs under `SECURITY DEFINER` with the service role.

---

## PDCA loop — what `/iterate` actually does

```
User clicks "+ New Run"
  → POST /v1/admin/pdca (creates pdca_runs row, status = 'pending')
  → pdca-runner fn starts

pdca-runner
  for each iteration (1..N):
    1. PLAN   — Actor LLM analyses the target URL, proposes what to improve
    2. DO     — Actor proposes a specific code change or copy change
    3. CHECK  — Critic LLM scores the proposal against the selected persona
    4. ACT    — If score ≥ threshold: opens a draft PR; else feeds back to next iteration
    writes: pdca_iterations row per step; pdca_runs.final_score at end

On failure:
  writes: pdca_runs.error_detail (shown in RunDetailDrawer's ErrorAlert)
```

Personas live in `agent_personas` table. The dogfood project uses `nng-heuristic` (Nielsen Norman
Group's 10 usability heuristics) against `kensaur.us/glot-it` for continuous UX regression testing.

---

## Test user note

`test@mushimushi.dev` is the dogfood account used for API testing. Its password was rotated to
`TmpTest2026#!` during the 2026-05-19 PDCA audit session. Reset it via the Supabase dashboard →
Authentication → Users if you need the original credential.
