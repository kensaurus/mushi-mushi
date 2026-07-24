# @mushi-mushi/node

## 1.2.0

### Minor Changes

- b5fb780: Add Linear integration — `LinearConnector` in `@mushi-mushi/node` for programmatic OAuth management and connection status, plus updated `@mushi-mushi/plugin-linear` routing to use the new platform integration API.
- b858f5d: Phase 3 / Phase 5 non-deploy completion (production-readiness uplift, Jul 2026):

  **`@mushi-mushi/node` — test uplift (Phase 3 DX/TEST)**
  - `unhandled.test.ts` (6 tests) — verifies `attachUnhandledHook` fires `captureReport` on `unhandledRejection` and `uncaughtException`, coerces non-Error reasons, respects `swallowCrashes`, uses custom `component` label, and teardown removes both process listeners.
  - `otel.test.ts` (12 tests) — verifies `createOtelSpanProcessor` active path: ERROR span → `captureException`, traceparent inclusion, span-name fallback, non-error skip when `errorsOnly=true`, OTLP fetch POST shape, OTLP env-var headers, OTLP object-headers, shutdown/forceFlush no-throw.

  **`@mushi-mushi/mcp` — `use_mushi` meta-tool + X-RateLimit headers (Phase 5)**
  - `use_mushi` tool registered in `server.ts` and `catalog.ts`: intent-aware orientation tool returning a curated subset of 6–12 relevant tool names for the caller's stated intent, a project-aware orientation paragraph, and a recommended first tool. Mirrors Sentry's `use_sentry` context-cost-reduction pattern.
  - `USE_MUSHI_INTENTS` map in `catalog.ts`: 6 intent clusters (fix, status, setup, qa, pipeline, audit) each with curated tool lists and hint text.
  - `buildRateLimitHeaders()` in `_shared/mcp-rate-limit.ts`: produces `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy`, and `Retry-After` (on 429) headers conforming to IETF draft-ietf-httpapi-ratelimit-headers-06 (same format as GitHub, Linear, Stripe). Published limits: 120/min tools-call, 60/hr nl_query.

  **`@mushi-mushi/cli` — Phase 4 `printResult()` migration**
  - `diagnostics.ts` `test` command: migrated from `if (opts.json)` to `printResult()` — respects both per-command `--json` (alias) and global `-o json`.
  - `diagnostics.ts` `index` command: migrated to `outputIsJson()` for parity.
  - `reports.ts` (all 10 subcommands: list/thread/show/triage/resolve/reopen/verify/dismiss/reply/search) and `keys.ts` `list`: migrated to `printResult()`/`outputIsJson()` so global `-o json` works uniformly; per-command `--json` help text now reads "(alias for -o json)".

  **`@mushi-mushi/eslint-plugin-mushi-mushi` — typecheck fix**
  - `no-allowlist-jsx-textnode.ts`: annotated `create()` return as `Rule.RuleListener` so TypeScript's index-signature check accepts the JSX visitor overloads. No behaviour change.

  **`@mushi-mushi/cli` — `mushi keys rotate` (Phase 2)**
  - New `keys rotate` command: re-runs device auth inline, mints a fresh project API key for the same project, saves it to local config. Prints old/new key prefixes and a reminder to revoke the predecessor in the console (server-side revoke needs jwtAuth, CLI-token revoke endpoint is a tracked follow-up).

  **Supabase migrations (deployed to production `dxptnwrhwsqckaftyymj`)**
  - `20260720000001_add_rotated_from_to_project_api_keys.sql`: adds `rotated_from UUID REFERENCES project_api_keys(id)` + sparse index to support key rotation lineage. (`revoked_at` was already present from an earlier migration.)

  **Supabase edge functions — `mcp/index.ts` (code-only, deploy via `supabase functions deploy mcp`)**
  - `buildRateLimitHeaders()` now imported and wired into the POST `tools/call` response path: every tool-call response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy` headers (IETF draft-06 format). On rate-limit miss (`ERR_RATE_LIMITED = -32001`), also adds `Retry-After`.
  - The `?features=` curated-tool filter (`parseFeaturesParam` / `toolMatchesFeatures`) was already wired in `feature-groups.ts` — no additional change needed.

  **Supabase edge functions — `_shared/validate.ts` (code-only, deploy via function deploys)**
  - Changed from `npm:zod@4` → `npm:zod@3` for consistency with `classify-report` / `fast-filter` (avoids dual-version bundle bloat).
  - `ApiReportBodySchema`: `description` changed from required `.min(1)` to optional (backward-compat; legacy SDK < v1.21 doesn't always include it). Added `.passthrough()` so unknown keys (console_logs, breadcrumbs, screenshot_url, etc.) are preserved — prevents data loss when schema is used alongside `ingestReport`.

- 76ec932: **SDK: PII scrubbing, XHR capture, hash-router inventory, and Node middleware hardening**

  ### @mushi-mushi/core
  - New `scrubUrl(url, options?)` export: scrubs sensitive query-param keys (`token`, `password`, `api_key`, `secret`, `auth`, `session`, `email`, `phone`, `ssn`, JWT-shaped values under innocent keys) to `[Scrubbed]`, decodes percent-encoding before matching, handles hash-router query fragments (`#/path?query`), and never throws on malformed input.
  - New `scrubPii(text)` export: redacts emails → `[REDACTED_EMAIL]`, phones → `[REDACTED_PHONE]`, JWT-shaped tokens (three dot-separated `eyJ…` segments) → `[REDACTED_JWT]`, SSNs → `[REDACTED_SSN]`, and CC-shaped strings → `[REDACTED_CC]`.

  ### @mushi-mushi/web
  - **Global XHR capture**: `init()` now patches both `XMLHttpRequest` and `window.fetch`. Every network request — including legacy jQuery/axios XHR calls — is captured as a `MushiNetworkEntry` and appears in the Network breadcrumbs tab. `destroy()` removes the patches; if another APM tool (Sentry, Datadog) has since wrapped the same globals the SDK detects the unsafe state and leaves the native references alone.
  - Network entries include `captureMethod: 'fetch' | 'xhr'` and an optional `correlationId` linking to synchronous console errors captured during the same request. URLs are PII-scrubbed at capture time (before truncation).
  - **Hash-router inventory**: `discovery` now subscribes to `hashchange` and stores `'/#' + hashPath` entries so hash-routed SPAs appear in Inventory. `routeTemplates` authored with or without the `/#` prefix are both matched. Hash query params (`#/path?key=value`) are stripped before template matching; param _keys_ (never values) are still collected for filter metadata.
  - Timeline route/href fields are now passed through `scrubUrl` before storage.
  - `beforeSend` hook 2s timeout now applies per-report (not globally).

  ### @mushi-mushi/node
  - `captureReport` scrubs `description`, `environment.url`, `error.message`, and `error.stack` before the payload leaves the process.
  - `mushiExpressErrorHandler` scrubs `req.originalUrl` with `scrubUrl` before embedding it in the report description.
  - `mushiTraceMiddleware` scrubs the request URL for span names and `http.url` trace attributes.
  - `mushiExpressErrorHandler` and `ExpressMiddlewareOptions` are now exported from the main entry point (`@mushi-mushi/node`).

  ### @mushi-mushi/cli
  - `mushi doctor --host-app` (Check 7b) detects `HashRouter`/`createHashRouter`/`location.hash`/`hashchange` in host source files and warns when `/#/`-prefixed `routeTemplates` are missing from the Mushi init call. Advisory-only; runs under `--full` mode.

