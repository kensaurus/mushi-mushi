# @mushi-mushi/node

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
