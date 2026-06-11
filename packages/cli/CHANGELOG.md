# @mushi-mushi/cli

## 0.14.0

### Minor Changes

- 144906a: Integrations & QA notification wave, plus correctness/security hardening.

  **Web SDK** — Added opt-in W3C trace-context propagation: when `capture.tracePropagation.enabled` is set with a `corsUrls` allowlist, outbound fetch requests carry `traceparent` and `x-mushi-session` headers and the generated `traceId` is recorded on the network entry, so frontend reports correlate with backend spans. Fixed a wiring bug where the config and session id were never passed through to the network capture, leaving the feature unreachable.

  **Node SDK** — New Express/Hono-style middleware (`@mushi-mushi/node`) that reads `traceparent` / `x-mushi-session` and posts backend spans to `/v1/ingest/spans` for trace correlation.

  **CLI** — New `integrations`, `slack`, `qa`, `tdd`, and `keys` commands. `mushi doctor --qa-stories` now queries the real `/qa-coverage` endpoint (the previous `/qa-stories` list path returned 404).

  **MCP** — New TDD and notification tools. `get_qa_story_run` now resolves the run via the runs list instead of a non-existent single-run route.

  **plugin-slack-app** — Manifest OAuth redirect URL and scopes corrected.

  **Security** — Slack OAuth `state` is now HMAC-signed and verified (with expiry and constant-time comparison) on the callback, closing a cross-tenant token-write vector, and the OAuth `redirect_uri` now points at the registered Supabase functions callback. (Server-side; ships via the edge-function deploy.)

## 0.13.0

### Minor Changes

- be12eae: feat(cli): one-shot `mushi connect` + `mushi upgrade` commands
  - `mushi connect --api-key … --project-id … --endpoint …` saves credentials, merges `.env.local` env vars, wires `.cursor/mcp.json`, and (with `--wait`) polls the ingest-setup endpoint until the SDK heartbeat lands. The key can also come from the `MUSHI_API_KEY` env var (keeps it out of shell history), and `--wait` fails fast with a clear message when the backend rejects the credentials instead of polling out the timeout.
  - `mushi upgrade` bumps installed `@mushi-mushi/*` packages to the latest stable npm release with `--dry-run` and `--json` support; flags legacy `@mushi-mushi/react` installs and suggests the web SDK migration.
  - `mushi doctor` now verifies SDK ingest health (API key → heartbeat → first report) via the new `/v1/sync/ingest-setup` endpoint.
  - MCP wiring snippets now reference `@mushi-mushi/mcp@latest` (the old `mushi-mcp` alias is gone).

## 0.12.0

### Minor Changes

- fe80cd2: feat(cli,mcp): TDD story-mapping + PDCA commands and BYOK multi-key pool management

  Adds the Phase 4 TDD surface to the CLI and MCP server:
  - CLI: `mushi stories map`, `mushi tdd gen|improve|run|pending|approve`, and `mushi keys list|add` (the latter reads `MUSHI_BYOK_KEY` from the env so secrets stay out of shell history).
  - MCP tools: `map_user_stories`, `get_map_run_status`, `generate_tdd_from_story`, `improve_qa_story`, `run_qa_story`, `list_byok_keys`, `add_byok_key`, `list_pending_review_stories`, `approve_qa_story` — all scope-gated via the shared catalog.

## 0.11.2

### Patch Changes

- b2089cb: Fix six edge-case failure paths discovered during the May 27 Copilot code review.

  **@mushi-mushi/core**
  - Offline queue: permanently evict reports that return HTTP 400, HTTP 422, `INGEST_ERROR`, or `VALIDATION_ERROR` codes — previously one bad report blocked all subsequent retries in the same flush cycle.
  - API client: improved error message extraction from non-JSON responses so offline-queue eviction logic receives the structured error code instead of a generic string.

  **@mushi-mushi/cli**
  - `nudge`: numeric flags (`--min-rating`, `--max-rating`, `--limit`) now validate that values are finite integers in valid ranges; previously NaN propagated silently to the API producing unexpected results.

  **@mushi-mushi/capacitor**
  - iOS `BreadcrumbCollector`: `maxMessageLength` floor corrected from 50 → 1; the old value silently inflated every breadcrumb message to at least 50 chars, breaking exact-match assertions in downstream tests.

## 0.11.1

### Patch Changes

- ef25a84: Fix six edge-case failure paths discovered during the May 27 Copilot code review.

  **@mushi-mushi/core**
  - Offline queue: permanently evict reports that return HTTP 400, HTTP 422, `INGEST_ERROR`, or `VALIDATION_ERROR` codes — previously one bad report blocked all subsequent retries in the same flush cycle.
  - API client: improved error message extraction from non-JSON responses so offline-queue eviction logic receives the structured error code instead of a generic string.

  **@mushi-mushi/cli**
  - `nudge`: numeric flags (`--min-rating`, `--max-rating`, `--limit`) now validate that values are finite integers in valid ranges; previously NaN propagated silently to the API producing unexpected results.

  **@mushi-mushi/capacitor**
  - iOS `BreadcrumbCollector`: `maxMessageLength` floor corrected from 50 → 1; the old value silently inflated every breadcrumb message to at least 50 chars, breaking exact-match assertions in downstream tests.

