# @mushi-mushi/web

> **Your AI wrote it. Mushi tells you why it broke.**

Framework-agnostic browser SDK for [Mushi Mushi](https://www.npmjs.com/package/mushi-mushi) — an embeddable bug-reporting widget that captures a screenshot, the route, the user's note, and the last few seconds of console + network activity, then hands you a plain-English diagnosis in your editor. Renders inside a Shadow DOM, so your CSS never leaks in or out.

> **One-command setup:** `npx mushi-mushi` installs this package for vanilla-JS apps (or alongside a framework SDK).
>
> **Framework SDKs:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) (Next.js / React) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor)

## Install

```bash
npm install @mushi-mushi/web
# or: npx mushi-mushi
```

## Quick start

```typescript
import { Mushi } from '@mushi-mushi/web';

Mushi.init({
  projectId: '00000000-0000-0000-0000-000000000000', // UUID from Admin → Projects
  apiKey: 'mushi_xxx',   // report:write key from Setup → Verify (not Settings → BYOK)
  widget: { position: 'bottom-right', theme: 'auto' },
  capture: { console: true, network: true, screenshot: 'on-report' },
});
```

That's the whole integration. A floating 🐛 launcher appears; a report is one click away.

## Runtime config

With `runtimeConfig: 'auto'` (default), the SDK fetches console settings from
`GET /v1/sdk/config` and merges them over your init — so you can tune the widget
from **Projects → SDK install** without rebuilding. Host-wired values (banner
trigger, capture flags) win over console defaults.

→ [Runtime config docs](https://kensaur.us/mushi-mushi/docs/concepts/runtime-config) ·
maintainer deep-dive: [SDK_RUNTIME_CONFIG.md](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_RUNTIME_CONFIG.md)

## Features

- Shadow-DOM widget with CSS isolation, light/dark auto-theme, keyboard-first (`Esc` / `⌘+Enter`), and `prefers-reduced-motion`.
- Screenshot, console ring buffer, network (fetch interceptor), Web Vitals, and a repro timeline of routes + clicks.
- IndexedDB offline queue with auto-sync, on-device spam pre-filter, client-side rate limiting, and a payload-size guard that degrades instead of wedging the queue.
- Host element is zero-sized with `pointer-events: none`; only visible controls opt back in. Verify with `Mushi.diagnose()`.
- Selector-level screenshot masking/blocking, a one-tap "Remove screenshot" control, and a built-in PII scrubber.

## Trigger modes

Choose where and when the launcher shows — `auto`, `edge-tab`, `attach` (bring your own button), `manual`, or `hidden` — plus viewport-aware `smartHide`, route/selector suppression, and `anchor` CSS that tracks your app shell's tab bars or mini-players.

```typescript
// Bring your own launcher — Mushi injects no UI of its own.
const mushi = Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: { trigger: 'attach', attachToSelector: '[data-mushi-feedback]' },
});
mushi.attachTo('#support-menu-feedback');
```

→ Full posture matrix in [Trigger modes](https://kensaur.us/mushi-mushi/docs/concepts/trigger-modes). Coherent defaults via [SDK presets](https://kensaur.us/mushi-mushi/docs/sdks/presets) (`production-calm` / `beta-loud` / `internal-debug` / `manual-only`).

<details>
<summary><b>Proactive triggers</b> — open the widget on rage clicks, long tasks, or API cascades</summary>

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  proactive: {
    rageClick: true,
    longTask: true,
    apiCascade: true,
    errorBoundary: true, // catch global error / unhandledrejection
    cooldown: { maxProactivePerSession: 2, dismissCooldownHours: 24, suppressAfterDismissals: 3 },
  },
});
```

Each trigger respects its config flag (set `rageClick: false` to disable). Fatigue prevention (session limits, cooldowns, permanent suppression) is always on.
</details>

<details>
<summary><b>Privacy &amp; screenshot redaction</b></summary>

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  privacy: {
    maskSelectors: ['[data-private]', 'input'],   // painted over before serialisation
    blockSelectors: ['[data-payment]', '[data-auth-token]'], // removed entirely
    allowUserRemoveScreenshot: true,              // one-tap "Remove screenshot" in panel
  },
});
```

