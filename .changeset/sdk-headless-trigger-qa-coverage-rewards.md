---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/capacitor": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/vue": patch
"@mushi-mushi/svelte": patch
"@mushi-mushi/angular": patch
"@mushi-mushi/cli": patch
"@mushi-mushi/plugin-sdk": patch
"@mushi-mushi/plugin-sentry": patch
---

Release the unreleased SDK backlog accumulated since v0.5.0 (`cf27d81`,
2026-05-10). Twelve commits landed on master without a matching
changeset; this entry captures them in one coherent release so the
public changelog and downstream consumers stay in sync.

### Headless SDK (minor)

`MushiTrigger` (React + React Native) and `MushiAttach` (React) — wrap
any element or DOM selector to trigger the Mushi widget without the
floating button. The matching `SdkInstallCard` in the console now
generates copy/paste snippets for both patterns.

### QA Coverage Suite (minor)

Automated user-story tests run on cron through Playwright, Browserbase,
or Firecrawl. Ships with `qa_stories` / `qa_story_runs` /
`qa_story_evidence` schema, the `qa-story-runner` edge function, a
pluggable browser-provider abstraction, and the full admin UI
(`QaCoveragePage` + `QaCoverageTile`, live-polling drawer, evidence
viewer, assertion-failure table).

### Rewards program (minor)

End-user rewards across all layers: `end_users`, `reward_rules`,
`reward_tiers`, `end_user_points`, `end_user_activity`,
`reward_webhooks` (with the `apply_activity_points` trigger keeping
denormalized totals in sync), GDPR `export_end_user_data()` RPC and
DELETE cascade, configurable point rules (replacing the hardcoded
`POINT_TABLE`) with a 60s in-memory cache + `invalidateRuleCache()`
escape hatch, and new API scopes `activity:write` / `rewards:read`.
Stripe Connect onboarding + monetary payouts gated on Enterprise
entitlement; monthly cron via the `reward-payout-aggregator` edge
function.

### Native parity bump (Cocoapods / Maven only — not in this npm release)

iOS and Android SDKs reached 0.4.0 web parity (BreadcrumbCollector,
ProactiveDetector, PIIScrubber, ExceptionNormaliser). The Capacitor
wrapper now re-exports `addBreadcrumb` / `getBreadcrumbs` and the
new native APIs through `@mushi-mushi/capacitor` (web fallbacks
no-op). Subsequent P0/P1 fixes addressed slow-screen false positives
on backgrounding, Android `decorView.OnTouchListener` clobber via a
chained `Window.Callback`, activity/view leaks via weak references,
iOS Capacitor's silent `[String: Any] -> [String: String]` cast
dropping non-string breadcrumb data, and iOS `Mushi` singleton
thread-safety (mirrors Android's `synchronized(this)` discipline via
a private `NSLock`).

### Data pipeline loop closure (mostly server, surfaced patches in plugins/SDK)

`fix_corpus` (pgvector) + `match_fix_corpus` RPC give the fix-worker
in-context retrieval of the 3 most semantically similar past PRs.
`fix_attempts.failure_category` (CHECK enum) categorises failures
(`sandbox_timeout` / `llm_invalid_json` / `github_403` /
`scope_blocked` / `embedding_failed` / `rag_empty` / …) and feeds the
new `failureBreakdown` histogram in `/v1/admin/fixes/summary`.
`report_comments.feedback_signal` lets reporters mark replies as
`confirms` / `wrong_target` / `noise` so the loop closes against
human signal.

### Spec-traceability (patch)

`_shared/spec-validation.ts` mirrors `agents/review.ts`'s
`validateAgainstSpec` so the Deno fix-worker runs the same pre-PR
contract gate without importing the Node-only `@mushi-mushi/agents`
package. Hard violations land on
`fix_attempts.spec_validation_warnings` as `ERR_*` codes; soft warnings
keep rendering as the existing amber "Spec N" badge.

### MCP server (minor)

`packages/mcp/src/catalog.ts` and `server.ts` gain ~108 lines of new
capability surface — the MCP server now exposes the Migration Hub
catalog and additional admin resources to AI agents speaking the
Model Context Protocol.

### Plugin packaging (patch)

PR #98 fixed the six new plugin packages (`plugin-bugsnag`,
`plugin-crashlytics`, `plugin-discord`, `plugin-github-issues`,
`plugin-msteams`, `plugin-rollbar`) that had shipped with
`"@mushi-mushi/plugin-sdk": "workspace:*"` — Changesets only rewrites
`workspace:^` and `workspace:~` specifiers to real semver ranges at
publish time, so `workspace:*` leaked into the published tarball and
broke `npm install` for end users with `EUNSUPPORTEDPROTOCOL`. The
publish-time guard `scripts/check-workspace-protocol.mjs` is what
caught the regression; pattern now matches the rest of the
publishable plugins.

### Adjacent

- Patch + minor dependency bumps across the workspace respecting the
  7-day cooldown (`@sentry/vite-plugin`, `@tailwindcss/vite`, `jose`,
  `postcss`, `react-router-dom`, `svelte`, `tailwindcss`, `turbo`,
  `typescript`, `vite`, `vitest`).
- 7 pending database migrations applied (rule promotion atomicity,
  managed-prompt seeds, `updated_at` trigger coverage,
  RLS-initplan rewrites, anon SECURITY DEFINER revokes, `pg_graphql`
  anon-SELECT lockdown). Net Supabase advisor improvement:
  222 WARN → 123 WARN (remaining are intentional).

### Notes for reviewers

This changeset bundles real shipped work — every commit referenced
above is already on the branch and was tested at the time of merge.
It does not pull in any uncommitted WIP from the working tree (e.g.
admin's in-progress `LessonsPage` / `DriftPage` / `BetaBanner`, the
new edge functions that aren't wired into `api/index.ts` yet, or the
unpublished `mushi sync-lessons` CLI command). Those land in
subsequent changesets when their underlying server endpoints exist
and have been tested end-to-end.