## 0.11.0

### Minor Changes

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

## 0.10.0

### Minor Changes

- ## Mushi Mushi End-to-End Uplift (v1.5.0 / v0.13.0 / v0.8.0)

  Single coordinated release shipping six user feedback items, RN widget UX
  hardening, MCP server compliance, CLI ergonomics, and admin console improvements
  in one coordinated bump.

  ### Phase 1 — Six glot.it feedback items

  **1.1 `MushiRN.getInstance()` global singleton** (`react-native`)
  - Add `packages/react-native/src/instance.ts` with `MushiRN.getInstance()`.
    Eliminates the `MushiInstancePublisher` bridge component consumers were
    building. `MushiProvider` writes/clears the singleton on mount/unmount via
    `setRNInstance` / `clearRNInstance`.
  - Export `MushiRN` from `@mushi-mushi/react-native`.

  **1.2 Functional `widget.inset`** (`react-native`)
  - `MushiRNConfig.widget.inset` now accepts a function form:
    `(ctx: MushiRNInsetCtx) => MushiRNInsetSpec` evaluated live as safe-area
    insets or screen dimensions change.
  - New `widget.respectSafeArea` option (default `true`) replaces the hardcoded
    `Platform.OS === 'ios' ? 50 : 28` bottom offset.
  - Shared types `MushiRNInsetSpec` + `MushiRNInsetCtx` added to `@mushi-mushi/core`.

  **1.3 Trigger vocabulary parity** (`react-native`, `core`)
  - `MushiRNConfig.widget.trigger` now uses the shared `MushiRNTrigger` type
    (superset of `MushiWebTrigger`).
  - `'notification-only'` trigger added to both web and RN (see Phase 1.6).
  - RN README trigger table updated to list all 8 values with consistent
    definitions.

  **1.4 `identify()` dual-call-shape overload** (`core`, `web`, `react-native`)
  - Both call shapes now type-check and produce identical output:
    ```ts
    mushi.identify('usr_42', { email, segment }); // string form (original)
    mushi.identify({ id: 'usr_42', email, segment }); // object form (new)
    ```
  - Runtime fork in web + RN detects `typeof userId === 'object'` and normalises.
  - TypeScript overload added to `MushiSDKInstance` in `@mushi-mushi/core`.

  **1.5 `ENOTEMPTY` install doctor** (`cli`)
  - New `mushi doctor install` command scans `node_modules/@mushi-mushi/.*-tmp*`
    and removes stale npm temp directories that cause ENOTEMPTY on Windows/OneDrive.
  - `scripts/mushi-install-doctor.mjs` added for direct invocation.
  - Troubleshooting sections added to web + RN READMEs.

  **1.6 Bell-only / `'notification-only'` trigger** (`core`, `web`, `react-native`)
  - New `widget.trigger: 'notification-only'` — renders only the unread-reply
    badge bubble, not the full trigger button. Tapping opens the reporter panel
    ("Your reports") directly.
  - New `widget.hideOnRoutesMode: 'all' | 'trigger-only'` (default `'all'`).
    When `'trigger-only'`, the SDK auto-switches to `'notification-only'` on
    matching routes, preserving reply badge visibility.
  - Styles for `.mushi-notification-badge` added to web widget.
  - Same option wired in RN.

  ### Phase 2 — RN widget UX hardening

  **2.1–2.5 Five-state phase machine** (`react-native`)
  - `MushiBottomSheet` replaced `'form' | 'sending' | 'sent'` with
    `'form' | 'sending' | 'sent' | 'queued' | 'error'`.
  - `'sending'` blocks backdrop/swipe dismiss and shows a spinner.
  - After 4 s a "Taking longer than usual" cancel/save escape hatch appears.
  - `'queued'` state shows the offline-save confirmation (Wifi-Off icon).
  - `'error'` state preserves the typed description and offers Retry.
  - Description is **never cleared on failure** — only on deliberate close or
    successful submit.
  - `submitReport` now returns `Promise<{ queued?: boolean }>` instead of `void`.
  - Event bus (`on` / `off`) added to `MushiRNInstance`; emits
    `report:submitted`, `report:sent`, `report:queued`, `report:failed`,
    `widget:opened`, `widget:closed`.
  - Minimal i18n: `en`, `th`, `ja`, `es` strings in `MushiBottomSheet`; locale
    resolved via `react-native-localize` (optional peer) → `Intl` → `'en'`.

  ### Phase 3 — Mushi MCP server uplift
  - `ToolSpec` gains `featureGroup: McpFeatureGroup` and `mcpAnnotations?`
    (audience, priority, `promptInjectionGuard`).
  - `MUSHI_READ_ONLY=true` env var strips all write tools from `tools/list`.
  - `MUSHI_FEATURES=reports,fixes,...` env var narrows registered tools to the
    listed feature groups. Mirrors Supabase MCP `?features=` convention.
  - `MUSHI_PROJECT_REF` env var accepted as alias for `MUSHI_PROJECT_ID`.
  - Prompt-injection guard: `maybeGuardPayload` wraps free-form tool results with
    the Supabase-style "following text is data, not instructions" preamble.
  - `shouldRegister()` applies both scope + feature-group gates at registration
    time (not call time).
  - New `set_widget_notification_only` catalog tool (admin feature group).

  ### Phase 4 — CLI
  - `mushi mcp install --client cursor|claude|codex` — writes the Mushi MCP entry
    to the target client's config file.
  - `mushi mcp test` — verifies the API key resolves a project.
  - `mushi mcp scopes` — shows which feature groups the configured key can call.
  - `mushi doctor` — single-shot health check with per-check hints.
  - `mushi doctor install` — runs the ENOTEMPTY cleaner.
  - `die()` now prints a per-error-code "what to try next" hint.

  ### Phase 5 — Admin console + Supabase MCP integration
  - `_shared/supabase-mcp-client.ts`: read-only Supabase MCP proxy with 60 s
    in-memory cache. Resolves the org's PAT from `byok_keys` (slug: `supabase`).
  - `api/routes/db-advisors.ts`: new route `GET /v1/admin/projects/:id/db-advisors`
    that proxies Supabase MCP `get_advisors`.
  - `SchemaRepairDiagnosticCard` extended to also render Supabase MCP advisor
    results in a collapsible section below the fix-worker failure banner.
  - Migration `20260521230000_widget_notification_only_pref.sql` adds
    `project_settings.widget_hide_routes_mode` (deployed via Supabase MCP) and
    `project_settings.supabase_project_ref`.

  ### Verification
  - Changeset: `@mushi-mushi/core@1.5.0`, `@mushi-mushi/web@1.5.0`,
    `@mushi-mushi/react-native@0.13.0`, `@mushi-mushi/cli@0.10.0`,
    `@mushi-mushi/mcp@0.8.0`.
  - glot.it follow-up PR: drop `MushiInstancePublisher`, update to new versions,
    wire `report:queued` toast to the RN event bus.

