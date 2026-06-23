# @mushi-mushi/react-native

## 0.20.1

### Patch Changes

- 5feac27: # v0.20.1 — Post-release SDK reliability fixes

  - **React Native types resolve after publish**: removed the `web-i18n.d.ts` ambient shim that re-exported `MushiLocale` from a monorepo-relative source path (`../../web/src/i18n/types`) that does not exist in a published install. `@mushi-mushi/web` already ships proper `./i18n` types via its `exports` map, which `moduleResolution: "bundler"`/`nodenext` resolves directly.

- Updated dependencies [5feac27]
  - @mushi-mushi/web@1.21.1

## 0.20.0

### Minor Changes

- 90bc9d5: Add the `MushiBanner` lime neon banner launcher to the React Native SDK, mirroring the web widget's banner entry point:

  - New `MushiBanner` component with `MushiBannerProps` and the `MUSHI_BANNER_DEFAULT_HEIGHT` constant.
  - New `'banner'` value for `widget.trigger` so hosts can render the banner as the passive entry point.
  - Reporter-status surface (`reporter-status.ts`) for the My Reports affordance.

  All additions are Hermes-safe (no Node built-ins / browser globals).

### Patch Changes

- Updated dependencies [90bc9d5]
- Updated dependencies [90bc9d5]
  - @mushi-mushi/core@1.21.0
  - @mushi-mushi/web@1.21.0

## 0.19.2

### Patch Changes

- 7b44c97: SDK fixes from automated code review.

  - **Favicon trust boundary** (`@mushi-mushi/core`): `readPageFaviconHref` now returns only http(s) URLs, so a host page can't get a `data:` / `blob:` / `javascript:` favicon rendered into the widget's `<img src>`; anything else falls back to the default mark.
  - **Self-hosted credential message** (`@mushi-mushi/core`, `@mushi-mushi/react-native`): the one-time 401/403 "credentials rejected" warning only links to the hosted console when the client is actually using the Cloud endpoint; self-hosted deployments get a console-agnostic message instead of a wrong domain.
  - **Offline-queue data loss** (`@mushi-mushi/react-native`): `decryptQueueBlob` now decrypts any blob carrying the encrypted prefix regardless of the current `secureStorage` flag. Previously, toggling `secureStorage` from `true` to `false` returned the still-encrypted string, which failed `JSON.parse` and silently cleared the offline report queue.

- Updated dependencies [7b44c97]
  - @mushi-mushi/core@1.19.2

## 0.19.1

### Patch Changes

- 08108e6: Setup UX overhaul: zero-paste `mushi login` browser device-auth, credential error visibility, and docs fixes.

  - **CLI**: `mushi login` now implements RFC 8628 browser device-auth (zero copy-paste). Opens the console in the browser, user clicks Approve, CLI receives a session token automatically, then lists/creates a project and saves the API key. `--api-key` flag remains as the CI/non-interactive fallback.
  - **Core SDK**: 401/403 responses now emit a one-time `console.error` with a clear credential-failure message and the console URL, instead of silently entering the offline retry queue.
  - **React Native**: Same 401/403 credential-failure detection in `MushiProvider.submitReport` — skips enqueue and surfaces the error immediately.

- Updated dependencies [08108e6]
  - @mushi-mushi/core@1.19.1

## 0.19.0

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

- Updated dependencies [a8f183e]
- Updated dependencies [a8f183e]
  - @mushi-mushi/core@1.19.0

## 0.18.1

### Patch Changes

- 8516682: Dependency housekeeping — runtime major-version bumps.

  - **inventory-schema**: migrate to **Zod 4** (`zod@^4.4.3`), aligning with `@mushi-mushi/mcp` and `@mushi-mushi/agents`, which were already on v4. The public API is unchanged; the validation-issue path formatter now handles Zod 4's widened `PropertyKey[]` issue paths.
  - **cli**: bump `commander` to **v15** (ESM-only; the CLI is already pure ESM, so the change is transparent to consumers).
  - **mcp-ci**: bump `@actions/core` to **v3** (ESM-only, Node 24-ready; bundled via tsup).
  - **react-native**: build and test against **react-native 0.86**. `StyleSheet.absoluteFillObject` was dropped from RN 0.86's TypeScript types, so the backdrop style now inlines the equivalent absolute-fill literal — runtime behavior is identical and it compiles against all supported `react-native >= 0.72`.

## 0.18.0

### Minor Changes