### Patch Changes

- Updated dependencies [b858f5d]
- Updated dependencies [76ec932]
  - @mushi-mushi/core@1.27.0

## 1.1.1

### Patch Changes

- 90bc9d5: Refresh the published README for the rewards webhook receiver (`createMushiRewardsHandler`) with the current Express + Web-standard `fetch` usage examples.
- Updated dependencies [90bc9d5]
  - @mushi-mushi/core@1.21.0

## 1.1.0

### Minor Changes

- 679b158: Add a turnkey reward-webhook receiver for host backends.

  `createMushiRewardsHandler({ secret, onTierChanged, onPointsAwarded })` returns a framework-agnostic handler (Express middleware + Web-standard `fetch` handler) that timing-safely verifies the `X-Mushi-Signature` HMAC and routes Mushi reward events — the host-side "grant a role / grant a membership" trigger. Also exports `verifyRewardSignature` and `parseRewardEvent`, plus the `MushiRewardEvent` / `MushiTierChangedEvent` / `MushiPointsAwardedEvent` types.

### Patch Changes

- Updated dependencies [679b158]
  - @mushi-mushi/core@1.17.0

## 1.0.0

### Major Changes

- bba5664: Graduate capacitor, node, vue, svelte, and angular to v1.0.0 — the coordinated stable release across all platform SDKs.

  These packages have been in 0.x "pre-production" labelling despite being widely used in production. The API surface is stable and locked by tests. This major bump signals production-readiness and aligns the full `@mushi-mushi/*` suite on 1.x semver so new teams aren't deterred by 0.x labels.

  Breaking changes from 0.x:
  - `@mushi-mushi/vue`: `MushiPlugin` no longer requires a second `Mushi.init()` call or separate `@mushi-mushi/web` install — the plugin handles it internally. Remove any explicit `Mushi.init(config)` call when using `MushiPlugin`.
  - `@mushi-mushi/svelte`: `initMushi()` no longer requires a second `Mushi.init()` call. Remove explicit `Mushi.init(config)` calls.
  - `@mushi-mushi/angular`: `provideMushi()` no longer requires a second `Mushi.init()` call. Remove explicit `Mushi.init(config)` calls.
  - `@mushi-mushi/react-native`: `MushiProvider` now also accepts a `config` prop (object shape) as an alias to bare props, and reads env vars when neither is supplied.
  - `@mushi-mushi/node`: stable 1.0 API — `MushiNodeClient`, `attachUnhandledHook`, framework adapters. No functional changes from 0.x.
  - `@mushi-mushi/capacitor`: stable 1.0 API — `Mushi.configure()` is the canonical init call (not `Mushi.init()`). API key format is now consistently `mushi_*`.

