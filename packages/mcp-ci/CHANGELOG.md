# @mushi-mushi/mcp-ci

## 0.2.2

### Patch Changes

- 71b2fe8: Wave S hardening (2026-04-23) — server-side + admin UX.

  Not a public API change; this changeset exists to version-bump a single
  package so Changesets produces a release entry summarising the wave.
  The bulk of Wave S is in the `@mushi-mushi/server` Edge Functions and the
  `apps/admin` console, neither of which are published to npm.

  Wave S highlights:
  - Internal auth contract — every internal-only Edge Function now uses the
    shared `requireServiceRoleAuth` helper. Hand-rolled checks that only
    accepted `SUPABASE_SERVICE_ROLE_KEY` are gone; pg_cron callers can now
    use `MUSHI_INTERNAL_CALLER_SECRET`. A new vitest contract asserts this
    at CI time.
  - `usage-aggregator` was un-authed in previous revisions — now gated with
    `requireServiceRoleAuth` and the N+1 `billing_customers` lookup is now
    bulk-fetched by unique `project_id`.
  - New generic `scoped_rate_limit_claim` RPC + `scoped_rate_limits` table.
    `/v1/admin/assist` and `/v1/admin/intelligence` now rate-limited.
    NL-query gets a per-minute sub-cap (10/min) in addition to hourly.
  - New `POST /v1/admin/fixes/dispatches/:id/cancel` endpoint — the admin
    UI's "Cancel" button was previously a dead 404.
  - Judge composite score now honours per-prompt `judge_rubric` from
    `prompt_versions`; pure helper extracted so Node-based unit tests can
    import the math without Deno runtime.
  - `fix-worker` and `judge-batch` lifted N+1 lookups (project_settings,
    getPromptForStage) outside per-report loops; `reports` / `project_settings`
    selects narrowed from `*` to explicit column lists.
  - Anthropic system prompts in `fix-worker`, `intelligence-report`, and
    `/v1/admin/assist` now send `cacheControl: { type: 'ephemeral' }` to
    opt in to prompt caching.
  - Admin `GraphTableView` lightly windowed (250 rows per page) to keep
    graph imports >2k nodes from freezing the accessibility fallback.
  - Prompt auto-tuner no longer silently skips projects that only use the
    global default prompt — it forks the active global prompt into a
    project-scoped candidate and tunes from there.
  - `scripts/prompts-bench.mjs` now queries the `classification_evaluations`
    - `reports` shape that actually ships in the schema.

## 0.2.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

## 0.2.0

### Minor Changes

- 81336e9: Wave G2 — MCP becomes the agentic centerpiece.
  - `@mushi-mushi/mcp`: five new tools — `trigger_judge`, `dispatch_fix`, `transition_status`, `run_nl_query`, `get_knowledge_graph`. Existing tool endpoints corrected to match the backend API.
  - `@mushi-mushi/mcp-ci` (new package): GitHub Action + CLI (`mushi-mcp-ci`) with subcommands `trigger-judge`, `dispatch-fix`, `check-coverage`, `query`. Drop-in merge gate for PRs that must wait for Mushi judge pass before shipping.
