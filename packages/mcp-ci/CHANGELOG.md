# @mushi-mushi/mcp-ci

## 0.6.2

### Patch Changes

- 8516682: Dependency housekeeping — runtime major-version bumps.

  - **inventory-schema**: migrate to **Zod 4** (`zod@^4.4.3`), aligning with `@mushi-mushi/mcp` and `@mushi-mushi/agents`, which were already on v4. The public API is unchanged; the validation-issue path formatter now handles Zod 4's widened `PropertyKey[]` issue paths.
  - **cli**: bump `commander` to **v15** (ESM-only; the CLI is already pure ESM, so the change is transparent to consumers).
  - **mcp-ci**: bump `@actions/core` to **v3** (ESM-only, Node 24-ready; bundled via tsup).
  - **react-native**: build and test against **react-native 0.86**. `StyleSheet.absoluteFillObject` was dropped from RN 0.86's TypeScript types, so the backdrop style now inlines the equivalent absolute-fill literal — runtime behavior is identical and it compiles against all supported `react-native >= 0.72`.

## 0.6.1

### Patch Changes

- Dependency housekeeping — runtime major-version bumps.

  - **inventory-schema**: migrate to **Zod 4** (`zod@^4.4.3`), aligning with `@mushi-mushi/mcp` and `@mushi-mushi/agents`, which were already on v4. The public API is unchanged; the validation-issue path formatter now handles Zod 4's widened `PropertyKey[]` issue paths.
  - **cli**: bump `commander` to **v15** (now ESM-only; the CLI is already pure ESM, so the change is transparent to consumers).
  - **mcp-ci**: bump `@actions/core` to **v3** (ESM-only, Node 24-ready; bundled via tsup).
  - **react-native**: build and test against **react-native 0.86**. `StyleSheet.absoluteFillObject` was dropped from RN 0.86's TypeScript types, so the backdrop style now inlines the equivalent absolute-fill literal — runtime behavior is identical and it compiles against all supported `react-native >= 0.72`.

## 0.6.0

### Minor Changes

- 59d6fce: Reporter two-way loop + fix-merge surface across the SDKs.

  ## @mushi-mushi/core
  - Add reporter verify/reopen API client methods and the `not_fixed` feedback signal to the public types.

  ## @mushi-mushi/web
  - Reporter widget can confirm a fix (verify) or flag a regression (reopen), and opt into email delivery for status updates.

  ## @mushi-mushi/cli
  - New fix-merge lifecycle commands wired to the console merge endpoints.

  ## @mushi-mushi/mcp
  - New MCP tools: `merge_fix`, `refresh_ci`, and `reopen_report`; `transition_status` now covers the `verified` / `reopened` states.

  ## @mushi-mushi/mcp-ci
  - CLI surface updated for the new fix-merge and CI-refresh tools.

  ## @mushi-mushi/react-native
  - Bottom-sheet widget gains reporter verify/reopen actions and notification opt-in.

  ## @mushi-mushi/capacitor
  - Plugin definitions and web bridge updated for the reporter verify/reopen flow.

## 0.5.0

### Minor Changes

- 144906a: Integrations & QA notification wave, plus correctness/security hardening.

  **Web SDK** — Added opt-in W3C trace-context propagation: when `capture.tracePropagation.enabled` is set with a `corsUrls` allowlist, outbound fetch requests carry `traceparent` and `x-mushi-session` headers and the generated `traceId` is recorded on the network entry, so frontend reports correlate with backend spans. Fixed a wiring bug where the config and session id were never passed through to the network capture, leaving the feature unreachable.

  **Node SDK** — New Express/Hono-style middleware (`@mushi-mushi/node`) that reads `traceparent` / `x-mushi-session` and posts backend spans to `/v1/ingest/spans` for trace correlation.

  **CLI** — New `integrations`, `slack`, `qa`, `tdd`, and `keys` commands. `mushi doctor --qa-stories` now queries the real `/qa-coverage` endpoint (the previous `/qa-stories` list path returned 404).

  **MCP** — New TDD and notification tools. `get_qa_story_run` now resolves the run via the runs list instead of a non-existent single-run route.

  **plugin-slack-app** — Manifest OAuth redirect URL and scopes corrected.

  **Security** — Slack OAuth `state` is now HMAC-signed and verified (with expiry and constant-time comparison) on the callback, closing a cross-tenant token-write vector, and the OAuth `redirect_uri` now points at the registered Supabase functions callback. (Server-side; ships via the edge-function deploy.)

## 0.4.1

### Patch Changes

