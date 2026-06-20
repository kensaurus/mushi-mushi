# @mushi-mushi/web

> **Your AI wrote it. Mushi tells you why it broke.**
> Plain-English diagnosis + a paste-ready fix, right inside Cursor. MIT-licensed SDKs · self-hostable · no second LLM key.

Browser SDK for Mushi Mushi — embeddable bug reporting widget with Shadow DOM isolation.

> **One-command setup:** `npx mushi-mushi` installs this package for vanilla-JS apps (or alongside the framework SDK for Vue, Svelte, Angular).
>
> **Framework SDKs:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) (Next.js / React) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) (Nuxt / Vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) (SvelteKit / Svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor)

## Features

- Shadow DOM widget with full CSS isolation from host page
- Console log capture (ring buffer)
- Network request capture (fetch interceptor)
- Screenshot capture (canvas-based)
- Web Vitals / performance metrics
- IndexedDB offline queue with auto-sync
- On-device pre-filter (blocks spam before server submission)
- Client-side rate limiting (token bucket self-throttle)
- Light/dark theme with auto-detection (`prefers-color-scheme`)
- **Trigger modes** (0.6+) — `auto` / `edge-tab` / `attach` (bring-your-own-button) / `manual` / `hidden`, plus `smartHide`, `hideOnSelector`, `hideOnRoutes`, configurable `inset` and `respectSafeArea`
- **Runtime trigger APIs** — `Mushi.show()`, `Mushi.hide()`, `Mushi.attachTo(selector)`, `Mushi.setTrigger(mode)`, `Mushi.openWith(category)`
- **Widget anchor** (0.9+) — `widget.anchor` accepts raw CSS (including `var()` and `env()`) so the launcher honours your app shell's tab bars, docks, mini-players, and cookie banners without Shadow-DOM patching
- **Presets** (0.9+) — `preset: 'production-calm' | 'beta-loud' | 'internal-debug' | 'manual-only'` flips a coherent bundle of widget / capture / proactive defaults so prod apps stay quiet and internal builds stay loud
- **Proactive triggers** — rage click, long task, API cascade failure detection
- **Report fatigue prevention** — session limits, cooldowns, permanent suppression
- **Privacy controls** (0.9.1+) — `privacy.maskSelectors`, `privacy.blockSelectors`, `privacy.allowUserRemoveScreenshot` for selector-level screenshot redaction and a one-tap "Remove screenshot" button in the panel
- **Repro timeline** (0.10+) — auto-captures route changes, clicks, and SDK lifecycle into a normalised `MushiReport.timeline`; pair with `Mushi.setScreen({ name, route, feature })` for screen-level grouping in the admin
- **Session replay** (1.11+) — opt-in `capture.replay: 'rrweb' | 'lite' | 'sentry' | 'off'` records a rolling buffer that attaches to the report on submit. rrweb masks all text and inputs by default, records continuously from init, and trims while preserving the most recent full snapshot so replays stay playable. Default `'off'`
- **Screenshot annotation** (1.11+) — a "Mark up" button in the panel opens an interactive overlay (highlight / blur / arrow) so reporters can circle the problem and redact sensitive regions before submitting
- **Screenshot preview & consent** (1.19+) — the details step renders the attached screenshot as a visible `<img>` preview (not just a checkmark label) with a **Remove** control and a configurable privacy caption (`widget.screenshotSensitiveHint`: `true` = localized default, `string` = custom copy, `false` = hide caption). Preview stays in sync through the annotate flow. See [`docs/SDK_SCREENSHOT_PREVIEW.md`](../../docs/SDK_SCREENSHOT_PREVIEW.md)
- **Payload size guard** (1.11+) — reports are size-checked client-side; oversized payloads are progressively degraded (drop replay buffer → drop screenshot) and dropped with a `report:failed` event if still too large, so a single large report can never wedge the offline queue
- **Two-way replies** (0.11+) — the panel ships a "Your reports" view that polls comments authored by the dev team and lets the reporter reply, all signed with HMAC against the public API key (no auth user required)
- **Passive inventory discovery** (0.12+) — opt-in `capture.discoverInventory` ships throttled, PII-free observations (route template, page title, `[data-testid]` values, recent fetch paths, query-param **keys** only, sha256 of user/session id) to `POST /v1/sdk/discovery`. The Mushi server aggregates them into a 30-day `discovery_observed_inventory` view and Claude Sonnet drafts a first-pass `inventory.yaml` proposal you can accept on `/inventory ▸ Discovery`. See `MushiDiscoverInventoryConfig` in [`@mushi-mushi/core`](../core)
- **SDK observability** (1.0+) — Sentry-style breadcrumb buffer, sticky tags, and a structured `Mushi.captureException(err)` that auto-attaches them. `installAutoBreadcrumbs()` ships route changes, `console.error/warn`, and `[data-testid]` clicks for free. PII is scrubbed from breadcrumb messages and tag string values at report-snapshot time, before anything leaves the browser
- **Sentry handshake v2** (1.0+) — auto-detects `@sentry/browser` v7 / v8 / v9 and captures the full active scope (`eventId`, `replayId`, `traceId`, `spanId`, `transaction`, `release`, `environment`, `user`, tags, breadcrumbs, issue URL) into `MushiReport.sentryContext`. Tags every Sentry event with `mushi.report_id`, so the admin's report drawer can deep-link `Open in Sentry` and Sentry's issue page can deep-link back into Mushi
- **SDK identity & freshness** (0.8+) — every report ships `sdkPackage` + `sdkVersion`; the widget polls `/v1/sdk/latest-version` and surfaces an outdated banner (configurable via `widget.outdatedBanner`)
- **Self-noise filters** (0.7.1+) — internal Mushi requests are tagged with `X-Mushi-Internal` and excluded from network capture + `apiCascade`; configurable `capture.ignoreUrls` and `proactive.apiCascade.ignoreUrls` for host-app endpoints you also don't want counted
- **`Mushi.diagnose()`** (0.7.1+) — one-call CSP / runtime-config / capture / widget health check (also runs without an init for pre-install smoke tests)
- Keyboard-first: `Esc` to close, `⌘/Ctrl + Enter` to submit, focus-trapped panel
- Honours `prefers-reduced-motion` (animations collapse to instant)

