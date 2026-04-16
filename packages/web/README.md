# @mushi-mushi/web

Browser SDK for Mushi Mushi — embeddable bug reporting widget with Shadow DOM isolation.

## Features

- Shadow DOM widget with full CSS isolation from host page
- Console log capture (ring buffer)
- Network request capture (fetch interceptor)
- Screenshot capture (canvas-based)
- Web Vitals / performance metrics
- IndexedDB offline queue with auto-sync
- On-device pre-filter (blocks spam before server submission)
- Client-side rate limiting (token bucket self-throttle)
- Light/dark theme with auto-detection
- **Proactive triggers** — rage click, long task, API cascade failure detection
- **Report fatigue prevention** — session limits, cooldowns, permanent suppression

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

~6 KB brotli (limit: 30 KB). Requires `@mushi-mushi/core` as a dependency (not bundled inline).

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

## License

MIT