## 0.6.0

### Minor Changes

- 144906a: Integrations & QA notification wave, plus correctness/security hardening.

  **Web SDK** — Added opt-in W3C trace-context propagation: when `capture.tracePropagation.enabled` is set with a `corsUrls` allowlist, outbound fetch requests carry `traceparent` and `x-mushi-session` headers and the generated `traceId` is recorded on the network entry, so frontend reports correlate with backend spans. Fixed a wiring bug where the config and session id were never passed through to the network capture, leaving the feature unreachable.

  **Node SDK** — New Express/Hono-style middleware (`@mushi-mushi/node`) that reads `traceparent` / `x-mushi-session` and posts backend spans to `/v1/ingest/spans` for trace correlation.

  **CLI** — New `integrations`, `slack`, `qa`, `tdd`, and `keys` commands. `mushi doctor --qa-stories` now queries the real `/qa-coverage` endpoint (the previous `/qa-stories` list path returned 404).

  **MCP** — New TDD and notification tools. `get_qa_story_run` now resolves the run via the runs list instead of a non-existent single-run route.

  **plugin-slack-app** — Manifest OAuth redirect URL and scopes corrected.

  **Security** — Slack OAuth `state` is now HMAC-signed and verified (with expiry and constant-time comparison) on the callback, closing a cross-tenant token-write vector, and the OAuth `redirect_uri` now points at the registered Supabase functions callback. (Server-side; ships via the edge-function deploy.)

### Patch Changes

- Updated dependencies [144906a]
  - @mushi-mushi/core@1.9.0

## 0.5.1

### Patch Changes