## Design language — "Mushi Mushi Editorial"

The widget is intentionally not a generic SaaS chatbot. The visual system is
defined in [`src/styles.ts`](./src/styles.ts) and uses:

- **Paper + sumi ink** — warm washi cream surface (`#F8F4ED`), deep ink type
  (`#0E0D0B`), and a subtle paper grain. No flat white modal.
- **Vermillion 朱** (`#E03C2C`) — single signature accent, used as a hanko
  stamp colour for the active state, focus underline, submit button, and the
  success-step 朱印 ring.
- **System serif display** — Iowan Old Style → Palatino → Georgia stack for
  headings. Pure system fonts: zero web-font fetch, zero FOUT.
- **Mono metadata** — `ui-monospace` for the `01 / 03` step ledger and
  receipt timestamp, evoking a printer's contents page.
- **Rule lines, not boxes** — categories render as an editorial contents
  list with 1px hairline separators.

All design tokens are named by **material** (`paper`, `ink`, `rule`,
`vermillion`) rather than role (`primary`, `secondary`) so the palette is
hard to dilute via a generic rename later.

## Contents

### Proactive Manager (`proactive-manager.ts`)

Controls report prompt frequency to prevent fatigue:
- `maxProactivePerSession` (default 2) — cap per browser session
- `dismissCooldownHours` (default 24) — suppress after dismissal
- `suppressAfterDismissals` (default 3) — permanently disable after N consecutive dismissals
- Smart dedup — same trigger type not shown twice per session

### Proactive Triggers (`proactive-triggers.ts`)

