---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/mcp': minor
'@mushi-mushi/cli': minor
'@mushi-mushi/node': patch
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': patch
---

Release tester marketplace, rewards program, dispatch preflight, proactive triggers, and SDK improvements.

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
