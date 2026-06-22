# @mushi-mushi/core

## 1.20.2

### Patch Changes

- c4798cb: **Fix: SHA-256/HMAC-SHA-256 no longer crashes on Hermes (React Native)**

  `sha256Hex` and `hmacSha256Hex` in the reporter API client now use a new
  `digest.ts` module that falls back to `@noble/hashes` when `globalThis.crypto`
  is unavailable (Hermes on Android, some React Native edge cases). The Web Crypto
  fast path is preserved for browsers, Deno, and Node.js.

  This fixes `YEN-YEN-MOBILE-3R`: `ReferenceError: Property 'crypto' doesn't
exist` that crashed `listMyReports()` on Android Hermes (`react-native@0.83.6`,
  Hermes 0.14.1) whenever the Mushi reporter sheet opened.

  Fixes [YEN-YEN-MOBILE-3R](https://sakuramoto.sentry.io/issues/7564510353/).

## 1.20.0

### Minor Changes

- 3604d25: Add `capture.screenshotProvider` and surface the identified host-app user in the widget.

  - **`capture.screenshotProvider`** — an optional `() => Promise<string | null>` that lets a host (e.g. a Capacitor/WebView app) supply a real pixel-accurate screen grab from a native plugin instead of the built-in DOM-snapshot capturer. The built-in capturer is used as a fallback when the provider throws.
  - **"Reporting as &lt;name&gt;"** — when the host calls `Mushi.identify()` / `Mushi.identifyWithToken()`, the report details step now shows who the report will be attributed to. Cleared when `identifyWithToken(null)` is called.

## 1.19.2

### Patch Changes

- 7b44c97: SDK fixes from automated code review.

  - **Favicon trust boundary** (`@mushi-mushi/core`): `readPageFaviconHref` now returns only http(s) URLs, so a host page can't get a `data:` / `blob:` / `javascript:` favicon rendered into the widget's `<img src>`; anything else falls back to the default mark.
  - **Self-hosted credential message** (`@mushi-mushi/core`, `@mushi-mushi/react-native`): the one-time 401/403 "credentials rejected" warning only links to the hosted console when the client is actually using the Cloud endpoint; self-hosted deployments get a console-agnostic message instead of a wrong domain.
  - **Offline-queue data loss** (`@mushi-mushi/react-native`): `decryptQueueBlob` now decrypts any blob carrying the encrypted prefix regardless of the current `secureStorage` flag. Previously, toggling `secureStorage` from `true` to `false` returned the still-encrypted string, which failed `JSON.parse` and silently cleared the offline report queue.

## 1.19.1

### Patch Changes

- 08108e6: Setup UX overhaul: zero-paste `mushi login` browser device-auth, credential error visibility, and docs fixes.

  - **CLI**: `mushi login` now implements RFC 8628 browser device-auth (zero copy-paste). Opens the console in the browser, user clicks Approve, CLI receives a session token automatically, then lists/creates a project and saves the API key. `--api-key` flag remains as the CI/non-interactive fallback.
  - **Core SDK**: 401/403 responses now emit a one-time `console.error` with a clear credential-failure message and the console URL, instead of silently entering the offline retry queue.
  - **React Native**: Same 401/403 credential-failure detection in `MushiProvider.submitReport` — skips enqueue and surfaces the error immediately.

## 1.19.0

### Minor Changes

- a8f183e: Show the captured screenshot as a visible preview with a configurable
  "remove anything sensitive" privacy caption, so reporters can see and consent to
  exactly what gets sent.

  - **core/types**: new `widget.screenshotSensitiveHint?: boolean | string` config.
    `true` (default) shows the localized caption, a string overrides it verbatim,
    `false` hides the caption (the preview + remove control always remain). Travels
    in the `widget` block of `GET /v1/sdk/config`, so it's settable per-host via the
    SDK and remotely via the Mushi console runtime config.
  - **web/widget**: the details step now renders the attached screenshot as an
    `<img>` preview (previously only a "Screenshot attached ✓" label) with an
    optional privacy caption beneath it. The preview stays in sync through the
    annotate/markup flow and clears when the screenshot is removed. Image `src` and
    caption are HTML-escaped. New `en`/`es`/`ja`/`th` strings.
  - **react-native**: the bottom sheet's existing screenshot thumbnail gains the
    same configurable privacy caption, resolved by the provider from
    `widget.screenshotSensitiveHint`.

  This lets privacy-sensitive hosts (e.g. finance apps) enable screenshot capture
  with an explicit user-facing review-and-remove step instead of disabling it
  outright.

### Patch Changes

- a8f183e: Fix offline-queue retry loop and widget back-navigation state, harden widget HTML escaping.

  - **core/queue**: A transient submit failure whose bumped attempt-counter could
    not be persisted (e.g. an IndexedDB write error) previously re-flushed the row
    forever, bypassing `MAX_DELIVERY_ATTEMPTS` until the 24h age sweep. Row
    mutation now goes through backend-aware `removeRow`/`persistRow` helpers (no
    silent cross-backend no-op), and a report whose counter can't be saved is
    dropped immediately instead of looping (Sentry 14751132/0).
  - **web/widget**: Pressing Back to the category step now collapses an
    expanded "more issue types" list instead of leaving it open across navigation
    (Sentry 14751132/1).
  - **web/widget-render**: `aria-label`, `placeholder`, and the header eyebrow
    now route their interpolated locale strings through `escapeHtml`, closing a
    latent XSS vector if a translation contains markup.

## 1.18.0

### Patch Changes

- 3e1a441: Widget: progressive disclosure for category list + offline queue delivery guard

  - **web**: Category step now shows only the primary "bug" option by default; a "More issue types →" toggle reveals the remaining categories. Back navigation added for `success`, `account`, and `cross-app-reports` steps. Back button now renders with "← Back" label. Panel width 384px→360px and max-height 640px→480px for better fit on smaller viewports.
  - **core**: Offline queue no longer retries forever on undeliverable reports. `MAX_DELIVERY_ATTEMPTS = 8` drops a row after 8 transient failures; `MAX_QUEUE_AGE_MS = 24h` hard-evicts stale rows on the next flush, including legacy rows that predate the per-row attempt counter.

## 1.17.0

### Minor Changes

- 679b158: Page-aware in-SDK assistant, signed end-user identity, and shared design tokens.

  - **In-SDK assistant ("Ask" tab):** the web widget gains a knowledge-grounded `Ask` tab backed by `apiClient.askAssistant({ message, threadId, context })`. New `MushiAssistantConfig` / `MushiAssistantStep` / `MushiAssistantReply` types in `@mushi-mushi/core`.
  - **Page context:** `publishPageContext()` lets the host publish the current route/title/summary/filters/selection so the assistant and reports are page-aware. New `MushiPageContext` type.
  - **Signed identity:** `identifyWithToken({ token })` forwards a host-minted identity JWT on the `X-Mushi-User-Token` header (verified server-side) — the trust anchor for "My Reports", rewards, and the per-user assistant index. Added on web and the Capacitor bridge. `@mushi-mushi/core` exports `buildIdentityClaims`, `parseIdentityToken`, and `MUSHI_IDENTITY_TOKEN_PREFIX`.
  - **Design tokens:** `@mushi-mushi/core` now exports `mushiTokens` / `mushiPalette` plus `MUSHI_COLORS_LIGHT`, `MUSHI_COLORS_DARK`, `MUSHI_SPACING`, `MUSHI_RADIUS`, `MUSHI_TYPE`, `MUSHI_Z`, `MUSHI_MOTION`, `MUSHI_GEOMETRY`, and `MUSHI_COPY` so every SDK skins the widget from one source.

## 1.15.0

### Minor Changes

- 716573d: Add a `destination` option to `createLogger` (`'stdout'` default, or `'stderr'`).

  stdio MCP servers use stdout as the JSON-RPC protocol pipe, so any non-protocol
  bytes written there corrupt the connection. Logging to `'stderr'` keeps stdout
  clean for the transport while preserving structured log output. Existing callers
  are unaffected — the default remains `'stdout'`.

## 1.14.0

### Minor Changes

- 499b716: **Mushi SDK Uplift — Draggable FAB, Themed Popup, Keyboard-Safe Form, Cross-App Community**

  ### Draggable / repositionable FAB
  - **Web**: Pointer Events drag with tap-vs-drag threshold (6 px), safe-area clamping, optional edge-snap on release, per-project `localStorage` persistence, arrow-key nudge for keyboard accessibility. New `draggable?: boolean | { persist?, snapToEdge?, axis? }` config type in `@mushi-mushi/core`.
  - **React Native**: `PanResponder`-based drag + `AsyncStorage` persistence + safe-area clamping.
  - **Flutter**: Long-press-to-drag via `GestureDetector` + `SharedPreferences` persistence + edge-snap.
  - **iOS**: `UIPanGestureRecognizer` via `MushiFabDragController` + `UserDefaults` persistence + animated edge-snap.
  - **Android**: `OnTouchListener` tap-vs-drag + `SharedPreferences` persistence + optional edge-snap. New `DraggableConfig` data class.

  ### Theme inherit + accent + contrast fixes
  - **All platforms**: New `theme: 'inherit'` resolves the host app's dark mode at runtime (`prefers-color-scheme` / `color-scheme` on web, `traitCollection.userInterfaceStyle` on iOS, `UiModeManager` on Android, `Brightness` on Flutter). New `accent` + `accentText` config tokens for brand-color override.
  - **Web**: Parameterized `getWidgetStyles(theme, accent)` with `widgetAccent` / `widgetAccentWash` / `widgetAccentInk` tokens; fixed undefined `var(--mushi-text-dim)` references; WCAG AA re-verified in both themes.
  - **React Native / Android**: Explicit disabled-state colors (no more white-on-white disabled buttons).

  ### Keyboard-safe "tell us more" form
  - **Web**: `visualViewport` manager on `open()`; lifts panel above mobile keyboard; scrolls focused `textarea` / `input` into view; `100dvh` bottom-sheet layout on narrow viewports; torn down on `close()` / `destroy()`.
  - **React Native**: `KeyboardAvoidingView` `behavior="height"` (Android) + `ScrollView(keyboardShouldPersistTaps)`.
  - **Flutter**: `SingleChildScrollView` + `MediaQuery.viewInsets.bottom` inset.
  - **iOS**: `keyboardWillShow` / `keyboardWillHide` observers + `CGAffineTransform` lift.
  - **Android**: `SOFT_INPUT_ADJUST_RESIZE` + `ScrollView` wrapper.

  ### Cross-app community layer
  - New **in-widget Mushi sign-in** (magic link / OTP) — no password required.
  - **Account step**: sign-in form → signed-in profile card with global rank + cross-app navigation.
  - **Cross-app reports step**: all reports filed by this tester across every app, grouped by app.
  - **Global leaderboard**: top-N ranking from `tester_leaderboard_30d_public`, with my rank highlighted.
  - **Server** (Supabase, mushi-mushi project): three new SECURITY DEFINER RPCs — `mushi_link_reporter_token`, `mushi_get_my_cross_app_reports`, `mushi_get_my_reputation`; magic-link route; public leaderboard route. Deployed + verified on remote.
  - **Community footer** added to the category-select step: "Join community" entry-point + leaderboard shortcut.
  - Cross-domain identity unifies server-side via `tester_id`; per-domain magic-link re-auth is required for different origins (localStorage is per-origin by browser design).

  ### Size budget

  Bundle budget raised from 63 KB → 70 KB gzip (with 3.5 KB headroom) to accommodate the community layer. Community CSS compacted to single-line rules.

### Patch Changes

- 499b716: One-click SDK install & upgrade: "Create Upgrade PR" in the Mushi console.

  **Backend**
  - New `sdk_upgrade_jobs` table tracking upgrade PR jobs (status, pr_url, plan, timestamps; service-role RLS).
  - New `sdk-upgrade-worker` edge function: reads connected repo's package.json(s), bumps `@mushi-mushi/*` to latest npm versions via `_shared/sdk-upgrade-plan.ts`, opens a reviewed draft PR via `_shared/github-pr.ts`.
  - New `sdk-versions-cron` edge function (daily pg_cron 02:30 UTC): keeps `sdk_versions` catalog fresh by querying the npm registry for every `@mushi-mushi/*` package.
  - New `sdk-upgrade` API route (`POST` enqueue + `GET` poll + `GET /stream` SSE) — registered in `api/index.ts`; gated on GitHub connected, with in-flight deduplication.
  - `_shared/github-pr.ts`: extracted generic `createPrFromFiles` + branch/commit helpers from `fix-worker` (fix-worker refactored to import, behavior preserved).
  - `release.yml`: publish-time `scripts/sync-sdk-versions.mjs` step upserts published package versions into `sdk_versions` after each Changesets publish.

  **Frontend (admin console)**
  - New `/connect` page (`ConnectPage`): unified "Connect & Update" hub — GitHub → SDK → MCP → CLI → Update center with one-click "Create Upgrade PR".
  - `McpInstallButtons` component extracted from `McpPage` and reused in `ConnectPage`.
  - `useSdkUpgrade(projectId)` hook: mirrors `useDispatchFix` with POST + SSE stream + poll fallback.
  - `SdkUpgradeCTA`: primary "Create Upgrade PR" button when `projectId` is supplied (GitHub connected); copy-cmd CLI fallback always present.
  - `SdkUpgradeBanner`: dashboard nudge when active project SDK is outdated/deprecated, linking to `/connect`.
  - Nav entry "Connect & Update" added to the Act section in `Layout.tsx`.

## 1.13.0

### Minor Changes

- 2f08da2: Add config-driven custom categories to the Mushi SDK.
  - `MushiWidgetConfig.categories` accepts an array of `MushiCustomCategory` objects, each with an `id`, `label`, optional `description`, `intents`, `icon`, and `baseCategory` mapping to a built-in `MushiReportCategory`.
  - When `categories` is set, the widget renders the host-defined list instead of the default built-in categories.
  - Custom categories with `intents` show the intent selection step; those without skip straight to the details step.
  - `MushiReport.userCategory` carries the raw custom category id through to the server for storage in `reports.user_category`.
  - `openWith` and `report` deep-link APIs now accept `MushiReportCategory | string` so host apps can pre-select a custom category.
  - `MushiCustomCategory` is now exported from `@mushi-mushi/core`.

## 1.12.0

### Minor Changes

- 03fabb9: Session replay + screenshot annotation capture, client-side payload guarding, and a full-stack audit-hardening pass across the SDK, CLI, and MCP.

  ## @mushi-mushi/core
  - **New:** `checkReportPayloadSize`, `estimateJsonBytes`, `formatBytes`, and `MAX_REPORT_PAYLOAD_BYTES` payload-guard helpers. `checkReportPayloadSize` serializes once and reports a distinct `serializeFailed` outcome (e.g. circular references in metadata) instead of a generic "too large".
  - `submitReport` now surfaces a `SERIALIZE_FAILED` error code (separate from `PAYLOAD_TOO_LARGE`) so callers can tell an oversized report apart from one that could not be serialized.
  - **Hardening:** the offline retry queue now treats `PAYLOAD_TOO_LARGE` and `SERIALIZE_FAILED` as permanent failures, so a single oversized report can no longer poison-pill the queue and block every later report.

  ## @mushi-mushi/web
  - **New — session replay:** opt-in `capture.replay: 'rrweb' | 'lite' | 'sentry' | 'off'` records a rolling buffer that attaches to the report on submit. rrweb recording masks all text and inputs by default (`maskAllText` + `maskAllInputs`), records continuously from init, and trims the buffer while preserving the most recent full snapshot so replays stay playable. `'off'` is the default.
  - **New — screenshot annotation:** the report panel's "Mark up" button opens an interactive overlay (highlight / blur / arrow) so reporters can circle the problem and redact sensitive regions before submitting. The annotation session stays open until the reporter confirms with "Done"; touch strokes now resolve correctly on lift (`touchend`).
  - **New — screenshot compression** before upload to keep payloads small.
  - **Hardening:** oversized reports are progressively degraded — drop the replay buffer, then the screenshot — before being dropped entirely with a `report:failed` event, so the offline queue is never wedged. The replay capture is now torn down on `Mushi.destroy()` (no observer/listener leak) and guarded against an init/`updateConfig` race that could install a stale capture.

  ## @mushi-mushi/react-native
  - Fix `onReportQueued` / `onReportSynced` callback timing: `onReportQueued` now fires after the report is persisted to the offline queue, and `onReportSynced` fires only when a queued report is actually delivered (wired to the async-storage queue drain) rather than misleadingly firing on direct submission.

  ## @mushi-mushi/mcp
  - Fix `get_reporter_thread`: it now calls the existing `GET /v1/admin/reports/:id/timeline` endpoint (which includes the reporter/admin comment lane plus fix, QA, and status lanes) instead of a non-existent `/comments` route that returned 404.

  ## @mushi-mushi/cli
  - `mushi feedback board` now reads the feature board via `GET /v1/admin/feature-board` with an operator API key (`mcp:read`), fixing the previous 401, and renders real vote counts.
  - `mushi doctor --fix` re-runs its checks after applying fixes, so the printed result and exit code reflect the post-fix state.
  - Endpoints are normalized consistently (trailing slashes stripped on sub-paths) to prevent double-slash request URLs.

## 1.11.0

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

## 1.10.0

### Minor Changes

- c0eb84b: Add a cross-platform Reporter API, contributor hall-of-fame, and a headless fix-merge CLI.

  ## @mushi-mushi/core
  - Add the Reporter API to `MushiSDKInstance`: `listMyReports()`, `listMyComments(reportId)`, and `replyToReport(reportId, body)` let an anonymous reporter view and follow up on their own submissions, keyed to the persistent reporter token.
  - Add `getHallOfFame(limit?)` plus the matching `MushiApiClient.getHallOfFame()` and the new `MushiHallOfFameEntry` type for the public contributor leaderboard.

  ## @mushi-mushi/web
  - Implement the Reporter API and `getHallOfFame()` on the web SDK instance. All methods fail soft (return `[]` / `null` instead of throwing) when offline or before a reporter token exists, so they are safe to call on first render.

  ## @mushi-mushi/react
  - Expose the Reporter API on the `useMushi()` hook (`listMyReports`, `listMyComments`, `replyToReport`, `getHallOfFame`, `getReputation`, `getTier`) as memoised, render-stable callbacks with no-op fallbacks before the SDK is ready.
  - Re-export `MushiReporterReport`, `MushiReporterComment`, `MushiHallOfFameEntry`, `MushiReputationResult`, and `MushiTierResult` for host-app typing.

  ## @mushi-mushi/react-native
  - Add optional in-app screenshot capture via `react-native-view-shot` (declared as an optional peer dependency — no-ops gracefully when not installed).
  - Re-export `MushiReporterReport`, `MushiReporterComment`, and `MushiHallOfFameEntry` so React Native host apps can type the Reporter API.

  ## @mushi-mushi/cli
  - Add `mushi fixes merge <fixId> [--method squash|merge|rebase]` to squash-merge a fix PR and mark the linked report Fixed without leaving the terminal (auto-readies draft PRs first).
  - Add `mushi fixes refresh-ci <fixId>` to pull the latest GitHub Actions check-run status on demand. Both commands accept `--json` for scripting and require an admin API key with `mcp:write` scope.

## 1.9.0

### Minor Changes

- 144906a: Integrations & QA notification wave, plus correctness/security hardening.

  **Web SDK** — Added opt-in W3C trace-context propagation: when `capture.tracePropagation.enabled` is set with a `corsUrls` allowlist, outbound fetch requests carry `traceparent` and `x-mushi-session` headers and the generated `traceId` is recorded on the network entry, so frontend reports correlate with backend spans. Fixed a wiring bug where the config and session id were never passed through to the network capture, leaving the feature unreachable.

  **Node SDK** — New Express/Hono-style middleware (`@mushi-mushi/node`) that reads `traceparent` / `x-mushi-session` and posts backend spans to `/v1/ingest/spans` for trace correlation.

  **CLI** — New `integrations`, `slack`, `qa`, `tdd`, and `keys` commands. `mushi doctor --qa-stories` now queries the real `/qa-coverage` endpoint (the previous `/qa-stories` list path returned 404).

  **MCP** — New TDD and notification tools. `get_qa_story_run` now resolves the run via the runs list instead of a non-existent single-run route.

  **plugin-slack-app** — Manifest OAuth redirect URL and scopes corrected.

  **Security** — Slack OAuth `state` is now HMAC-signed and verified (with expiry and constant-time comparison) on the callback, closing a cross-tenant token-write vector, and the OAuth `redirect_uri` now points at the registered Supabase functions callback. (Server-side; ships via the edge-function deploy.)

## 1.8.0

### Minor Changes

- be12eae: feat(web,core): rich banner layout — `message`, `label`, and flat `links`

  `MushiBannerConfig` gains `message` (body copy on the strip), `label` (pill label before the message, `false` to hide), and `links` (extra flat actions after the bug/feature CTAs, each opening an external URL or the feature-request widget). When `message` is set the banner switches to the rich pill + message + flat-actions layout used by the Mushi admin console's beta banner. `MushiBannerLink` is exported from `@mushi-mushi/core`.

## 1.7.5

### Patch Changes

- fix(widget): host pointer-events pass-through so banner never blocks page taps

  The shadow-host element no longer intercepts touches on underlying page content.
  `:host` is `pointer-events: none` with zero-size fixed positioning; banner, panel,
  and FAB surfaces opt back into `pointer-events: auto`. Adds `syncHostChromeState`,
  `isSuppressedByHost`, and `getWidgetDiagnostics` (`widgetHostPointerSafe`,
  `widgetHostBounds`, `bannerRendered`) for integration health checks. Unifies
  `hideOnSelector` suppression across trigger and banner paths.

## 1.7.4

### Patch Changes

- fix(web): stop proactive prompts re-opening on every load of a broken/reloading page

  The proactive fatigue guard only persisted its cooldown after a clean widget
  `onClose` recorded a dismissal. A page reload or crash (e.g. an offline WebView,
  an API-cascade error state) tears down the JS context before that, so the
  in-memory session counter reset and the panel re-opened on every subsequent
  load.

  Proactive shows now persist a `mushi:lastShown` timestamp, and a fresh session
  (new JS context) suppresses prompts shown within a configurable
  `reshowCooldownMinutes` window (default 30, `0` disables). Within a live session
  the existing per-session limit/dedup still governs, so legitimate second
  triggers are unaffected. `reset()` (explicit teardown / re-init) clears the
  timestamp. Adds `MushiCooldownConfig.reshowCooldownMinutes`.

## 1.7.2

### Patch Changes

- b2089cb: Fix six edge-case failure paths discovered during the May 27 Copilot code review.

  **@mushi-mushi/core**
  - Offline queue: permanently evict reports that return HTTP 400, HTTP 422, `INGEST_ERROR`, or `VALIDATION_ERROR` codes — previously one bad report blocked all subsequent retries in the same flush cycle.
  - API client: improved error message extraction from non-JSON responses so offline-queue eviction logic receives the structured error code instead of a generic string.

  **@mushi-mushi/cli**
  - `nudge`: numeric flags (`--min-rating`, `--max-rating`, `--limit`) now validate that values are finite integers in valid ranges; previously NaN propagated silently to the API producing unexpected results.

  **@mushi-mushi/capacitor**
  - iOS `BreadcrumbCollector`: `maxMessageLength` floor corrected from 50 → 1; the old value silently inflated every breadcrumb message to at least 50 chars, breaking exact-match assertions in downstream tests.

## 1.7.0

### Minor Changes

- 740df06: Add `trigger: 'banner'` — a slim, full-width header strip launcher that replaces the floating action button as the recommended default.

  **@mushi-mushi/core**
  - New `trigger: 'banner'` value on `MushiWidgetConfig` — renders a full-width strip pinned to the top (or bottom) of the viewport instead of a floating action button.
  - New `MushiBannerConfig` interface exported for configuring the banner: `variant` (`'neon' | 'brand' | 'subtle'`), `position` (`'top' | 'bottom'`), `bugCta`, `featureCta`, `featureCtaLabel`, `zIndex`.
  - New `bannerConfig?: MushiBannerConfig` field on `MushiWidgetConfig`.

  **@mushi-mushi/web**
  - Banner launcher renders inside the widget's Shadow DOM as a `position: fixed` strip — no layout impact on the host page.
  - Three variants: `neon` (electric lime, high-contrast dev/beta feel), `brand` (vermillion, editorial app-quality feel), `subtle` (hairline muted strip, least disruptive).
  - Per-session dismiss via ✕ button; re-appears on next page load.
  - "🐛 Report a bug" and optional "✨ Request feature" buttons open the report panel directly.
  - Runtime config from the Mushi console (`launcher`, `bannerVariant`, `bannerPosition`, `bannerBugCta`, `bannerFeatureCta`) is applied automatically — no SDK re-init required.
  - Console configurator: live preview + banner style/position/label controls in `SdkInstallCard`.
  - Database: new `sdk_widget_launcher`, `sdk_banner_variant`, `sdk_banner_position`, `sdk_banner_bug_cta`, `sdk_banner_feature_cta` columns in `project_settings`.

### Patch Changes

- ef25a84: Fix six edge-case failure paths discovered during the May 27 Copilot code review.

  **@mushi-mushi/core**
  - Offline queue: permanently evict reports that return HTTP 400, HTTP 422, `INGEST_ERROR`, or `VALIDATION_ERROR` codes — previously one bad report blocked all subsequent retries in the same flush cycle.
  - API client: improved error message extraction from non-JSON responses so offline-queue eviction logic receives the structured error code instead of a generic string.

  **@mushi-mushi/cli**
  - `nudge`: numeric flags (`--min-rating`, `--max-rating`, `--limit`) now validate that values are finite integers in valid ranges; previously NaN propagated silently to the API producing unexpected results.

  **@mushi-mushi/capacitor**
  - iOS `BreadcrumbCollector`: `maxMessageLength` floor corrected from 50 → 1; the old value silently inflated every breadcrumb message to at least 50 chars, breaking exact-match assertions in downstream tests.

## 1.6.0

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

## 1.5.0

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

## 1.4.0

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

- Web SDK: Core Web Vitals catch-up + Sentry-spec feedback hooks.
  - **INP (Interaction to Next Paint) capture**: a Google Core Web Vital since March 2024, replacing First Input Delay. The SDK now installs a `PerformanceObserver({ type: 'event', durationThreshold: 40 })` and records the worst-observed user-interaction latency on every report, with **attribution** — `eventType`, `targetSelector` (e.g. `button#submit.primary`), and per-phase timings (input delay / processing / presentation) so the triage UI can render "1200 ms click on `<button.checkout>`" instead of a bare number. Falls back to a `first-input` observer for FID on Safari < 16.4. Adds ~700 B gzipped to the bundle (still under the 44 KB budget at 43.07 kB).
  - **`beforeSendFeedback` hook** (Sentry SDK feedback spec §4): last-chance synchronous or async hook fired AFTER pre-filter / on-device classifier / rate-limit gates pass and BEFORE the report is sent or queued. Returning `null` drops the report silently; throwing or timing out (>2 s) ships the unmodified report so a buggy hook never swallows feedback.
  - **`onCrashedLastRun` hook** (Sentry SDK feedback spec §6): fires once on `Mushi.init` after detecting that the previous tab session ended without a clean `pagehide`. The SDK never auto-opens the widget — copy and timing are the host's call. Implementation uses a `localStorage` sentinel that's set on init and cleared on `pagehide` (the only reliably-fired end-of-session event in 2026).

  No breaking changes. New unit tests in `packages/web/src/capture/performance.test.ts` lock the INP attribution math against the official web-vitals algorithm.

## 1.2.0

### Minor Changes

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

## 1.1.0

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

## 1.0.0

### Major Changes

- 84118af: SDK observability v1 — Sentry-style breadcrumbs, sticky tags, structured `captureException`, and a rich Sentry handshake.

  The SDK now ships a first-class observability surface so the bug your monitoring missed lands in Mushi alongside the route, the breadcrumb trail, the active Sentry trace, and any tags you've stuck on the session — without the embedder having to plumb that context through the report payload by hand.

  This is the **1.0** milestone we've been tagging in the readmes: the public APIs introduced here are the ones we'll keep stable through the rest of the v1 line. There are no breaking changes from v0.9 — every new method is additive — but the version bump signals "this surface is now the supported way to enrich Mushi reports".

  ### `@mushi-mushi/web` — power-user instance methods

  ```typescript
  const mushi = Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

  // Identify the active reporter (also forwarded to @sentry/browser if loaded).
  mushi.identify({ id: 'usr_42', email: 'aya@example.com', segment: 'beta' });

  // Sticky scalar tags. Up to 64 keys; values are string | number | boolean.
  // Tags ride on every subsequent report and are GIN-indexed server-side
  // (`?tag=plan:pro` filter on /v1/admin/reports).
  mushi.setTag('feature', 'checkout-v2');
  mushi.setTags({ plan: 'pro', region: 'apac', experiment: 'B' });
  mushi.clearTag('experiment');

  // Manual breadcrumbs. Route changes / console.error / [data-testid] clicks
  // are captured automatically by `installAutoBreadcrumbs()`.
  mushi.addBreadcrumb({
    category: 'business',
    level: 'info',
    message: 'cart.checkout_started',
    data: { itemCount: 3, currency: 'JPY' },
  });

  // Structured exception capture. Accepts Error, string, plain object, null,
  // or undefined — anything `try { } catch (e) { }` can land on. The SDK
  // normalises the throw, attaches the breadcrumb buffer + sticky tags +
  // active Sentry context, and submits as a `bug` report.
  try {
    await runCheckout();
  } catch (err) {
    mushi.captureException(err, {
      level: 'error',
      tags: { surface: 'checkout' },
      extras: { orderId: 'ord_123' },
    });
  }
  ```

  ### `@mushi-mushi/web` — Sentry handshake v2

  The widget now auto-detects `@sentry/browser` v7 / v8 / v9 and captures the full active scope into `MushiReport.sentryContext`: `eventId`, `replayId`, `traceId`, `spanId`, `transaction`, `release`, `environment`, `user`, breadcrumbs, tags, and a deep-link `issueUrl`. In the other direction, every Sentry event raised after a Mushi report is tagged with `mushi.report_id`, so the admin's report drawer can render `Open in Sentry →` and the Sentry issue page can deep-link back into Mushi without any host-app glue code.

  ### `@mushi-mushi/core` — new public modules
  - **`createBreadcrumbBuffer(options?)`** — 50-entry ring buffer of `{ timestamp, category, level, message, data? }`. Long messages truncate at 500 chars _at insert time_ so a runaway log line can't push useful crumbs out of the buffer. PII scrubbing runs at report-snapshot time (not at insert) so in-app debugging stays unredacted while the wire payload stays clean.
  - **`normaliseThrown(thrown)`** — turns any thrown value (`Error`, string, plain object, `null`, frozen `DOMException`) into `{ name, message, stack?, cause? }` with an 8 KB stack cap and cyclic-cause guards. Powers `Mushi.captureException()`; exposed so adapters (Vue / Svelte / Angular / RN) can ship their own thin wrappers without re-implementing the normalisation.
  - **`captureEnvironment()` expansion** — same one-call API, richer payload: viewport + screen + DPR, **User-Agent Client Hints** when supported (`brands`, `mobile`, `platform`, `model`, plus the high-entropy values resolved out-of-band and folded back in on the next capture), accessibility prefs (`prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`), online / displayMode / page title, and a one-shot **page-load timing** read from `PerformanceNavigationTiming` (TTFB, DOMContentLoaded, FCP, LCP). Every individual field stays optional so a Safari / Firefox / iOS WebView still produces a useful payload.

  ### New public types

  | Type                           | Notes                                                                                                                                                                                                                  |
  | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `MushiBreadcrumb`              | `{ timestamp, category, level: 'debug' \| 'info' \| 'warning' \| 'error' \| 'critical', message, data? }`. Mirrors the Sentry breadcrumb shape so the admin can interleave Mushi + Sentry breadcrumbs on one timeline. |
  | `MushiSentryContext`           | Rich Sentry handshake captured via `@sentry/browser`. Exposed as `SentryContext` re-export from `@mushi-mushi/web`.                                                                                                    |
  | `MushiCaptureExceptionOptions` | `{ level?, tags?, extras?, category?, userIntent? }` overrides passed to `captureException(err, opts)`.                                                                                                                |
  | `NormalisedException`          | Return type of `normaliseThrown(err)`.                                                                                                                                                                                 |

  ### Server-side enrichment (already shipped)

  The Mushi server promotes the new fields to dedicated columns: `reports.breadcrumbs` (jsonb, GIN-indexed), `reports.tags` (jsonb, GIN-indexed), and `reports.sentry_trace_id` / `reports.sentry_release` / `reports.sentry_environment` (each backed by a partial b-tree index). The admin's `GET /v1/admin/reports` endpoint accepts `?tag=key:value`, `?trace=<sentry_trace_id>`, `?release=<…>`, and `?sentryEnv=<…>` for filtered/cross-linked views. Deduplication groups still apply, and the list-row hover popover (`BreadcrumbPeek`) renders the last 5 SDK breadcrumbs without an N+1 fetch.

  ### Migration

  No breaking changes. `Mushi.init()` keeps its existing config shape; the new instance methods are additive. To opt in to auto-breadcrumbs, call `installAutoBreadcrumbs()` once after `init()` (or omit it — manual `addBreadcrumb()` continues to work either way). PII scrubbing remains opt-out per the existing `capture.scrubPii` config.

  `@mushi-mushi/react` re-exports the new types and methods through its hook surface; no consumer code change needed beyond bumping the dependency.

## 0.9.0

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

## 0.8.0

### Minor Changes

- ef0036d: Ship SDK dogfood hardening and a two-way reporter channel.
  - Ignore Mushi's own config/report/notification requests in network capture and proactive API cascade detection.
  - Add `Mushi.diagnose()` for endpoint, CSP, widget, capture, runtime-config, and SDK-version health checks.
  - Send `sdkPackage` and `sdkVersion` with reports, expose `/v1/sdk/latest-version`, and surface outdated SDK state in the widget.
  - Add `widget.anchor`, deployment presets, privacy screenshot masks/blocks, screenshot removal, `setScreen()`, and normalized repro timelines.
  - Add reporter history/reply APIs so the widget can show report status, developer replies, and reporter responses.
  - Add Capacitor bottom-dock trigger inset presets.

## 0.7.0

### Minor Changes

- 15462c8: Add production-grade trigger controls for embedded apps: manual and attach modes, runtime show/hide APIs, edge-tab and smart-hide behavior, configurable insets, and React Native custom launcher/shake support.

## 0.5.1

### Patch Changes

- b441c55: Fix runtime SDK config delivery and native mobile trigger behavior.
  - Add public SDK runtime config endpoints, admin persistence, cache headers,
    and typed runtime config support.
  - Let web capture modules follow runtime config changes after startup.
  - Add native user/metadata/category context wiring and harden mobile overlay
    lifecycle behavior.
  - Add Swift Package Manager support for the Capacitor iOS plugin.

## 0.5.0

### Minor Changes

- 48858bb: Bug-capture widget redesign — "Mushi Mushi Editorial" (2026-04-24)

  The floating widget has been redesigned end-to-end to lean into the brand
  (虫々 = "bug, bug" in Japanese) instead of the generic SaaS chatbot look it
  shipped with. No API or config changes — purely visual + a few quality-of-life
  keyboard wins.

  **Visual**
  - Paper + sumi ink palette (`#F8F4ED` cream / `#0E0D0B` ink) replaces the
    previous purple-on-white. Single 朱 vermillion accent (`#E03C2C`) used as
    a hanko stamp colour.
  - Trigger is now a rounded paper card with a vermillion bottom edge and a
    pulsing 朱 dot — reads as a real 印鑑 stamp, not a floating round button.
  - System serif display stack (Iowan/Palatino/Georgia) for headings; mono
    for the new `01 / 03` step-counter ledger and the "REPORT · HH:MM:SS"
    receipt timestamp. Zero web-font fetches.
  - Editorial contents-list category step (1px hairline rules, no card
    stacking), arrow-on-hover cues, vermillion focus underline.
  - Success step renders a 朱印 ring with the kanji `受` ("received").
  - All design tokens are named by **material** (`paper`, `ink`, `rule`,
    `vermillion`) rather than role (`primary`, `secondary`).

  **Keyboard / a11y**
  - New `⌘ / Ctrl + Enter` shortcut submits from anywhere in the panel.
  - Footer hint advertises the shortcut.
  - Textarea autofocus on the details step (one fewer Tab to start typing).
  - `prefers-reduced-motion` is fully honoured — animations collapse to
    instant, success stamp jumps to the final frame.
  - Panel gets `aria-modal="true"`; trigger advertises `aria-haspopup` /
    `aria-expanded`.

  **Reliability**
  - `MushiWidget.destroy()` now clears the success-state and auto-close
    timers, preventing a host that unmounts mid-submit from holding a
    reference to the destroyed widget for ~3.3s.

## 0.4.1

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

## 0.4.0

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

## 0.3.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

## 0.3.0

### Minor Changes

- 81336e9: Wave S1 — security hot patches.
  - `@mushi-mushi/core`: client-side PII scrubbing parity with server (emails, phone, credit cards, US SSN, bearer tokens, API keys, UK IBAN/sort codes, IPv4/IPv6); new `MushiOfflineConfig.encryptAtRest` option that wraps the offline queue in AES-GCM 256 via Web Crypto + IndexedDB (non-extractable key). Legacy plaintext rows remain readable during a one-time migration.
  - New `MushiSDKInstance.captureEvent(input)` for programmatic bug reports outside a user-driven click (obeys rate-limit, PII scrub, and offline queue) and `identify(userId, traits?)` as an ergonomic alias for `setUser` with merged traits.

## 0.2.1

### Patch Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

- 41b6aa7: **admin console UX overhaul + microinteraction sweep + 4 frontend bug fixes (no SDK behaviour change).**

  The published SDKs are unchanged in this release; the bump is to align the npm tarball with the updated cross-link README + the new admin console (`@mushi-mushi/admin@0.1.0`) that SDK consumers are pointed at from the dashboard.

  What ships behind it (admin-side, visible to anyone running `npx mushi-mushi` and landing in the console):
  - `PageHelp` defaults open only on the user's first ever visit (single global `mushi:visited` flag) instead of bombarding returning admins with re-opened help on every page.
  - `PageHeader` accepts a `projectScope` prop; `Reports / Fixes / Judge / Graph / Health / Compliance` thread the active project name through so headers read `Reports · glot-it`.
  - New `<ResultChip>` primitive — persistent inline `✓ Connection OK · 2s ago` receipt for every Test / Run / Trigger button. Adopted across BYOK / Firecrawl / Health quick-tests.
  - Layout-shaped skeletons (`DashboardSkeleton`, `TableSkeleton`, `DetailSkeleton`, `PanelSkeleton`) replace 22 page-level spinner-on-blank loaders so first paint matches the loaded layout.
  - Microinteractions: animated toasts (in 180ms / out 140ms), modal scrim fade-in + panel scale-in, sliding-underline tab indicator on Settings (with `ResizeObserver` so it stays aligned on viewport resize).
  - Pre-setup dashboard reveal: brand-new admins see `SetupChecklist + HeroIntro` only until the first report lands.

  Frontend bug fixes:
  - `ByokPanel` `testedAt` no longer recomputes `new Date()` on every render — the `<RelativeTime>` chip now correctly reads "X seconds ago" instead of perpetually "just now".
  - `toast` exit-timer guard prevents double-dismiss from leaking the original timer.
  - `ReportsKpiStrip` surfaces `/v1/admin/reports/severity-stats` failures inline with retry instead of silently rendering zeros.
  - `Compliance` DSAR creation switched to snake_case + explicit `projectId` to match the backend validator (was producing a persistent 400).
  - `Sentry.withSentryReactRouterV7Routing` wrapper moved to the auth-gate inner Routes so transactions report parametrized names (`/reports/:id`) instead of being collapsed to `/*`.
  - `SeverityStackedBars` no longer composes two scale ratios — non-max columns now render at their true height.

  Server-side compliance fixes (deployed separately to Supabase Edge Functions, not part of the npm tarball but part of this release):
  - `logAudit()` calls in `compliance/retention`, `compliance/dsars` (POST + PATCH), and `compliance/evidence/refresh` rewritten to use positional args; new `'compliance.dsar.updated'` audit added to PATCH (was a missing audit row); `cronRun.complete()` corrected to `cronRun.finish()` in `soc2-evidence`.

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