Auto-detects conditions that should prompt the user:
- **Rage click** — 3+ clicks in < 500ms on same element
- **Long task** — > 5s main thread block (PerformanceObserver)
- **API cascade** — 3+ failed requests in 10s window
- **Error boundary** — global `window.error` and `unhandledrejection` events (opt-in via `errorBoundary: true`)

Each trigger respects its config flag — set `rageClick: false` to disable rage click detection, etc.

## Known Limitations

**Screenshot capture** uses canvas/SVG `foreignObject` serialization. This does not work with cross-origin iframes, tainted `<canvas>` elements, or pages with strict CSP. Best-effort on single-origin SPAs.

## Bundle Size

~7 KB brotli, enforced at **72 KB gzipped** (105 KB uncompressed) via `size-limit` in CI — budget raised for the 2026 editorial widget refresh + screenshot preview/consent surface. Requires `@mushi-mushi/core` as a dependency (not bundled inline). The `./test-utils` entry is a separate artifact and is never pulled into production bundles.

## Quick Start

```typescript
import { Mushi } from '@mushi-mushi/web';

Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'your-api-key',
  widget: { position: 'bottom-right', theme: 'auto' },
  capture: { console: true, network: true, screenshot: 'on-report' },
});
```

### Bring your own launcher (`trigger: 'attach'`)

For mature production apps, prefer hosting the launcher inside your own help
menu, settings page, or beta banner. Mushi will not inject any UI of its own.

```typescript
const mushi = Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    trigger: 'attach',
    attachToSelector: '[data-mushi-feedback]',
  },
});

mushi.attachTo('#support-menu-feedback');
mushi.hide();
```

### Smart-hide (`trigger: 'auto'` with viewport awareness)

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    trigger: 'auto',
    smartHide: { onMobile: 'edge-tab', onScroll: 'shrink', onIdleMs: 900 },
    inset: { bottom: 96, right: 20 },
    hideOnSelector: '[data-fullscreen-player]',
    hideOnRoutes: ['/checkout/payment'],
    respectSafeArea: true,
  },
});
```

See [Trigger modes](https://docs.mushimushi.dev/concepts/trigger-modes) for the
full posture matrix (`auto` / `edge-tab` / `attach` / `manual` / `hidden`).

### With Proactive Triggers

Proactive triggers are wired into `Mushi.init()` automatically when `config.proactive` is provided. The SDK opens the widget when a trigger fires, gated by fatigue prevention:

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'your-api-key',
  proactive: {
    rageClick: true,
    longTask: true,
    apiCascade: true,
    errorBoundary: true,
    cooldown: {
      maxProactivePerSession: 2,
      dismissCooldownHours: 24,
      suppressAfterDismissals: 3,
    },
  },
});
```

For manual composition (advanced), the lower-level APIs are also exported:

```typescript
import { createProactiveManager, setupProactiveTriggers } from '@mushi-mushi/web';

const manager = createProactiveManager({ maxProactivePerSession: 2 });

setupProactiveTriggers({
  onTrigger: (type, context) => {
    if (manager.shouldShow(type)) {
      // Custom handling
    }
  },
});
```

### Self-noise filters and CSP diagnostics

Out of the box the SDK tags every request it makes with `X-Mushi-Internal` and skips
those URLs in `capture.network` + `proactive.apiCascade`, so an unconfigured CSP
or a flaky local Supabase stack can no longer make Mushi report on Mushi:

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  // 'auto' (default) skips the runtime-config fetch on localhost endpoints —
  // pass `true` to force it everywhere, `false` to disable entirely.
  runtimeConfig: 'auto',
  capture: {
    network: true,
    ignoreUrls: [/\/api\/internal\//, 'https://posthog.example.com'],
  },
  proactive: {
    apiCascade: {
      enabled: true,
      ignoreUrls: ['https://feature-flags.example.com'],
    },
  },
});