- 0c66aa9: Lock the Next.js App Router walker with regression tests.

  `walkNextAppRouter` had a 70-line route-derivation pipeline (route
  groups `(marketing)`, parallel slots `@auth`, private `_internal`,
  dynamic `[id]`, catch-all `[...slug]`) but zero tests — a future regex
  tweak would silently leak phantom routes into Gate 3.

  Round 8 adds vitest + 18 specs across `walkNextAppRouter`,
  `parseOpenApiFile`, and `discoverRoutes` — covering each segment-filter
  rule, dynamic-segment conversion, multi-method extraction, the
  `function GETSomething` substring guard, and the OpenAPI dedup path.

  No runtime behaviour change.

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

## 0.3.0

### Minor Changes

- 5e04203: Mushi v2 + v2.1 — bidirectional inventory + agentic-failure gates + passive SDK discovery.

  Mushi now models the **positive** side of your app (user stories, pages, elements, actions) alongside the negative reports it has always tracked, then verifies the two stay in sync via five pre-release gates and a synthetic monitor. New in v2.1: the SDK can passively discover routes / testids / outbound APIs and Claude drafts the inventory.yaml for you, so most teams will never hand-author one.

  **SDK (`@mushi-mushi/web` + `@mushi-mushi/core` + `@mushi-mushi/react`)**
  - New `capture.discoverInventory` config (off by default) — `Mushi.init({ capture: { discoverInventory: { enabled: true, captureDomSummary: true, throttleMs: 60_000, routeTemplates: ['/practice/[id]', '/tags/[slug]'], userIdSource: 'auto' } } })`. The SDK observes navigation, picks out `data-testid` attributes, the most prominent heading, and the recent network paths captured for repro, then POSTs a sparse, PII-safe payload to `/v1/sdk/discovery`. User identifiers are SHA-256 hashed in the browser; query string values are dropped (only the keys are kept).
  - New public types: `MushiDiscoverInventoryConfig`, `MushiDiscoveryEventPayload`.
  - New API client method: `postDiscoveryEvent`.

  **`@mushi-mushi/inventory-schema` (new package, 0.1.0)**
  - Zod + JSON-Schema source-of-truth for `inventory.yaml` v2 (`schema_version: 2.0`). Used by the admin ingester, the CI gate runner, the LLM proposer, and the GitHub Action.
  - Exports: `parseInventory` (yaml string → typed inventory), `validateInventory` (already-parsed object → typed inventory), `inventorySchema`, `inventoryJsonSchema`, `computeStats`, plus the per-node Zod schemas (`appSchema`, `pageSchema`, `elementSchema`, `userStorySchema`, `apiDepSchema`, `dbDepSchema`, `testRefSchema`, `authConfigSchema`).

  **`eslint-plugin-mushi-mushi` (new package, 0.1.0)**
  - Two rules wired into the v2 gate suite (Gates 1 + 2):
    - `mushi-mushi/no-dead-handler` — flags JSX props matching `/^on[A-Z]/` (and same-named object properties) whose handler body is empty (`() => {}`), returns only `null` / `undefined`, contains only `console.log` / `console.warn` calls, or `throw new Error('not implemented')`. Unwraps `useCallback` / `useMemo`, ignores `*.stories.*` / `*.test.*` / `*.spec.*` by default, and accepts a `// mushi-mushi-allowlist: <reason>` opt-out comment.
    - `mushi-mushi/no-mock-leak` — flags imports of `@faker-js/faker` / `faker` / `msw` / `nock` / `axios-mock-adapter` from non-test paths, arrays of placeholder objects with names like `John Doe` / `Jane Doe` (≥2 entries, ≥50% of array), and stringly-typed `lorem ipsum` / `placeholder@example.com` content. Test paths (`__tests__/`, `tests/`, `*.test.*`, `*.spec.*`, `*.mock.*`, etc.) are ignored entirely.
  - Ships a `recommended` config preset that turns both rules on at `error`.

  **`@mushi-mushi/mcp-ci` (0.2.2 → 0.3.0)**
  - Five new commands (also exposed via the `mushi-mushi-gates` GitHub Action):
    - `gates` — runs the v2 pre-release gates against a project and posts a composite GitHub status check.
    - `discover-api` — emits an OpenAPI / inventory contract doc from the project's current inventory snapshot.
    - `discovery-status` — prints a human-readable summary of routes / events / users / freshness from the SDK's discovery stream.
    - `propose` — kicks the LLM proposer for a project and waits for the draft to land.
    - `auth-bootstrap` — refreshes the crawler's authenticated session by running the `inventory.yaml` `auth.scripted` block via Playwright (used by the new `@mushi-mushi/inventory-auth-runner` service).
  - New action inputs / outputs documented in `packages/mcp-ci/README.md`; the GitHub Action `action.yml` exposes the new commands directly.

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
