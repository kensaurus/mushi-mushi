# @mushi-mushi/web

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
- **Proactive triggers** — rage click, long task, API cascade failure detection
- **Report fatigue prevention** — session limits, cooldowns, permanent suppression
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

~6 KB brotli, enforced at **15 KB gzipped** via `size-limit` in CI. Requires `@mushi-mushi/core` as a dependency (not bundled inline). The `./test-utils` entry is a separate artifact and is never pulled into production bundles.

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

## Test utilities (`./test-utils`)

Deterministic Playwright / jsdom helpers, published as a separate
entry-point so production bundles pay nothing for them:

```ts
import { triggerBug, openReport, waitForQueueDrain } from '@mushi-mushi/web/test-utils';
```

| Export              | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| `triggerBug(opts?)` | Submit a report bypassing the widget. Returns the server-assigned id.   |
| `openReport(cat?)`  | Open the widget programmatically without submitting.                    |
| `waitForQueueDrain` | Resolve once the offline queue is empty (number remaining at timeout).  |

Every helper no-ops when `Mushi.getInstance()` returns `null`, so
conditional-wiring tests (e.g. cloud vs local targets) don't need to
branch. For browser-context use in Playwright's `page.evaluate`, import
the SDK via the app's own bundle (`window.__mushi__` in dev builds) or
POST to `/v1/reports` directly — `page.evaluate` has no npm resolver in
the browser context.

## License

MIT