const health = await Mushi.diagnose();
// → { apiEndpointReachable, cspAllowsEndpoint, widgetMounted, shadowDomAvailable,
//     dialogSupported, runtimeConfigLoaded, captureScreenshotAvailable,
//     captureNetworkIntercepting, sdkVersion,
//     widgetHostPointerSafe, widgetHostBounds, widgetSuppressed, bannerRendered }
//
// widgetHostPointerSafe — true when the host element is zero-sized and
//   pointer-events:none (i.e. the SDK cannot block any host-app touch targets).
// widgetSuppressed      — true when hidden by hideOnSelector / hideOnRoutes / hide().
// bannerRendered        — true when trigger:'banner' and banner is visible.
```

`Mushi.diagnose()` works **before** `Mushi.init()` too — call it from a debug
console or installer wizard to surface CSP / endpoint problems with zero risk
of accidentally booting the widget.

### Host-element pass-through contract

The Mushi SDK guarantees it will **never block host-app UI** by default. The
host element (`#mushi-mushi-widget`) is always:

- `position: fixed; top: 0; left: 0`
- `width: 0; height: 0; overflow: visible` — zero-sized, shadow internals extend outward
- `pointer-events: none` — clicks and touches pass straight through to the page

Only the visible widget controls (`.mushi-trigger`, `.mushi-banner`, `.mushi-panel`)
opt back into `pointer-events: auto` inside the Shadow DOM.

If you want to verify this at runtime:

```typescript
const health = await Mushi.diagnose();
console.assert(health.widgetHostPointerSafe, 'Mushi host is blocking UI!');
```

### Suppressing Mushi during fullscreen flows

For fullscreen modals, onboarding, games, video players, or checkout screens where
you need complete interaction isolation, use `hideOnSelector`. **This suppresses
both the trigger button and the banner** (they are unified — no surface leaks through):

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    trigger: 'banner',
    // Hide ALL SDK launcher surfaces while any of these elements are in the DOM.
    hideOnSelector: '[data-onboarding-flow], [data-fullscreen-modal], [data-game-active]',
    hideOnRoutes: ['/checkout/payment', '/quiz/'],
  },
});
```

For dynamic route-based suppression you can also call `Mushi.hide()` / `Mushi.show()`
programmatically; the body-offset nudge from `trigger:'banner'` is removed automatically
on every hide path.

> **Capacitor / WebView note:** In native WebView shells (iOS WKWebView, Android
> WebViewClient), `pointer-events:none` alone is not always sufficient — some versions
> of Chromium-based WebViews still route touch events to `fixed` overlay elements that
> sit at a certain z-index. Use `hideOnSelector` or `Mushi.hide()` for the safest
> experience in native shells.

### Rich banner layout (1.8+)

With `trigger: 'banner'`, setting `bannerConfig.message` switches the strip from
button-only CTAs to the rich layout used by the Mushi admin console's beta
banner — a pill label, body copy, and flat text actions:

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    trigger: 'banner',
    bannerConfig: {
      variant: 'brand',          // 'neon' | 'brand' | 'subtle'
      position: 'top',           // 'top' | 'bottom'
      message: 'Mushi is in beta — spotted something off? Tell us.',
      label: 'Beta',             // pill before the message; `false` hides it
      bugCta: '🐛 Report a bug',
      featureCta: true,
      links: [
        { label: 'My submissions', href: 'https://app.example.com/feedback' },
        { label: 'Request a feature', featureRequest: true }, // opens widget in feature mode
      ],
    },
  },
});
```

- All banner text renders via `textContent` — never HTML — so server- or
  CMS-sourced copy can't inject markup.
- `links[].href` opens in a new tab with `rel="noopener noreferrer"`; omit
  `href` and set `featureRequest: true` to open the widget instead.
- `message` and `label` can also be driven remotely per-project from the
  dashboard runtime config (`bannerMessage` / `bannerLabel`), so you can change
  the copy without a deploy. `links` are local-config only.
- Without `message`, the banner keeps the original compact button-only layout —
  existing integrations are unchanged.

