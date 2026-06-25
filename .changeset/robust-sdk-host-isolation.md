---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

Harden the SDK so it can't break or visibly thrash a host app — across web, SSR, and native-WebView (Capacitor/Cordova/React-Native) integrations — and make transport resilient on flaky networks.

**Web (`@mushi-mushi/web`)**

- **SSR / non-DOM safety:** `Mushi.init()` returns a no-op instance when `document`/`window` are unavailable (Next.js / Remix / Nuxt server components, plain Node SSR) instead of throwing when the widget constructs DOM nodes. A stray server-side init no longer takes down the host page.
- **Public-API error isolation:** every public method is wrapped so a throw or rejection is logged + breadcrumbed and swallowed with a type-safe fallback. A malformed build or unexpected SDK state can never crash the host (including `diagnose()`, which still resolves to a valid result on the error path).
- **Screenshot provider fallback:** a custom `screenshotProvider` that returns `null` now falls through to the built-in DOM capturer instead of silently producing no screenshot.
- **Identify de-duplication:** `identify()` / `identifyWithToken()` skip the widget re-render and rewards/inbox refetch when the same user/token-subject is re-applied — hosts that re-identify on every focus / `visibilitychange` / auth re-check no longer flash the banner or thrash the rewards API.
- **Runtime-config banner re-assert:** a console-pushed banner change (re-enabled trigger or new copy) clears a stale session dismissal so it actually reappears.
- **Proactive triggers** no longer force-open the reporter while offline.

**Core (`@mushi-mushi/core`)**

- **Endpoint circuit breaker:** after consecutive unreachable failures the API client fast-fails for a cooldown (then half-opens) instead of hammering a down endpoint; fast-failed reports still reach the offline queue. Opt out via `circuitBreaker.enabled: false`.
- **Configurable transport:** `timeout`, `maxRetries`, and `circuitBreaker` are now exposed on `MushiConfig` and threaded into the API client. `DEFAULT_TIMEOUT` / `DEFAULT_MAX_RETRIES` are exported.
- **Native-shell detection:** best-effort `capacitor` / `cordova` / `reactNative` flags on `MushiEnvironment.native` (SSR-guarded) so triage can distinguish native-WebView reports from browser ones.