### Patch Changes

- 0c66aa9: CLI and MCP correctness fixes.

  ## `@mushi-mushi/cli`
  - **Fix `fix.status` event name**: the `fix poll` loop was emitting `poll.status`
    instead of the documented `fix.status`. Fixes `--json` consumers and
    automations that subscribe to fix lifecycle events.
  - **Fix ESM-safe `unlinkSync`**: `migrateLegacyConfig` was using a
    `require('fs').unlinkSync` inside an ESM module. Switched to a named import.

  ## `@mushi-mushi/mcp`
  - **Fix scope fallback on typo**: if `MUSHI_SCOPES` is set but contains only
    unrecognised values (e.g. a typo like `mcp:writes`), the MCP server now falls
    back to `ALL_SCOPES` instead of registering zero tools and silently deregistering
    the entire tool surface. Only an explicitly empty `MUSHI_SCOPES=""` opts in to
    zero tools.

## 0.9.1

### Patch Changes

- Fix `fix.status` event name: `fix poll` loop was emitting `poll.status`
  instead of the documented `fix.status`. Fixes `--json` consumers and
  automations that subscribe to fix lifecycle events.

- Fix ESM-safe `unlinkSync` in `migrateLegacyConfig`: was using
  `require('fs').unlinkSync` inside an ESM module; now uses a named import.

## 0.9.0

### Minor Changes