- a7d6ae8: Release tester marketplace, rewards program, dispatch preflight, proactive triggers, and SDK improvements.

  ## @mushi-mushi/core
  - Add `MushiReputationResult`, `MushiTierResult`, `MushiActivityEvent` types for the rewards subsystem.
  - Add `pulseTrigger()` method to `MushiSDKInstance` interface — briefly animates the bug-report trigger to invite feedback without opening the widget.
  - Add `inpAttribution` field to `MushiPerformanceMetrics` for detailed INP breakdown (eventType, targetSelector, inputDelay, processingDuration, presentationDelay).
  - Add `minDescriptionLength` to `MushiWidgetConfig` — enforces a minimum character count before the submit button enables.
  - Add `beforeSendFeedback` hook to `MushiConfig` — called before a report is dispatched; return `null` to cancel.
  - Add `onCrashedLastRun` hook to `MushiConfig` — called on init if the previous session ended in a crash.
  - Add `'report:dispatched'` to `MushiEventType`.

  ## @mushi-mushi/web
  - **Rewards subsystem** (`src/rewards.ts`): full tester-rewards API — `initRewards`, `updateRewardsUser`, `getTier`, `enqueueActivity`. Connects to `/v1/rewards/*` backend endpoints.
  - **Proactive triggers** (`src/proactive-triggers.ts`): schedule-based and event-based triggers that surface the widget at the right moment without developer code.
  - **`pulseTrigger()`**: widget-level pulse animation accessible from `Mushi.pulseTrigger()`.
  - **Screenshot simplification**: `screenshot.take()` now returns `Promise<string | null>` — callers no longer need to check an `{ ok, dataUrl }` result object.
  - **`beforeSendFeedback` + `onCrashedLastRun`**: lifecycle hooks wired into the init flow.

  ## @mushi-mushi/mcp
  - Refactored all tool registrations from the `registerScopedTool` wrapper to the canonical `server.tool()` API — removes a layer of indirection and aligns with the latest `@modelcontextprotocol/sdk` surface.
  - Added rewards management tools: `list_top_contributors`, `award_bonus_points`, `set_tier`, `promote_champion`.

  ## @mushi-mushi/cli
  - **`mushi project create`** command: provisions a new Mushi project, mints an API key with `mcp:read+write` scope, and writes `.env.local` + `.cursor/mcp.json`.
  - **`mushi doctor`**: pre-flight checks — verifies CLI config, endpoint reachability, SDK install, and optional server preflight.
  - **`mushi nudge`**: generates a paste-ready `Mushi.init()` snippet tuned for alpha / beta / ga release phases.
  - Improved `mushi init` prompts: clearer placeholders and error messages for Project ID and API key fields.

  ## @mushi-mushi/node
  - Remove stale `warnedOnce` variable and fix `buildNodeEnvironment` JSDoc comment separation that caused a syntax error on combined branches.

  ## @mushi-mushi/react

  **Breaking change**: `useMushi()` now returns `UseMushiResult` (`{ report, pulseTrigger, isReady }`) instead of the raw `MushiSDKInstance | null`. The raw instance accessor is now `useMushiSdk()`.

  **Migration**: replace `const sdk = useMushi(); sdk?.report()` with `const { report } = useMushi(); report()`.
  - New primary hook `useMushi()` returns a stable, destructurable `{ report, pulseTrigger, isReady }` — covers 90% of use cases without the optional-chain dance.
  - New `useMushiSdk()` replaces the old `useMushi()` for callers that need direct SDK access.
  - Re-export new core types (`MushiReputationResult`, `MushiTierResult`, `MushiActivityEvent`).
  - Export new `UseMushiResult` interface.

  ## @mushi-mushi/react-native
  - Updated peer dependency range for latest Expo SDK compatibility.

- Updated dependencies [a7d6ae8]
  - @mushi-mushi/core@1.6.0

## 0.5.0

### Minor Changes

