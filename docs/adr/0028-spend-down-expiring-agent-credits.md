# 0028. Spend-down mode: Mushi may spend an expiring Cursor key on its own, inside the auto-fix caps

Status: Accepted (owner-delegated, 2026-10-20) Date: 2026-10-20

Related: migration `20261020090056_byok_spend_down.sql`, `_shared/spend-down.ts`,
`_shared/spend-down-db.ts`, `spend-down-worker/`, `api/routes/byok-spend-down.ts`,
`apps/admin/src/components/settings/SpendDownSection.tsx`, MCP
`get_spend_down_status` / `set_byok_spend_down`, CLI `mushi keys spend-down`;
builds on [0023](0023-ai-keys-can-be-shared-by-every-app-in-an-organization.md)
and [0013](0013-cloud-coding-agents-run-through-edge-adapters.md).

## Context

On 2026-10-20 the owner had two Cursor accounts whose usage credits (Grok 4.7
xhigh) were about to expire unused, and asked that Mushi "do the role of
maximizing the usage of tokens and credits that are expiring". Spending them
meant someone dispatching fixes by hand, report by report, on every app, until
the date passed. Mushi already dispatches fixes on its own (auto-fix after
triage) inside per-app caps (`autofix_max_dispatches_per_day`,
`autofix_max_spend_usd`), and every fix opens a draft PR that a person merges.

Cursor publishes no API for remaining credit (Plan 021), so Mushi cannot know
how much is left.

## Decision

- A Cursor key in `byok_keys` can be set to **spend down**: a credit expiry
  date (`credits_expire_at`, separate from the credential's `expires_at`), a
  model, fixes per day (1-200, default 10) and how many days before expiry to
  start (1-90, default 14). Off by default; Cursor keys only; on requires a
  date (database check).
- The `spend-down-worker` (cron `28,58 * * * *`) dispatches, for each key in
  its window, the best open reports of the apps that key **already serves**,
  using ADR 0023's order without changing the resolver: an app's own key
  serves that app; a shared key serves apps with no Cursor key of their own,
  legacy Integrations key included. Apps with auto-fix off or no repo are
  skipped.
- Every dispatch is `trigger: 'automatic'`, so the app's auto-fix caps apply
  (checked by the worker and again by fix-worker), at most three cloud agents
  run per app, and a report dispatched in the last 7 days is not picked again.
  Ranking: severity × judge score × named component, one per report group.
- The limit is a count of dispatches, not dollars, because no balance is
  readable. Nothing merges: each fix is a draft PR, as today.
- Turning it on for a shared key is an organization owner's or admin's call
  in the console (ADR 0023). An app's own key: its owner or admin, also from
  the CLI or MCP (`mcp:write`).

## Rejected

- **Pinning the spend-down key per dispatch.** It would let a shared key
  spend on an app that has its own key, which ADR 0023 forbids, and would
  need a resolver change. Serving only the apps that already use the key
  keeps one resolver.
- **A dollar floor** (`spend_floor_usd`, Plan spec §4). Without a balance
  API the "estimated remaining" would be a guess presented as a number.
- **Spending outside the auto-fix caps.** The caps are the owner's statement
  of how much Mushi may do alone; spend-down does not get its own exception.
  Raise the cap to spend faster.
- **UX runs and QA generation in the same worker.** The cloud UX run is a
  session-only route (ADR 0017's approval posture); QA generation runs on
  Anthropic/OpenAI keys, not Cursor. Left to a later decision.

## Consequences

- A key with spend-down on starts fixes every 30 minutes in its window, up to
  its daily number; the console, `get_spend_down_status` and
  `mushi keys spend-down` show today's count, the apps it pays for and why the
  last tick skipped an app.
- Same day, the Cursor key resolver was brought back in line with ADR 0023:
  an app's legacy Integrations key now comes before a shared key
  (`resolveCursorApiKey`); before, a shared key moved such apps onto another
  account.