The details step renders the attached screenshot as a visible preview (not just a checkmark) with a **Remove** control and a configurable privacy caption (`widget.screenshotSensitiveHint`). A "Mark up" overlay lets reporters highlight / blur / arrow before submitting.
</details>

<details>
<summary><b>Session replay</b> — opt-in rolling buffer attached on submit</summary>

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  capture: {
    // 'rrweb' — full DOM replay (lazy-loaded; text + inputs masked by default)
    // 'lite'  — dependency-free coarse fallback
    // 'sentry'— reuse an installed @sentry/replay session
    // 'off'   — default
    replay: 'rrweb',
  },
});
```

Records continuously from init (so you capture the moments *before* the report), trimmed to a rolling window. Already on Sentry Replay? See [coexistence](https://kensaur.us/mushi-mushi/docs/sdks/sentry-replay-coexistence).
</details>

<details>
<summary><b>Power-user APIs</b> — identify, tags, breadcrumbs, structured exception capture</summary>

```typescript
const mushi = Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

mushi.identify('usr_42', { email: 'aya@example.com', segment: 'beta' });
mushi.setTags({ plan: 'pro', region: 'apac' });
mushi.addBreadcrumb({ category: 'business', message: 'cart.checkout_started', data: { itemCount: 3 } });

try {
  await runCheckout();
} catch (err) {
  // Normalises any throw, attaches breadcrumbs + sticky tags + Sentry context.
  mushi.captureException(err, { level: 'error', tags: { surface: 'checkout' } });
}
```

`installAutoBreadcrumbs()` ships route changes, `console.error/warn`, and `[data-testid]` clicks for free. PII is scrubbed before anything leaves the browser. Auto-detects `@sentry/browser` v7–v9 and captures the active scope into `MushiReport.sentryContext`, with deep-links both ways.
</details>

<details>
<summary><b>Two-way replies &amp; Rewards</b> — let reporters follow up and earn points, no login</summary>

The widget's "Your reports" tab lets reporters see team replies and respond, signed via HMAC against the public API key (no auth user required): `mushi.listMyReports()`, `mushi.listMyComments(id)`, `mushi.replyToReport(id, text)`. Call `mushi.identify()` and add a `rewards` block to track activity, tiers, and points. See [Rewards & contributor identity](https://kensaur.us/mushi-mushi/docs/concepts/rewards).
</details>

<details>
<summary><b>Runtime control &amp; self-noise filters</b> — imperative APIs and CSP-safe defaults</summary>

```typescript
const mushi = Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  // 'auto' (default) skips the runtime-config fetch on localhost endpoints;
  // pass `true` to force everywhere, `false` to disable entirely.
  runtimeConfig: 'auto',
  capture: { network: true, ignoreUrls: [/\/api\/internal\//] },
  proactive: { apiCascade: { enabled: true, ignoreUrls: ['https://feature-flags.example.com'] } },
});

