---
"@mushi-mushi/mcp-ci": patch
---

Wave S hardening (2026-04-23) — server-side + admin UX.

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
  + `reports` shape that actually ships in the schema.
