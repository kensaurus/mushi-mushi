# @mushi-mushi/plugin-sdk

## 0.5.0

### Minor Changes

- Cursor Cloud Agent integration — dispatch a Cursor Cloud Agent to auto-fix classified reports.

  ## New package: `@mushi-mushi/plugin-cursor-cloud`

  First-party Mushi Marketplace plugin that dispatches a Cursor Cloud Agent run when qualifying events fire (`report.classified`, `fix.requested`, `qa_story.failed`). The agent opens a signed draft PR automatically — no manual triage required.

  Install from Admin → Marketplace → Cursor Cloud Agent, supply your API key and workspace ID, and configure per-severity severity gating. The plugin calls the Cursor REST API directly (no `@cursor/sdk` peer dep needed at the call site — the SDK is node-only and used only in the Path B orchestrator).

  ## `@mushi-mushi/plugin-sdk` — new events

  Three new event names added to `MushiEventName`:
  - `fix.requested` — fires when a fix dispatch has been requested, before the agent launches.
  - `qa_story.failed` — fires when a QA story run fails all its assertions.
  - `qa_story.passed` — fires when a QA story run passes.

  Corresponding sample envelopes added to the `mushi-plugin simulate` CLI for local development.

  ## `@mushi-mushi/cli` — `mushi fix` command

  New `fix` verb for dispatching an agentic fix from the terminal:

  ```bash
  mushi fix <reportId> --agent cursor_cloud --model composer-latest --wait
  ```

  Options: `--agent`, `--model`, `--no-auto-pr`, `--wait` (polls until terminal state; exits non-zero on failure). Streams structured events to stdout — JSON when piped, human-readable in a TTY. Integrates cleanly with CI pipelines.

  ## `@mushi-mushi/mcp` — `dispatch_fix` Cursor Cloud support

  `dispatch_fix` tool extended with:
  - `agent` enum: `claude_code | codex | rest_worker | mcp | cursor_cloud`
  - `backend` alias (deprecated — prefer `agent`)
  - `cursorModel` optional override when `agent = cursor_cloud`
  - `outputSchema` returns `{ fixId, status, agentId?, runId?, prUrl? }` — typed output for modern MCP clients

  ## `@mushi-mushi/core` — `report:dispatched` event

  New `MushiEventType` value `'report:dispatched'` emitted by the Web SDK after a report is submitted if the backend auto-dispatched a Cursor Cloud Agent fix. Host pages can subscribe to show a toast or update the UI.

## 0.4.2

### Patch Changes

- 506df78: Release the full SDK + closed-loop evolution backlog since v0.5.0
  (`cf27d81`, 2026-05-10). Covers headless SDK, QA Coverage Suite,
  rewards program, native 0.4.0 parity, closed-loop Phases 0–6, and
  operator UX hardening for beta users.

  ### Headless SDK (minor — core / web / react / react-native)

  `MushiTrigger` (React + React Native) and `MushiAttach` (React) — wrap
  any element or DOM selector to trigger the Mushi widget without the
  floating button. The matching `SdkInstallCard` in the console now
  generates copy/paste snippets for both patterns.

  ### QA Coverage Suite (minor — core / web)

  Automated user-story tests run on cron through Playwright, Browserbase,
  or Firecrawl. Ships with `qa_stories` / `qa_story_runs` /
  `qa_story_evidence` schema, the `qa-story-runner` edge function, a
  pluggable browser-provider abstraction, and the full admin UI
  (`QaCoveragePage` + `QaCoverageTile`).

  ### Rewards program (minor — core / web / react / react-native)

  End-user rewards across all layers: configurable point rules,
  GDPR export, Stripe Connect payouts (Enterprise-gated), multi-step
  quests, SDK activity batching + tier badges, MCP catalog tools
  (`list_top_contributors`, `award_bonus_points`, `set_tier`).

  ### Closed-loop evolution — CLI + MCP (minor)
  - **`mushi sync-lessons`** — pulls promoted lessons from
    `/v1/admin/lessons` and writes `.mushi/lessons.json` into the
    connected repo (supports `--dry-run` and `--json`). Designed for
    CI and scheduled refresh PRs.
  - **MCP** — `lessons.query(diff_text, max_tokens)` tool for
    token-budget-ranked lesson injection into agent / PR-review flows;
    expanded catalog surface for Migration Hub and closed-loop resources.

  ### Native parity (Capacitor minor; iOS/Android via Cocoapods/Maven)

  Capacitor re-exports `addBreadcrumb` / `getBreadcrumbs` and the 0.4.0
  native parity modules (BreadcrumbCollector, ProactiveDetector,
  PIIScrubber, ExceptionNormaliser). iOS/Android SDKs ship at 0.4.0 via
  native package managers — not npm.

  ### Plugin packaging (patch)

  PR #98 fixed six plugin packages that shipped with `workspace:*`
  instead of `workspace:^`, which broke `npm install` for end users.

  ### Patch surfaces
  - `@mushi-mushi/{vue,svelte,angular}` — re-export headless trigger helpers.
  - `@mushi-mushi/plugin-sentry` — expanded inbound adapter surface.
  - `@mushi-mushi/plugin-sdk` — event schema extensions for rewards +
    experiment hooks.

  ### Server + admin (not in this npm release)

  The following ship via Supabase Edge Functions + admin deploy, not npm:
  - Closed-loop Phases 1–6: mistake clustering, releases + credits, PDCA
    iterate loop, contract drift walker, A/B experiments, anomaly detection,
    `/cost` panel.
  - Beta banner + structured project-create error UX + personal-org
    bootstrap on signup.
  - Seven new admin tabs: `/lessons`, `/releases`, `/iterate`, `/drift`,
    `/experiments`, `/anomalies`, `/cost`.
  - Docs: `closed-loop.mdx`, `EvolutionDiagram`, `LoopComparison`.
  - `SELF_HOSTED.md` updated with `mushi.edge_function_post()` cron
    patterns (replaces broken `current_setting('app.settings.*')` GUCs).