mushi.show();
mushi.hide();
mushi.setTrigger('manual');          // switch posture at runtime
mushi.openWith('bug');               // open straight into a category
mushi.attachTo('#support-menu');     // bind the launcher to your element
```

Internal Mushi requests are tagged `X-Mushi-Internal` and excluded from network capture + `apiCascade`, so an unconfigured CSP or a flaky local Supabase stack can never make Mushi report on Mushi. For advanced composition, `createProactiveManager()` and `setupProactiveTriggers()` are exported so you can wire friction detection into your own UI.
</details>

<details>
<summary><b>Repro timeline</b> — <code>setScreen()</code> and the "what happened before" trail</summary>

```typescript
const mushi = Mushi.init({ /* ... */ });
mushi.setScreen({ name: 'Chat', route: '/chat', feature: 'roleplay' });
```

The SDK auto-records route changes (`pushState` / `popstate` / `hashchange`), clicks (with selector + text snippet), and screen events into a 120-entry ring buffer, shipped as `MushiReport.timeline`. The admin renders it as a chronological "what happened before the report" card.
</details>

<details>
<summary><b>Rich banner layout</b> — <code>trigger: 'banner'</code> with remote-driven copy</summary>

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    trigger: 'banner',
    bannerConfig: {
      variant: 'brand',          // 'neon' | 'brand' | 'subtle'
      position: 'top',
      message: 'Mushi is in beta — spotted something off? Tell us.',
      label: 'Beta',             // pill before the message; `false` hides it
      bugCta: '🐛 Report a bug',
      featureCta: true,
      links: [{ label: 'My submissions', href: 'https://app.example.com/feedback' }],
    },
  },
});
```

All banner text renders via `textContent` (never HTML), so CMS-sourced copy can't inject markup. `message` and `label` can also be driven remotely per project from the dashboard runtime config — change copy without a deploy.
</details>

<details>
<summary><b>Passive inventory discovery</b> — opt-in, PII-free route observations</summary>

```typescript
Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  capture: {
    discoverInventory: {
      enabled: true,
      throttleMs: 60_000,
      routeTemplates: ['/practice/[id]', '/lessons/[slug]'],
    },
  },
});
```

Ships throttled, PII-free observations (route template, page title, `[data-testid]` values, recent fetch paths, query-param **keys** only, hashed user/session id) to `POST /v1/sdk/discovery`. The server aggregates them and drafts a first-pass `inventory.yaml` you can accept in **/inventory ▸ Discovery**. See [Inventory & gates](https://kensaur.us/mushi-mushi/docs/concepts/inventory-and-gates).
</details>

## Host pass-through contract

Mushi never blocks your app's UI. The host element (`#mushi-mushi-widget`) is `position: fixed`, zero-sized, with `pointer-events: none` — only the visible controls opt back into `pointer-events: auto` inside the Shadow DOM. In native WebView shells (iOS WKWebView, some Android Chromium builds) where `pointer-events: none` isn't always honoured on fixed overlays, use `hideOnSelector` or `Mushi.hide()` during fullscreen flows. Verify at runtime:

```typescript
const health = await Mushi.diagnose();
console.assert(health.widgetHostPointerSafe, 'Mushi host is blocking UI!');
```

## Health check

```typescript
const health = await Mushi.diagnose();
// → { apiEndpointReachable, cspAllowsEndpoint, widgetMounted, widgetHostPointerSafe, ... }
```

Runs **before** `Mushi.init()` too — call it from a debug console or installer wizard to surface CSP / endpoint problems with zero risk of booting the widget.

## Test utilities

Deterministic Playwright / jsdom helpers, published as a separate entry-point so production bundles pay nothing for them:

```ts
import { triggerBug, openReport, waitForQueueDrain, expectMushiReady } from '@mushi-mushi/web/test-utils';
```

Every helper no-ops when `Mushi.getInstance()` returns `null`, so cloud-vs-local conditional-wiring tests don't need a branch.

## Known limitations

Screenshot capture uses canvas / SVG `foreignObject` serialization — it does not work with cross-origin iframes, tainted `<canvas>` elements, or pages with strict CSP. Best-effort on single-origin SPAs.

## Bundle size

~7 KB brotli, enforced at 88 KB gzipped (105 KB uncompressed) in CI. Requires `@mushi-mushi/core` (installed automatically, not bundled inline). The widget's visual system — washi paper, sumi ink, vermillion 朱 accent, system serif — lives in [`src/styles.ts`](./src/styles.ts).

## License

MIT

<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 327 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
