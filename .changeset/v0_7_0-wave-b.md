---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/vue': minor
'@mushi-mushi/svelte': minor
'@mushi-mushi/angular': minor
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
'@mushi-mushi/wasm-classifier': minor
---

# v0.7.0 — Wave B: on-device classification, real-time triage, AG-UI, fine-tune pipeline, intelligence reports, AGE phase 1

Wave B focuses on intelligence and operator UX: cheaper inference (move junk
filtering on-device), live collaboration on the report queue, a typed
agent↔frontend streaming protocol, and a real fine-tune lifecycle.

This release is **non-breaking** for SDK consumers. New surface only.

## Highlights

- **On-device pre-classifier** (`@mushi-mushi/wasm-classifier`, public 0.1.0):
  ships both a zero-dependency heuristic mode and an ONNX mode (lazy-loads
  `onnxruntime-web` only when wired up). Plugs into `submitReport` via
  `preFilter.wasmClassifier`. Cuts LLM cost by ~25-40% on noisy widgets and
  keeps obvious junk on-device. (V5.3 §2.13)
- **Real-time collaboration on reports**: `report_comments` (threaded,
  optionally visible to the reporter) and `report_presence` (15-second TTL,
  pruned via `pg_cron`). Admin `ReportDetailPage` now shows presence badges
  and a comments panel powered by Supabase Realtime. (V5.3 §2.14)
- **AG-UI streaming protocol** (v0.4): the fix-dispatch SSE stream now emits
  typed envelopes (`run.started`, `run.status`, `run.tool_call`,
  `run.completed`, `run.failed`, `run.heartbeat`) alongside the legacy
  `event: status` frames. Backwards compatible. CVE-2026-29085 sanitization
  re-validated for the structured envelope. (V5.3 §2.15)
- **Fine-tune pipeline**: extended `fine_tuning_jobs` with
  `export_format`, `validation_report`, `promote_to_stage` and friends.
  New helpers `gatherTrainingSamples`, `renderJsonl`, `validateTrainedModel`,
  `promoteFineTunedModel`. New REST endpoints
  `POST /v1/admin/fine-tuning/:id/{export,validate,promote,reject}`.
  Admin UI surfaces the full pipeline stepper with PII-leakage and accuracy
  gates before promote is allowed. (V5.3 §2.15 self-improvement loop)
- **Bug intelligence reports**: weekly digests are now persisted to
  `intelligence_reports`, listable via `GET /v1/admin/intelligence`, and
  exportable as PDF via the browser's native print pipeline (zero new
  npm dependencies). New admin page surfaces history + a printable HTML
  preview per week. (V5.3 §2.16)
- **Opt-in cross-customer benchmarking**: `intelligence_benchmarks_mv`
  enforces k-anonymity ≥ 5 contributing projects per bucket. Per-project
  opt-in toggle in Settings; off by default. No project IDs, names, or PII
  leak across tenants. Refreshed nightly via `pg_cron`. (V5.3 §2.16)
- **Apache AGE parallel-write graph backend (Phase 1)**: opt-in
  `graph_backend = 'sql_age_parallel'` setting mirrors every node/edge into
  AGE through SECURITY DEFINER helpers. AGE failures are logged, never
  fatal. New `mushi_age_snapshot_drift()` and admin
  `GET /v1/admin/graph-backend/status` for drift visibility. SQL stays
  authoritative; cutover is reserved for Phase 3 in V5.5. (V5.3 §2.17)

## Migrations included

`20260418000900_realtime_collab`, `20260418001000_finetune_pipeline`,
`20260418001100_intelligence_reports`, `20260418001200_age_parallel_write`.

## New dependencies

- `@mushi-mushi/wasm-classifier@0.1.0` — published as a separate package so
  consumers who don't want the ONNX runtime in their bundle can stay on the
  heuristic mode.

## Breaking changes

None.

## Operator notes

- AGE parallel-write is **disabled by default** and requires the AGE
  extension to be installed in your Postgres. Managed Supabase Postgres
  does not currently ship AGE; the helpers degrade to graceful no-ops.
  See `packages/server/supabase/functions/_shared/age-graph.README.md`
  for the rollout phases and acceptance criteria for Phase 2 / Phase 3.
- Cross-customer benchmarking opt-in writes a timestamp + the user id who
  flipped the switch to `project_settings.benchmarking_optin_*`. There is
  no automatic opt-in based on contract type — it is always explicit owner
  action.
- The fine-tune validation gate refuses promotion if any of the following
  hold on the latest validation report: `accuracy < 0.85`, `driftScore > 0.25`,
  or `piiLeakageDetected = true`. Override requires re-running validation
  against a corrected eval set; there is intentionally no force-promote.