### Presets and widget anchor

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  // production-calm = manual trigger, screenshot only on report, no proactive prompts
  // beta-loud       = proactive triggers + console + network always on
  // internal-debug  = above + verbose debug + always-on screenshot
  // manual-only     = trigger only, every proactive surface off
  preset: 'production-calm',
  widget: {
    // Raw CSS strings (including `var()` and `env()`) win over `position` /
    // `inset` so the launcher tracks your app shell's tab bars or mini-player.
    anchor: {
      bottom: 'calc(var(--app-dock-h, 0px) + env(safe-area-inset-bottom))',
      right: 'calc(0.75rem + env(safe-area-inset-right))',
    },
    brandFooter: true,
    outdatedBanner: 'auto',
  },
});
```

### Privacy and screenshot redaction

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  privacy: {
    maskSelectors: ['[data-private]', 'input', '.thai-answer-draft'],
    blockSelectors: ['[data-payment]', '[data-auth-token]'],
    allowUserRemoveScreenshot: true,
  },
});
```

`maskSelectors` paints a solid block over matching elements before serialisation;
`blockSelectors` removes them entirely. `allowUserRemoveScreenshot` adds a
"Remove screenshot" affordance next to the attachment chip in the panel, so the
reporter can yank a screenshot they didn't realise contained sensitive data.

### Session replay (1.11+)

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  capture: {
    // 'rrweb'  — full DOM replay via rrweb (lazy-loaded; text + inputs masked)
    // 'lite'   — dependency-free fallback (coarse mutation + interaction log)
    // 'sentry' — reuse an already-installed @sentry/replay session
    // 'off'    — default
    replay: 'rrweb',
  },
});
```

The buffer records **continuously from init** (so it captures the moments leading
up to a report, not just after the panel opens) and is trimmed to a rolling
window while preserving the most recent full snapshot — replays stay playable.
All text and inputs are masked by default. The events ride along on
`MushiReport.replayEvents`; the server only persists them when the project has
opted into replay storage. If a report grows too large, the replay buffer is the
first thing dropped (then the screenshot) before the report itself is ever
discarded — see **Payload size guard** above.

### Repro timeline and `setScreen()`

```typescript
const mushi = Mushi.init({ /* ... */ });
mushi.setScreen({ name: 'Chat', route: '/chat', feature: 'roleplay' });
```

The SDK auto-records `route` (initial + `pushState` / `popstate` / `hashchange`),
`click` (with selector + text snippet), and `screen` events into a 120-entry
ring buffer. Submissions ship the trail as `MushiReport.timeline` and the admin
console renders it as a chronological "what happened before the report" card on
`/reports/:id`.

### Power-user APIs (1.0+)

Once `Mushi.init()` has resolved (cloud or self-hosted) the returned instance
exposes a Sentry-style observability surface that ships on every subsequent
report — without you having to plumb it through the report payload yourself:

```typescript
const mushi = Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

// Identify the active reporter (also sent to Sentry if @sentry/browser is loaded).
mushi.identify('usr_42', { email: 'aya@example.com', segment: 'beta' });

// Sticky scalar tags. Up to 64 keys; values are string | number | boolean.
mushi.setTag('feature', 'checkout-v2');
mushi.setTags({ plan: 'pro', region: 'apac', experiment: 'B' });
mushi.clearTag('experiment');

// Manual breadcrumbs — route changes / console.error / [data-testid] clicks
// are captured automatically by `installAutoBreadcrumbs`.
mushi.addBreadcrumb({
  category: 'business',
  level: 'info',
  message: 'cart.checkout_started',
  data: { itemCount: 3, currency: 'JPY' },
});

// Structured exception capture. Accepts Error, string, plain object, null,
// or undefined — anything `try { } catch (e) { }` can land on. The SDK
// normalises the throw, attaches the breadcrumb buffer + sticky tags +
// Sentry context, and submits as a `bug` report.
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