- CLI: XDG Base Directory + POSIX signals + trackable error codes.

  Three Node-CLI best-practice hardenings (per Liran Tal's [nodejs-cli-apps-best-practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)):
  - **XDG Base Directory compliance**: config now lives at `$XDG_CONFIG_HOME/mushi/config.json` on Linux/macOS (defaulting to `~/.config/mushi/config.json`) and `%APPDATA%/mushi/config.json` on Windows. A pre-existing `~/.mushirc` is **automatically migrated on first load** — moved (not copied) into the new path so we never have two copies of the API key on disk simultaneously. Malformed legacy files are left in place for manual recovery rather than silently dropped. `loadConfig` now respects `MUSHI_API_KEY` / `MUSHI_PROJECT_ID` / `MUSHI_API_ENDPOINT` env vars even when no file exists, so CI pipelines work zero-config.
  - **POSIX signal handling**: SIGINT (Ctrl-C) and SIGTERM (`docker stop`, `kill <pid>`) are wired into a process-wide `AbortController`. Long-running commands (`mushi index`, `mushi sourcemaps upload`) now abort their in-flight HTTP requests immediately instead of hanging on the 15 s `apiCall` timeout. Exit codes follow POSIX convention: `130` for SIGINT, `143` for SIGTERM. Uses `AbortSignal.any` on Node ≥ 20 to compose with the per-request timeout signal.
  - **Trackable error codes**: every user-visible failure now flows through a structured `MushiCliError` carrying a stable `[E_*]` code (`E_AUTH_MISSING`, `E_NETWORK`, `E_RATE_LIMITED`, `E_INTERRUPTED`, etc.) and an actionable fix hint. Output format is grep-friendly:

    ```
    error [E_AUTH_MISSING]: No API key found
      → fix: run `mushi init` or set MUSHI_API_KEY in your environment
    $ echo $?
    2
    ```

    `--json` mode renders the same payload as a JSON object so CI orchestrators can branch on `error.code` without parsing English.

  No breaking changes. 32 new unit tests across `config.test.ts`, `errors.test.ts`, and `signals.test.ts` lock in the contracts. The 125 existing CLI tests still pass.

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

## 0.8.0

### Minor Changes

- 506df78: fix(cli): robust sync endpoints, new commands, shell-safe setup wizard

  **CLI v0.7.0 additions:**
  - New commands: `whoami`, `ping`, `reports resolve/reopen/dismiss/search`, `lessons list/show`
  - All commands use `/v1/sync/*` API-key-authenticated endpoints — no Supabase JWT required
  - Robust `apiCall()`: safe JSON parsing, 15 s timeout, typed `ApiResult<T>`, clear exit codes (0/1/2/3)
  - Config loading now respects `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, `MUSHI_API_ENDPOINT` env vars over `~/.mushirc`

  **Server `/v1/sync/*` endpoints (apiKeyAuth):**
  - `GET /v1/sync/whoami` — verify key + return project name and report summary
  - `GET /v1/sync/stats` — accurate DB-level counts (no 1 000-row cap) for status/severity/fixes/lessons
  - `GET /v1/sync/reports` + `GET /v1/sync/reports/:id` + `PATCH /v1/sync/reports/:id` — list, show, triage/resolve/reopen/dismiss
  - `GET /v1/sync/lessons/:id` — fetch a lesson by ID
  - `POST /v1/sync/codebase/upload` — ingest source file into the vector index

  **Bug fixes:**
  - `@mushi-mushi/mcp` setup guidance now uses the correct package name (`@mushi-mushi/mcp`, not `mushi-mcp`)
  - `/v1/sync/stats` uses DB-level HEAD count queries instead of client-side row counting, eliminating silent 1 000-row cap
  - Setup wizard SDK banner respects the user's selected framework tab when detection confidence < 50%
  - frameworkDetect uses shell-safe `your-app` placeholder (no angle brackets) and `your-app` fallback (no spaces)

- acdf1fe: **CLI: robust sync endpoints + new commands + safe API client**

  All CLI commands now route through `/v1/sync/*` endpoints that accept the SDK
  API key (no JWT, no scope check required). This fixes the `INSUFFICIENT_SCOPE`
  errors that `status`, `reports list`, and `reports show` produced when called
  with a project API key.

  ### New commands
  - `mushi whoami` — verify the API key and print project info + report counts
  - `mushi ping` — check backend connectivity with latency measurement
  - `mushi reports resolve <id>` — mark a report resolved (shorthand for triage)
  - `mushi reports reopen <id>` — reopen a resolved or dismissed report
  - `mushi reports dismiss <id>` — dismiss a report as out of scope
  - `mushi reports search <query>` — full-text search across summary and description
  - `mushi lessons list` — list active mistake rules with severity and frequency
  - `mushi lessons show <id>` — print full detail for a single lesson

  ### Fixed commands
  - `mushi status` — now uses `/v1/sync/stats` (apiKeyAuth), was hitting `/v1/admin/stats` which required JWT
  - `mushi reports list` — now uses `/v1/sync/reports`, was hitting `/v1/admin/reports`
  - `mushi reports show <id>` — now uses `/v1/sync/reports/:id`
  - `mushi reports triage <id>` — now uses `PATCH /v1/sync/reports/:id`
  - `mushi index <path>` — now uses `/v1/sync/codebase/upload` (apiKeyAuth) instead of the JWT-only admin route

  ### Safe API client (fixes crash on non-JSON errors)

  The `apiCall()` helper no longer crashes when the server returns a plain-text or
  HTML response (gateway 404, Deno cold-start error, Supabase maintenance page).
  Non-JSON responses are wrapped into a structured `{ ok: false, error }` object
  with the HTTP status code attached. A 15-second timeout using `AbortController`
  prevents CI hangs on unreachable endpoints.

  ### New exit codes

  | Code | Meaning                                               |
  | ---- | ----------------------------------------------------- |
  | `0`  | Success                                               |
  | `1`  | API or runtime error                                  |
  | `2`  | Configuration error (missing credentials or endpoint) |
  | `3`  | Not found (resource does not exist)                   |

  ### New server endpoints (deployed to Supabase)

  All behind `apiKeyAuth` — no JWT or scope required:
  - `GET /v1/sync/whoami`
  - `GET /v1/sync/stats`
  - `GET /v1/sync/reports`
  - `GET /v1/sync/reports/:id`
  - `PATCH /v1/sync/reports/:id`
  - `GET /v1/sync/lessons/:id`
  - `POST /v1/sync/codebase/upload`

  ### Documentation

  `packages/cli/README.md` rewritten with:
  - Quick start in 5 steps
  - Full command reference with `--json` output and exit code docs
  - Environment variable table
  - Step-by-step guide for finding Project ID and API key
  - CI usage examples (GitHub Actions, env-var-only config)
  - Biological evolution analogy connecting the CLI to the closed-loop pipeline

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

### Patch Changes

- acdf1fe: fix(cli): accept UUID project IDs and read config from env vars
  - `PROJECT_ID_PATTERN` now accepts both UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
    and the `proj_xxx` prefix format. All existing projects use UUID format from
    `gen_random_uuid()`. The `proj_xxx` format was never actually used by the backend.
  - `loadConfig()` now overlays `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, and
    `MUSHI_API_ENDPOINT` env vars over the `~/.mushirc` file so CI pipelines and
    `npx @mushi-mushi/cli sync-lessons` work without an interactive `mushi init` first.
  - Error messages, placeholders and the non-interactive example now show the UUID format.
  - `sync-lessons` command now calls `/v1/sync/lessons` (API-key-authenticated) instead of
    `/v1/admin/lessons` (JWT-authenticated) so it works with the project API key.

## 0.7.0

### Minor Changes

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

## 0.6.1

### Patch Changes

- edaee6d: fix(migration-hub): tighten cross-device checklist sync follow-ups

  Two real bugs reported against Migration Hub Phase 2:
  1. **Premature `'synced'` state after sign-in / auth-change** — both the
     `signIn().then` handler and the `mushi:docs:auth-change` event listener
     in `apps/docs/components/MigrationChecklist.tsx` jumped straight to
     `{ status: 'synced', lastSyncedAt: Date.now() }` the moment a session
     appeared, before the initial fetch + merge + push round-trip had run.
     The footer briefly displayed "Synced just now" with a fictitious
     timestamp, then flickered to "Syncing…" once the effect promoted state
     correctly. Both call sites now land on `'syncing'` with
     `lastSyncedAt: null`, mirroring the initial-state branch that already
     handled returning users correctly. The `useEffect([state.session])`
     initial-fetch effect owns the `'syncing' → 'synced'` promotion after
     the real round-trip.
  2. **Infinite `refreshSession` loop in `DocsBridgePage`** — the bridge
     page's "keep the token fresh" effect called
     `supabase.auth.refreshSession()` on every `[session]` change. The
     refresh emits `TOKEN_REFRESHED`, which `useAuth()` translates into a
     new session object, which re-fires the effect. In the happy path the
     popup auto-closes after 500ms (limiting damage to ~2–3 wasted
     `/token` calls), but in error states (`missing_opener`,
     `invalid_origin`, `no_nonce`, `no_session`) the popup stayed open and
     the loop ran indefinitely against Supabase's auth endpoint. Pinned to
     at most one refresh per popup mount via a ref guard, and only fired
     when the access token is within a 5-minute expiry window.

  Plus the four Copilot follow-ups left from PR #72:
  - `apps/admin/src/pages/DocsBridgePage.tsx` — `ALLOWED_DOCS_ORIGINS` is
    now env-extendable via `VITE_DOCS_ORIGIN_ALLOWLIST`, mirroring the
    server's `MUSHI_DOCS_ORIGIN_ALLOWLIST`. Operators can no longer wire a
    new docs host into the API allowlist and have the bridge silently
    reject it with `invalid_origin`.
  - `apps/docs/content/migrations/index.mdx` — the "run `npx mushi-mushi
migrate`" callout pointed at a command the launcher silently ignores
    (the launcher only knows `init`). Updated to
    `npx @mushi-mushi/cli migrate` (or `mushi migrate` if installed
    globally), with a sentence clarifying which package owns each command.
  - `apps/admin/src/lib/configDocs.ts` — fixed a `/docs/migrations/...`
    reference in the SDK install reference card; the canonical Migration
    Hub URL is `https://docs.mushimushi.dev/migrations/<slug>` (no `/docs`
    prefix).
  - `apps/docs/content/migrations/mushi-sdk-upgrade.mdx` — corrected a
    `blob/main/...` GitHub link to `blob/master/...` so the SDK changelog
    link doesn't 404 (the repo's default branch is `master`).

## 0.6.0

### Minor Changes

- b9666a7: feat(cli): add `mushi migrate` subcommand for guided framework / SDK migrations

  Detects the user's stack from `package.json` (and Capacitor/Expo/Cordova
  config files) and recommends matching guides from the docs Migration Hub
  catalog — Cordova → Capacitor, Capacitor → React Native, CRA → Vite,
  Next.js Pages → App Router, Vue 2 → 3, plus the "switch to Mushi" guides
  for Instabug, Shake, LogRocket, BugHerd, Pendo, and the SDK-upgrade rail.

  Output is a deep link into the docs hub (works on both
  `docs.mushimushi.dev` and `kensaur.us/mushi-mushi/docs`) so the user can
  land directly on the relevant interactive checklist.

  Catalog parity with the docs hub, the admin in-progress card, and the
  server's allowlist is enforced as a release gate by
  `scripts/check-migration-catalog-sync.mjs` (wired into both `ci.yml`
  and `release.yml`), so the four catalogs can never silently drift.

  The `mushi-mushi` launcher will bump as a patch via
  `updateInternalDependencies: "patch"` in `.changeset/config.json`,
  picking up the new CLI dependency.

## 0.5.3

### Patch Changes

- b441c55: - **Supply-chain hardening** workspace-wide 7-day cooldown on new dep
  versions (pnpm `minimumReleaseAge` + npm `min-release-age` + Dependabot
  `cooldown`), plus PR-time `dependency-review-action`, post-publish
  `npm audit signatures`, `strictDepBuilds`, and `blockExoticSubdeps`.
  Closes the window real-world npm attacks operate in (Axios 1.14.x: ~5h to
  detection; Shai-Hulud worm: ~12h) — every publicly-disclosed 2025–2026
  npm supply-chain attack would have been blocked by these defaults.
  - **Launcher README** adds a Socket.dev badge and a new "Supply-chain &
    verification" section that explains, up front, what each external scanner
    reports about `mushi-mushi` (npm provenance, Socket.dev alerts,
    Bundlephobia `EntryPointError`, Snyk Advisor crawler lag) and why none
    of them are actionable bugs.
  - **CLI** bumped `@clack/prompts` from `^0.11.0` to `^1.2.0`. v1 widened
    the `text({ validate })` callback parameter to `string | undefined`; the
    `requireSecret()` helper was updated to handle the new signature
    explicitly. No user-visible change; the v1 spinner-API breaking change
    isn't used here.

  Repo settings (no code change): GitHub Discussions and Dependabot security
  updates were enabled via `gh api`.

## 0.5.2

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

## 0.5.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

## 0.5.0

### Minor Changes

- 18572f7: **Security + UX hardening sweep for the installer trio.**

  Security:
  - `~/.mushirc` is now written with mode `0o600` on Unix. On load, existing files written with looser permissions are proactively chmod'd down so upgrading users are not exposed to other local users on a shared box.
  - Package-manager install no longer uses `shell: true`. We resolve the platform-specific executable (`npm.cmd` on Windows, `npm` elsewhere) and spawn with `shell: false`, closing the door on future shell-metacharacter injection if arbitrary arg forwarding is ever added.
  - Credentials pasted into the wizard are sanitized (stripped of surrounding quotes, whitespace, and CR/LF/NUL) and validated against `^proj_[A-Za-z0-9_-]{10,}$` / `^mushi_[A-Za-z0-9_-]{10,}$` before they're written to disk. Prevents `.env` injection via newlines in a pasted secret.
  - `--endpoint` URLs now require `https://` except for localhost / `.local` / link-local addresses. Typo'd `http://` endpoints are rejected instead of silently exfiltrating the API key.
  - All three published packages now declare `publishConfig.provenance: true` (belt-and-suspenders with the existing `NPM_CONFIG_PROVENANCE=true` in CI) so the npm page shows the verified-publisher badge on every release.
  - New `.github/workflows/security.yml` runs CodeQL (security-extended) + `pnpm audit --prod --audit-level=high` on every PR and weekly via cron.

  UX:
  - `mushi --version` now reports the real package version instead of the stale hardcoded `0.3.0`.
  - Launcher & create-mushi-mushi gained `--version`, `--cwd`, `--endpoint`, `--skip-test-report`, and a non-TTY bail-out that errors clearly instead of hanging on `@clack/prompts` in CI.
  - End-of-wizard "Send a test report now?" prompt closes the loop: the user sees their first classified bug in the console without leaving the terminal.
  - `.gitignore` detection now covers the common patterns (`.env*.local`, `.env.*.local`, `*.local`, `*.env*`) so the "not gitignored" warning stops crying wolf.
  - Monorepo / sub-package support via `--cwd <path>` forwarded from the shims.
  - Error handler on the shims now hints at `DEBUG=mushi` for stack traces and links to the issue tracker.
  - Dead `writeFileSync(readFileSync(...))` round-trip in `writeEnvFile` removed.

  Housekeeping:
  - `funding` field (`https://github.com/sponsors/kensaurus`) added to all three packages.
  - New `./version` subpath export on `@mushi-mushi/cli`.
  - Shared `FRAMEWORK_IDS` / `isFrameworkId` exported from `@mushi-mushi/cli/detect` so the three-file duplicate of the framework list no longer has to be kept in sync.
  - Integration tests for the shims (`--help`, `--version`, unknown framework, unknown flag, non-TTY bail-out) and permission-mode tests for `~/.mushirc`.

## 0.4.0

### Minor Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

## 0.2.0

### Minor Changes

- 7567cee: # v0.6.0 — hardening + agentic-fix orchestration

  This release closes the highest-priority gaps between the V5 whitepaper and the
  running code. It is the first of four releases on the [V5.3 roadmap](../MushiMushi_Whitepaper_V5.md#appendix-c-implementation-roadmap)
  and the breaking-change surface is **zero** for SDK consumers.

  ## Highlights
  - **Vision air-gap**: Stage-2 vision analysis now sees the screenshot only with
    trusted metadata; visible text in the image is captured separately and
    flagged so prompt-injection attempts (e.g. an attacker writing "ignore all
    previous instructions" inside their screenshot) cannot influence
    classification. (V5.3 §2.3.2)
  - **Judge OpenAI fallback**: `judge-batch` now falls back to OpenAI
    (`gpt-4.1` by default) when Anthropic is unavailable, restoring the
    self-improvement loop during outages. Configure via
    `project_settings.judge_fallback_provider`. (V5.3 §2.7)
  - **Blast-radius MV refresh**: `blast_radius_cache` is now refreshed every
    15 minutes via `pg_cron` with a `REFRESH MATERIALIZED VIEW CONCURRENTLY`
    guarded by an advisory lock. Per-project graph-edge pruning runs nightly.
    (V5.3 §2.4)
  - **RAG codebase indexer**: GitHub App webhook + `mushi index <path>` CLI
    fallback for non-GitHub git hosts. Symbol-aware chunking (TS/TSX, JS/JSX,
    Python, Go, Rust). (V5.3 §2.3.4)
  - **Fix dispatch end-to-end**: Admin can dispatch fixes from the report detail
    page; status streams over Hono `streamSSE` with Bearer auth and
    CVE-2026-29085-safe sanitization. (V5.3 §2.10, §2.16)
  - **Sandbox provider abstraction**: `local-noop` (tests) and `e2b` (managed
    sandbox) implementations behind a `SandboxProvider` interface; per-event
    audit log in `fix_sandbox_events`. The orchestrator refuses `local-noop` in
    production. (V5.3 §2.10)
  - **True MCP adapter**: `McpFixAgent` speaks JSON-RPC 2.0 with `tools/call`
    and supports SEP-1686 long-running Tasks. The misnamed `generic_mcp` agent
    is renamed to `rest_fix_worker`; the old export is kept as a deprecated
    alias for one more minor. (V5.3 §2.10)
  - **BYOK schema**: `byok_anthropic_key_ref` / `byok_openai_key_ref` columns
    with audit log; resolver helper falls back to env when no BYOK is set.
    End-to-end wiring lands in v0.8.0. (V5.3 §2.18)

  ## Cross-cutting fixes
  - Widget min description length raised from 5 to 20 chars (server zod schema
    matched). Empirically removes ~30% of unactionable reports.
  - `recordPromptResult` now scopes by `(project_id, stage, version)` so two
    projects sharing a version label cannot corrupt each other's running
    averages. New unique index enforces this.
  - Cloud URL: SDK default endpoint now points at the live Supabase Cloud
    function URL instead of the unbound `api.mushimushi.dev` placeholder.
    Self-hosted users MUST override `apiEndpoint` (no behaviour change).
  - README updated to honestly reflect what's shipped vs. scaffolded.

  ## Migrations included

  `20260418000000_vision_air_gap`, `20260418000100_judge_fallback`,
  `20260418000200_blast_radius_mv_refresh`, `20260418000300_codebase_indexer`,
  `20260418000400_fix_dispatch_jobs`, `20260418000500_sandbox_audit`,
  `20260418000600_mcp_agent_enum`, `20260418000700_prompt_versions_unique`,
  `20260418000800_byok_keys`.

  ## Breaking changes

  None for SDK consumers. Operators with custom `autofix_agent = 'generic_mcp'`
  should migrate to `'rest_fix_worker'` (deprecated alias still works through v0.7).

- 7567cee: # v0.7.0 — on-device classification, real-time triage, AG-UI, fine-tune pipeline, intelligence reports, AGE phase 1

  focuses on intelligence and operator UX: cheaper inference (move junk
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

- 7567cee: # v0.8.0 — mobile parity, A2A discovery, SOC 2 readiness, residency, BYO storage, BYOK

  closes the platform-parity gap with the V5.3 whitepaper. Mobile gets
  first-class native SDKs, the public agent surface becomes A2A-discoverable,
  and customers gain the operational levers (residency, storage, keys, audit
  evidence) needed to run Mushi in regulated environments.

  This release is **non-breaking** for existing SDK consumers. New surface only.

  ## Highlights
  - **Native iOS SDK** (`MushiMushi`, SwiftPM + CocoaPods): shake-to-report
    widget, offline queue with SQLite-backed retry, automatic device context
    capture, screenshot capture via `UIGraphicsImageRenderer`, optional Sentry
    bridge for unified breadcrumbs, and a macOS GitHub Actions matrix.
    (V5.3 §2.18)
  - **Native Android SDK** (`dev.mushimushi:sdk`, Maven Central + AAR):
    feature-equivalent to the iOS SDK — shake detection via `SensorManager`,
    bottom-sheet capture UI, `OfflineQueue` with `WorkManager`-style retry,
    Sentry breadcrumb bridge, and Android CI. (V5.3 §2.18)
  - **Flutter SDK** (`mushi_mushi` on pub.dev): pure-Dart with platform
    channel bridges, `RepaintBoundary`-driven screenshot capture, shake
    detection via `sensors_plus`, and reuses the same offline-queue
    contract as the JS Core SDK. (V5.3 §2.18)
  - **Capacitor plugin** (`@mushi-mushi/capacitor`): web fallback delegates
    to `@mushi-mushi/core`; native iOS/Android delegate to the standalone
    native SDKs so a hybrid app gets the same shake/screenshot UX as a
    native app. (V5.3 §2.18)
  - **A2A Agent Card discovery**: public endpoints
    `GET /.well-known/agent-card` and `GET /v1/agent-card` advertise the
    Mushi agent's identity, skills, supported A2A versions, MCP transport
    details and auth requirements per the A2A protocol. Other agents can
    now negotiate with the Mushi platform without out-of-band config.
    (V5.3 §2.19)
  - **SOC 2 Type 1 readiness module**: new tables
    `project_retention_policies`, `data_subject_requests`, `soc2_evidence`,
    the `mushi_apply_retention()` and `mushi_rls_coverage_snapshot()`
    SECURITY DEFINER helpers, a nightly `soc2-evidence` Edge Function, and
    a new admin **Compliance** page that surfaces the latest control
    evidence (CC6.1, CC6.7, CC7.2, CC8.1, A1.2), DSAR queue, and per-table
    retention policies. (V5.3 §2.20)
  - **Data residency regions (US / EU / JP)**: opt-in pinning per project,
    cluster-aware `regionRouter` middleware that 307-redirects cross-region
    calls, an SDK-side `resolveRegionEndpoint` that primes a localStorage
    cache so subsequent calls go straight to the right cluster, and a
    public `region_routing` lookup table. The US cluster remains the
    catalog of record for project metadata. (V5.3 §2.21)
  - **BYO Storage abstraction** (`s3` / `r2` / `gcs` / `minio` / `supabase`):
    per-project `project_storage_settings`, a vault-backed credential model
    (no raw keys in DB), a zero-dependency `StorageAdapter` with inline
    SigV4 and GCS JWT signing, a healthcheck endpoint, and a new admin
    **Storage** page. Screenshots are now uploaded through the adapter
    end-to-end. (V5.3 §2.22)
  - **BYOK Anthropic / OpenAI keys end-to-end**: `resolveLlmKey` now
    flows through `fast-filter`, `classify-report` (text + vision), and
    `judge-batch`. Every LLM invocation records `key_source` (`byok`
    vs `env`) for billing reconciliation and SOC 2 evidence. New admin
    endpoints `GET / PUT / DELETE /v1/admin/byok/:provider` write keys
    to Supabase Vault via SECURITY DEFINER `vault_store_secret`, never
    to plain DB columns. New **Settings → LLM Keys** panel exposes
    rotation, clearing, and last-used timestamps with `…<last4>` hints.
    (V5.3 §2.23)

  ## Migrations included

  `20260418001300_soc2_readiness`, `20260418001400_data_residency`,
  `20260418001500_byo_storage`, `20260418001600_byok_key_source`.

  ## New packages
  - `@mushi-mushi/capacitor@0.2.0` — Capacitor plugin published to npm.
  - `MushiMushi` (iOS) — published to CocoaPods + SwiftPM.
  - `dev.mushimushi:sdk` (Android) — published to Maven Central.
  - `mushi_mushi` (Flutter) — published to pub.dev.

  ## Breaking changes

  None.

  ## Operator notes
  - **Region rollout**: a single-region deploy continues to work unchanged.
    To enable EU/JP, deploy a sibling Supabase project per region, set
    `MUSHI_REGION` on each Edge Function deployment, and CNAME
    `eu.api.mushimushi.dev` / `jp.api.mushimushi.dev` to the corresponding
    cluster. SDKs auto-discover via `/v1/region/resolve` — no SDK upgrade
    required for old clients (they just won't get the redirect optimization).
  - **BYO Storage**: secrets MUST be loaded into Supabase Vault before being
    referenced from `project_storage_settings`. The settings table only
    stores the _vault entry name_; misconfiguration falls back to the
    cluster default Supabase bucket and surfaces in the storage healthcheck
    as `degraded` rather than failing reports.
  - **BYOK**: rotating a key is non-destructive — the old vault entry is
    overwritten and the next LLM call picks up the new value within one
    second (settings cache TTL). To force every node to drop its cached
    resolution, the admin UI's **Clear** button issues a Vault delete plus
    a settings upsert that nulls the ref column.
  - **SOC 2**: the nightly evidence sweep and retention sweep are scheduled
    via `pg_cron`. Verify both jobs are active with
    `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'soc2-%' OR jobname LIKE 'mushi-%';`.
  - **A2A Agent Card** is intentionally public (no auth) so peer agents can
    discover Mushi. It advertises auth requirements but never the keys
    themselves.

### Patch Changes

- 7567cee: Republish all SDK packages with resolved dependency specifiers.

  The 0.1.0 tarballs were published with `"@mushi-mushi/core": "workspace:*"` (and similar) baked into `dependencies` because `changeset publish` ran without `changeset version` having rewritten the workspace protocol. Every external `npm install` failed with `EUNSUPPORTEDPROTOCOL`.

  This patch republishes every SDK package with real semver ranges in its dependencies. A new pre-publish guard (`scripts/check-workspace-protocol.mjs`) and post-publish verifier (`scripts/verify-published-tarballs.mjs`) prevent recurrence.

## 0.1.0

### Minor Changes

- Initial public release of the Mushi Mushi SDK platform.
  - `@mushi-mushi/core` — universal bug-report engine with structured logging, PII scrubbing, offline queue
  - `@mushi-mushi/web` — browser SDK with session replay, console/network/click capture, proactive detection
  - `@mushi-mushi/react` — React hooks and provider (`MushiProvider`, `useMushi`, `useMushiReport`)
  - `@mushi-mushi/react-native` — React Native SDK with shake-to-report and bottom sheet widget
  - `@mushi-mushi/vue` — Vue 3 composables (`useMushi`) and plugin
  - `@mushi-mushi/svelte` — Svelte stores and context integration
  - `@mushi-mushi/angular` — Angular service and module
  - `@mushi-mushi/mcp` — Model Context Protocol server for AI-assisted triage
  - `@mushi-mushi/cli` — CLI for project setup and report management