- 0c66aa9: `AbortSignal` propagation.

  `MushiNodeClient` now accepts `signal?: AbortSignal` on the constructor
  (process-wide cancel — wire it to your shutdown hook so in-flight
  captures abort cleanly during graceful shutdown) and on
  `captureReport` / `captureException` (per-call cancel — wire it to your
  request signal so a cancelled request doesn't hold up the timeout).

  Multiple signals compose via a new `composeSignals` utility that delegates
  to the platform `AbortSignal.any` (Node ≥ 20, the minimum supported runtime).

### Patch Changes

- Updated dependencies
  - @mushi-mushi/core@1.5.0

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

### Patch Changes

- Updated dependencies [84118af]
  - @mushi-mushi/core@1.0.0

## 0.3.5

### Patch Changes

- Updated dependencies [5e04203]
  - @mushi-mushi/core@0.9.0

## 0.3.4

### Patch Changes

- Updated dependencies [ef0036d]
  - @mushi-mushi/core@0.8.0

## 0.3.3

### Patch Changes

- Updated dependencies [15462c8]
  - @mushi-mushi/core@0.7.0

## 0.3.2

### Patch Changes

- Updated dependencies [48858bb]
  - @mushi-mushi/core@0.5.0

## 0.3.1

### Patch Changes

- d4d6933: Growth plan — storefronts pass (2026-04-24)

  Phase 0 of the zero-budget 90-day growth plan: polishing the npm pages and
  README so they convert attention into stars and installs. No behaviour changes;
  metadata only.
  - **npm keyword arrays expanded across all 14 publishable packages.** Added
    discoverability terms developers actually type into npm search:
    `user-report`, `feedback-widget`, `sentry-alternative`, `auto-fix`,
    `llm-ops`, `ai-agent`, plus framework-appropriate specifics (e.g.
    `claude-code`, `codex`, `copilot` on `@mushi-mushi/mcp`). Keyword counts
    after the pass: 14–32 per package.
  - **README star CTA footer.** Added the bilingual _"もしMushi-chanのお役に立てたら、
    ⭐ をひとつ"_ line with links to the stargazers page, issue tracker, and
    Bluesky handle. Research says a single explicit star ask converts 2–5% of
    lurkers.
  - **New `docs/marketing/` folder** with the full growth kit: `VOICE.md`,
    `STOREFRONTS.md`, `snippets.md` (drafted hooks, Show HN, Reddit, LinkedIn,
    dev.to, Product Hunt, YouTube Short), `launch-week.md`, `content-plan.md`
    (8 compounding blog post outlines), `drip-channels.md` (11 awesome-lists,
    9 newsletter targets, Discord / Slack etiquette), `social-cadence.md`
    (Bluesky / X weekly rhythm), and `measurement.md` (the 5 numbers to watch
    each Friday).

  No SDK surface or runtime changes — safe to land before any launch week.

- Updated dependencies [d4d6933]
  - @mushi-mushi/core@0.4.1

## 0.3.0

### Minor Changes

- 71b2fe8: Full-PDCA dogfood hardening wave (2026-04-22).

  Web SDK:
  - New `@mushi-mushi/web/test-utils` entry-point exposing `triggerBug()`,
    `openReport()`, and `waitForQueueDrain()` for deterministic Playwright
    round-trips. Import from `@mushi-mushi/web/test-utils` — zero cost at
    runtime for production bundles.
  - Tightened size-limit budget to 15 KB gzipped (previously 30 KB
    uncompressed). No API changes.

  Core SDK:
  - No code changes; bumped for consistency with the `web` SDK so
    downstream frameworks pick up the new test-utils exports transitively.

  Framework SDKs (react / vue / svelte / angular / react-native /
  capacitor / node):
  - No code changes. Coupled minor bump so the workspace stays on a single
    MAJOR.MINOR track; patch-only drift across adapters has historically
    caused dependency-resolution confusion for customers.

  Launcher:
  - Rewired the Claude Code agent adapter behind the new
    `MUSHI_ENABLE_CLAUDE_CODE_AGENT=1` flag and wired it up to the local
    `claude` CLI (binary path overridable via `MUSHI_CLAUDE_CODE_BIN`).
    The README "Status" column now reflects "working — opt-in".

### Patch Changes

- Updated dependencies [71b2fe8]
  - @mushi-mushi/core@0.4.0

## 0.2.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

- Updated dependencies [6e01dc7]
  - @mushi-mushi/core@0.3.1

## 0.2.0

### Minor Changes

- 81336e9: Initial release — `@mushi-mushi/node` server-side instrumentation SDK.
  - Framework middleware: Express (`/express`), Fastify (`/fastify`), Hono (`/hono`).
  - `attachUnhandledHook()` for `unhandledRejection` / `uncaughtException` → Mushi reports.
  - Automatic W3C Trace Context + `sentry-trace` header propagation for bidirectional Sentry/Datadog correlation.
  - Never throws — transport failures warn once and continue so instrumentation can't take down the host service.

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/core@0.3.0