The dedicated server columns `reports.breadcrumbs` (jsonb, GIN-indexed),
`reports.tags` (jsonb, GIN-indexed), and `reports.sentry_trace_id` /
`sentry_release` / `sentry_environment` (text, btree-indexed) make the
admin's `/reports` page filterable by `tags @> '{feature: checkout-v2}'`,
`?trace=…`, `?release=…`, `?sentryEnv=…` in O(index-lookup) instead of an
O(full-scan) traversal of `custom_metadata`.

### Two-way replies (Your reports)

The widget mounts a "Your reports" tab that lists this reporter's history,
unread admin replies (with a count badge on the trigger), and a reply input.
Calls are signed with an HMAC over `projectId.timestamp.sha256(reporterToken)`
using the public API key as the secret, so no Supabase auth is required.

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: { brandFooter: true, outdatedBanner: 'auto' },
});
```

Endpoints (Edge Function): `GET /v1/reporter/reports`,
`GET /v1/reporter/reports/:id/comments`, `POST /v1/reporter/reports/:id/reply`.
The DB-side `report_comments_fanout_to_reporter` trigger creates a
`reporter_notifications` row whenever a `visible_to_reporter` admin comment
lands, so the unread count stays in sync without polling.

### Passive inventory discovery (v2.1)

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  capture: {
    // `true` enables defaults (60s per-route throttle, heuristic
    // route normalisation). Pass an object for fine-grained control.
    discoverInventory: {
      enabled: true,
      throttleMs: 60_000,
      // Optional — your framework's known route templates so we don't
      // have to guess `/practice/abc-123` → `/practice/[id]`.
      routeTemplates: ['/practice/[id]', '/lessons/[slug]'],
    },
  },
});
```

Each emission is one row on `POST /v1/sdk/discovery`:

```jsonc
{
  "route": "/practice/[id]",
  "page_title": "Practice — Glot.it",
  "dom_summary": "…≤200 chars…",
  "testids": ["practice-submit", "practice-hint"],
  "network_paths": ["/api/practice/run", "/rest/v1/answers"],
  "query_param_keys": ["lang"],
  "user_id_hash": "sha256(…)",
  "observed_at": "2026-05-04T12:00:00Z"
}
```

Open `/inventory ▸ Discovery` in the admin to watch routes accumulate,
hit **Generate proposal**, then **Accept** to write the LLM-drafted
`inventory.yaml` into the project. Nothing else changes about the SDK —
the discovery channel is independent of the bug-report widget and stays
quiet under `prefers-reduced-motion` / when the tab is hidden.

## Test utilities (`./test-utils`)

Deterministic Playwright / jsdom helpers, published as a separate
entry-point so production bundles pay nothing for them:

```ts
import { triggerBug, openReport, waitForQueueDrain } from '@mushi-mushi/web/test-utils';
```

| Export                       | Purpose                                                                                                                     |
|------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `triggerBug(opts?)`          | Submit a report bypassing the widget. Returns the server-assigned id.                                                       |
| `openReport(cat?)`           | Open the widget programmatically without submitting.                                                                        |
| `openMushiWidget(cat?)`      | Alias for `openReport` — Playwright-friendly name for the dogfood contract suite.                                           |
| `waitForQueueDrain`          | Resolve once the offline queue is empty (number remaining at timeout).                                                      |
| `expectMushiReady(opts?)`    | Resolve with a `MushiDiagnosticsResult` once the SDK is initialised and reachable. Fails if `apiEndpointReachable === false`. |
| `expectNoMushiSelfCascade()` | Run an action and assert no internal Mushi request fired the `api_cascade` proactive trigger. Catches CSP / runtime-config self-noise. |

Every helper no-ops when `Mushi.getInstance()` returns `null`, so
conditional-wiring tests (e.g. cloud vs local targets) don't need to
branch. For browser-context use in Playwright's `page.evaluate`, import
the SDK via the app's own bundle (`window.__mushi__` in dev builds) or
POST to `/v1/reports` directly — `page.evaluate` has no npm resolver in
the browser context.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 50 edge functions · 278 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