## 0.4.1

### Patch Changes

- 59627e2: Release the full SDK + closed-loop evolution backlog since v0.5.0
  (`cf27d81`, 2026-05-10). Covers headless SDK, QA Coverage Suite,
  rewards program, native 0.4.0 parity, closed-loop Phases 0–6, and
  operator UX hardening for beta users.

  ### Headless SDK (minor — core / web / react / react-native)

  `MushiTrigger` (React + React Native) and `MushiAttach` (React) — wrap
  any element or DOM selector to trigger the Mushi widget without the
  floating button. The matching `SdkInstallCard` in the console now
  generates copy/paste snippets for both patterns.

  ### QA Coverage Suite (minor — core / web)

  Automated user-story tests run on cron through Playwright, Browserbase,
  or Firecrawl. Ships with `qa_stories` / `qa_story_runs` /
  `qa_story_evidence` schema, the `qa-story-runner` edge function, a
  pluggable browser-provider abstraction, and the full admin UI
  (`QaCoveragePage` + `QaCoverageTile`).

  ### Rewards program (minor — core / web / react / react-native)

  End-user rewards across all layers: configurable point rules,
  GDPR export, Stripe Connect payouts (Enterprise-gated), multi-step
  quests, SDK activity batching + tier badges, MCP catalog tools
  (`list_top_contributors`, `award_bonus_points`, `set_tier`).

  ### Closed-loop evolution — CLI + MCP (minor)
  - **`mushi sync-lessons`** — pulls promoted lessons from
    `/v1/admin/lessons` and writes `.mushi/lessons.json` into the
    connected repo (supports `--dry-run` and `--json`). Designed for
    CI and scheduled refresh PRs.
  - **MCP** — `lessons.query(diff_text, max_tokens)` tool for
    token-budget-ranked lesson injection into agent / PR-review flows;
    expanded catalog surface for Migration Hub and closed-loop resources.

  ### Native parity (Capacitor minor; iOS/Android via Cocoapods/Maven)

  Capacitor re-exports `addBreadcrumb` / `getBreadcrumbs` and the 0.4.0
  native parity modules (BreadcrumbCollector, ProactiveDetector,
  PIIScrubber, ExceptionNormaliser). iOS/Android SDKs ship at 0.4.0 via
  native package managers — not npm.

  ### Hermes compatibility fix (react-native — patch within minor)

  `packages/react-native/src/provider.tsx` — replaced `new Function()` with
  dynamic `import()` (which Hermes 0.84 rejects with `SyntaxError`) with
  `require()` wrapped in `try/catch` for both `@react-native-community/netinfo`
  and `expo-sensors`. The `shake` and `network` auto-triggers now work correctly
  on all Hermes-based RN apps. Companion admin-console improvements:
  - `apps/admin/src/lib/frameworkDetect.ts` (new) — paste-your-`package.json`
    framework + monorepo detector (React, Vue, Svelte, RN/Expo/Capacitor,
    Angular, Vanilla; npm/yarn/pnpm workspaces, Turborepo, Nx, Lerna, Rush)
    with confidence scoring, ELI5 guidance, and Hermes version warnings.
  - `SdkInstallCard.tsx` — integrates the detector: framework tab is auto-
    selected and monorepo install guidance is surfaced on paste.
  - `McpPage.tsx` — collapsible monorepo detector panel for workspace-scoped
    `mushi-mcp` install guidance.
  - `ProjectsPage.tsx` — copyable `MUSHI_PROJECT_ID` chip under each project
    card (answers the #1 "where do I find my project ID?" support question).
  - `packages/mcp/src/index.ts` — actionable warning when `MUSHI_PROJECT_ID`
    is not set, with direct link to the console.

  ### Plugin packaging (patch)

  PR #98 fixed six plugin packages that shipped with `workspace:*`
  instead of `workspace:^`, which broke `npm install` for end users.

  ### Patch surfaces
  - `@mushi-mushi/{vue,svelte,angular}` — re-export headless trigger helpers.
  - `@mushi-mushi/plugin-sentry` — expanded inbound adapter surface.
  - `@mushi-mushi/plugin-sdk` — event schema extensions for rewards +
    experiment hooks.

  ### Server + admin (not in this npm release)

  The following ship via Supabase Edge Functions + admin deploy, not npm:
  - Closed-loop Phases 1–6: mistake clustering, releases + credits, PDCA
    iterate loop, contract drift walker, A/B experiments, anomaly detection,
    `/cost` panel.
  - Beta banner + structured project-create error UX + personal-org
    bootstrap on signup.
  - Seven new admin tabs: `/lessons`, `/releases`, `/iterate`, `/drift`,
    `/experiments`, `/anomalies`, `/cost`.
  - Docs: `closed-loop.mdx`, `EvolutionDiagram`, `LoopComparison`.
  - `SELF_HOSTED.md` updated with `mushi.edge_function_post()` cron
    patterns (replaces broken `current_setting('app.settings.*')` GUCs).

## 0.4.0

### Minor Changes

- 84118af: SDK Robustness + Integrator Glue — W3C Trace Context, Standard Webhooks, BYOK OTLP, MCP live resources, OAuth Dynamic Client Registration.

  This wave hardens Mushi as **the integrator layer** between your existing observability/incident tooling and the agentic fix loop. Mushi now propagates a single trace through every adapter, speaks the emerging webhook standard, exposes inventory + integration health as live MCP resources, and lets orchestrators self-onboard via RFC 7591.

  ### `@mushi-mushi/node` — distributed tracing + BYOK OTLP
  - **W3C `traceparent` end-to-end.** `MushiNodeClient.captureReport()` and the `express` / `fastify` / `hono` middlewares now extract the inbound `traceparent` header (or `payload.metadata.traceparent`) and forward it through Mushi → classify → fix dispatch → adapter calls. Your customer APM (Sentry, Datadog, Honeycomb, Tempo, Jaeger) shows one unbroken trace from "user clicks report" through "PR opens" without any host-app glue.
  - **`createOtelSpanProcessor()` upgraded.** New optional `OtelSpanProcessorOptions` — set `errorsOnly: false` to forward all sampled spans, or set `otlpEndpoint` / `otlpHeaders` to fan out to your own OTLP/HTTP+JSON collector (BYOK; defaults read `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`).
  - No breaking changes — the existing `errorsOnly: true` default behaviour and the legacy `captureReport()` signature both continue to work.

  ### `@mushi-mushi/mcp` — live resources + spec traceability
  - **`inventory://current`** resource — exposes the latest inventory snapshot to MCP clients with live `notifications/resources/updated` events when a new `inventory.yaml` is ingested. No more polling; LangGraph / OpenAI Agents / Claude Desktop see the new spec the moment it lands.
  - **`project://integration-health`** resource — last-known status for every BYOK channel (Jira, Linear, GitHub, PagerDuty, Slack, Datadog, Sentry, Honeycomb, Crashlytics, Bugsnag, Rollbar, MS Teams, Discord, Opsgenie, CloudWatch, Firebase Analytics, Grafana Loki, New Relic, Bugsnag) so an orchestrator can pre-flight before dispatching a fix.
  - **`dispatch_fix` accepts `inventoryActionNodeId`** — optional spec-traceability anchor (whitepaper §2.10). The fix-worker skips the graph walk and includes the Action's `expected_outcome` contract verbatim in the LLM prompt.
  - **`dispatch_fix` accepts `idempotencyKey`** — surfaces the new server-side `Idempotency-Key` header so a retried tool call can never double-dispatch.

  ### `@mushi-mushi/plugin-sdk` — Standard Webhooks + Idempotency-Key
  - **[Standard Webhooks](https://www.standardwebhooks.com/) signature verification.** Mushi now emits both legacy `X-Mushi-Signature` AND the standard `webhook-id` / `webhook-timestamp` / `webhook-signature` headers. Plugins built with `createPluginHandler` automatically prefer the standard headers when present and fall back to legacy. Receivers using competing tooling (Hookdeck, Inngest, Convoy, Defang) verify Mushi events without custom code.
  - New exports: `verifyStandardWebhooksSignature(input)`, `buildStandardWebhooksHeaders(secret, body, id)`, `signHmacBase64(secret, payload)`. All HMAC compares run through `timingSafeEqual` so plugin authors can't accidentally implement a timing oracle.
  - The legacy verifier (`verifySignature`, `signPayload`) is **unchanged and unaffected** — existing plugins keep working.

  ### `@mushi-mushi/mcp-ci` — spec-traceability anchor in CI
  - The GitHub Action gains an optional `inventory-action-node-id` input on `command: dispatch-fix`. Wire it into your CI pipeline when the fix is dispatched in response to a known Action node so the worker can short-circuit the graph walk and gate on the Action's `expected_outcome`.

  ### Server-side changes already shipped (no SDK action required)
  - **OAuth 2.0 Dynamic Client Registration** (`POST /v1/admin/auth/register`, [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)) — orchestrators self-onboard with an initial-access API key and receive `client_id` / `client_secret`. Audit-logged + cross-tenant safe (caller can only register clients in projects they own/admin).
  - **Idempotency-Key middleware** on `POST /v1/admin/fixes/dispatch` and `POST /v1/a2a/tasks` — RFC-style replay-on-retry, scoped by authenticated `user_id` (not body-supplied projectId) so a logged-in user cannot pollute another user's key namespace. JSON 2xx/4xx responses cached for 24h; 5xx and SSE responses always re-execute.
  - **`.well-known/agent-card`** discovery doc bumped to `schemaVersion: 1.0`, advertises the new tracing / webhooks / idempotency / dynamic-registration / `Last-Event-Id` capabilities.
  - **`GET /v1/admin/integrations/health`** — live integration health probe summary (status, latency, last-checked, source).
  - **`GET /v1/admin/inventory/:projectId/agents.md`** — auto-generated Markdown manifest of every Action node + open report for human/LLM consumption (also `?format=json`).
  - **`Last-Event-Id` resume** on `/v1/admin/fixes/dispatch/:id/stream` and `/v1/a2a/tasks/:id:subscribe` — clients reconnect after a network blip and replay missed `fix_events` without losing the trace.
  - **42 missing FK indexes added**, 8 RLS policies rewritten with `(SELECT auth.uid())` initplan pattern, `citext` extension moved out of `public` (Supabase advisor cleanup wave).

  ### Migration

  No breaking changes for any of the four packages. All new functionality is additive and opt-in:
  - Existing `captureReport({ ...payload })` calls work unchanged — `traceparent` is propagated automatically when the inbound request carries one.
  - Existing `createOtelSpanProcessor(client)` calls work unchanged — the second argument is optional.
  - Existing plugins keep verifying via `verifySignature` — the dual-header emission is transparent.
  - Existing `dispatch_fix` MCP tool calls work unchanged — `idempotencyKey` and `inventoryActionNodeId` are optional fields.

## 0.3.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

## 0.3.0

### Minor Changes

- 81336e9: Wave G3 — plugin marketplace deepens from webhooks to first-class apps.
  - `@mushi-mushi/plugin-sdk`: runtime Zod-like event envelope validation (`event-schema`) and a `mushi-plugin` dev CLI with `simulate | sign | verify` for local plugin development.
  - `@mushi-mushi/plugin-jira` (new): Atlassian OAuth 2.0 (3LO) + PKCE install flow, `JiraClient` for create / transition / comment, bidirectional handler that maps Mushi events (`report.created`, `status.changed`, `fix.applied`) to Jira issue lifecycle.
  - `@mushi-mushi/plugin-slack-app` (new): Slack App manifest, request-signature verification, OAuth v2 install, `/mushi` slash command router (replaces the legacy incoming-webhook-only plugin).

## 0.2.1

### Patch Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

## 0.2.0

### Minor Changes

- 7567cee: Plugin marketplace — initial public release.
  - **@mushi-mushi/plugin-sdk**: framework-agnostic plugin runtime with HMAC signature verification, replay protection (delivery-ID dedup), in-memory dedup store, and Express + Hono middleware adapters. Plugin authors register one async function per event name (or a wildcard `'*'` handler) and the SDK handles signature checks, JSON parsing, timeouts, and structured error responses.
  - **@mushi-mushi/plugin-linear**: official Linear adapter — turns `report.created` events into Linear issues with project + label routing.
  - **@mushi-mushi/plugin-pagerduty**: official PagerDuty adapter — escalates `report.dedup_grouped` and severity-tagged events into incidents on the configured service.
  - **@mushi-mushi/plugin-zapier**: official Zapier adapter — exposes Mushi events as a Zapier-compatible webhook source so non-engineers can route reports anywhere Zapier reaches.