- 679b158: Report payload + identity parity with the web SDK, and a web-parity bottom sheet.

  - **Reporter identity (fixes anonymous-token reporter):** `submitReport` now emits nested `metadata.user = { id, email, name, provider }` — the shape the server's `resolveEndUser()` reads — while keeping the flat `userId/userEmail/userName` keys for back-compat. Adds a `setUser()` alias next to `identify()`.
  - **Sentry-level payload:** every report now carries a per-launch `sessionId`, `sdkPackage`/`sdkVersion`/`appVersion`, a device `fingerprintHash`, and a 50-entry breadcrumb ring buffer that is also sent as a derived repro `timeline` (so the admin "Repro timeline" renders instead of nudging "Upgrade the SDK"). New `addBreadcrumb()` method; `setScreen()` auto-adds a navigation breadcrumb.
  - **Screenshots:** new `capture.screenshot` config flag (default on) gating the optional `react-native-view-shot` capture; documented masking guidance for sensitive screens.
  - **Design parity:** `MushiBottomSheet` restyled to mirror the web widget — neon-lime (`#0FFF50`) branded header and accent, dark-ink text on accent surfaces, and clearer "Your reports" / "Community" tabs.

### Patch Changes

- Dependency housekeeping — runtime major-version bumps.

  - **inventory-schema**: migrate to **Zod 4** (`zod@^4.4.3`), aligning with `@mushi-mushi/mcp` and `@mushi-mushi/agents`, which were already on v4. The public API is unchanged; the validation-issue path formatter now handles Zod 4's widened `PropertyKey[]` issue paths.
  - **cli**: bump `commander` to **v15** (now ESM-only; the CLI is already pure ESM, so the change is transparent to consumers).
  - **mcp-ci**: bump `@actions/core` to **v3** (ESM-only, Node 24-ready; bundled via tsup).
  - **react-native**: build and test against **react-native 0.86**. `StyleSheet.absoluteFillObject` was dropped from RN 0.86's TypeScript types, so the backdrop style now inlines the equivalent absolute-fill literal — runtime behavior is identical and it compiles against all supported `react-native >= 0.72`.

- Updated dependencies [679b158]
  - @mushi-mushi/core@1.17.0

## 0.16.0

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

- Updated dependencies [499b716]
- Updated dependencies [499b716]
  - @mushi-mushi/core@1.14.0

## 0.15.2

### Patch Changes

- e422d40: Polish the MCP and Cursor integration path with a shared MCP tool catalog, subpath exports for catalog/server consumers, publish-readiness checks, Cursor plugin bundle validation, and marketplace documentation.

  Fix the web SDK export map so TypeScript consumers consistently resolve generated declarations through package exports, and refine the React Native bottom-sheet reporter experience.

## 0.15.1

### Patch Changes

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

- Updated dependencies [03fabb9]
  - @mushi-mushi/core@1.12.0

## 0.15.0

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

### Patch Changes

- Updated dependencies [59d6fce]
  - @mushi-mushi/core@1.11.0

## 0.14.0

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

### Patch Changes

- Updated dependencies [c0eb84b]
  - @mushi-mushi/core@1.10.0

## 0.13.1

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

## 0.13.0

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

- Updated dependencies
  - @mushi-mushi/core@1.5.0

## 0.12.0

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

### Patch Changes

- Updated dependencies [506df78]
  - @mushi-mushi/core@1.2.0

## 0.11.0

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

### Patch Changes

- Updated dependencies [59627e2]
  - @mushi-mushi/core@1.1.0

## 0.8.2

### Patch Changes

- Updated dependencies [84118af]
  - @mushi-mushi/core@1.0.0

## 0.8.1

### Patch Changes

- Updated dependencies [5e04203]
  - @mushi-mushi/core@0.9.0

## 0.8.0

### Minor Changes

- ef0036d: Ship SDK dogfood hardening and a two-way reporter channel.
  - Ignore Mushi's own config/report/notification requests in network capture and proactive API cascade detection.
  - Add `Mushi.diagnose()` for endpoint, CSP, widget, capture, runtime-config, and SDK-version health checks.
  - Send `sdkPackage` and `sdkVersion` with reports, expose `/v1/sdk/latest-version`, and surface outdated SDK state in the widget.
  - Add `widget.anchor`, deployment presets, privacy screenshot masks/blocks, screenshot removal, `setScreen()`, and normalized repro timelines.
  - Add reporter history/reply APIs so the widget can show report status, developer replies, and reporter responses.
  - Add Capacitor bottom-dock trigger inset presets.

### Patch Changes

- Updated dependencies [ef0036d]
  - @mushi-mushi/core@0.8.0

## 0.7.0

### Minor Changes

- 15462c8: Add production-grade trigger controls for embedded apps: manual and attach modes, runtime show/hide APIs, edge-tab and smart-hide behavior, configurable insets, and React Native custom launcher/shake support.

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

## 0.2.3

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

- Updated dependencies [6e01dc7]
  - @mushi-mushi/core@0.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/core@0.3.0

## 0.2.1

### Patch Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

- Updated dependencies [fc5c58e]
- Updated dependencies [41b6aa7]
  - @mushi-mushi/core@0.2.1

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

- Updated dependencies [7567cee]
- Updated dependencies [7567cee]
- Updated dependencies [7567cee]
- Updated dependencies [7567cee]
  - @mushi-mushi/core@0.2.0

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
