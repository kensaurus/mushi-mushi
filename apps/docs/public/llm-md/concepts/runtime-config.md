# Runtime config

Source: https://kensaur.us/mushi-mushi/docs/concepts/runtime-config

---
title: Runtime config
---

# Runtime config

Most apps need no extra wiring. With `runtimeConfig: 'auto'` (the default), the
SDK fetches `GET /v1/sdk/config` after init and merges console-side settings
over your host config — so you can tune the widget, capture flags, and banner
copy from **Projects → SDK install** without rebuilding.

  Host `init()` still wins when you wired something explicitly — for example
  `widget: { trigger: 'banner' }` or `capture: { screenshot: 'off' }`. The
  console cannot silently reset those back to defaults.

## Setup default

```typescript
Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: 'YOUR_API_KEY',
  // runtimeConfig defaults to 'auto' — no action needed
})
```

Set `runtimeConfig: false` only when you want a fully static config (no console
overlay). See [Next.js static export](/sdks/nextjs-static-export) for offline
builds.

## When host init wins

| You set in code | Console sends | Result |
| --- | --- | --- |
| `widget.trigger: 'banner'` | `launcher: 'auto'` (default) | Banner stays — default launcher is ignored |
| `widget.trigger: 'attach'` | Any launcher | Attach mode stays |
| `capture.screenshot: 'off'` | Unconfigured (default on-report) | Screenshot stays off |
| `capture.console: true` | `console: false` | Console capture turns off (console explicitly set it) |
| Nothing (defaults) | Banner message + variant | Console banner applies |

Full precedence rules:
[SDK_RUNTIME_CONFIG.md](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_RUNTIME_CONFIG.md)

## Console tuning without rebuild

1. Open **Projects →** your project → **SDK install**
2. Change launcher, banner copy, capture toggles, or screenshot privacy caption
3. Save — live apps pick it up on the next config fetch (usually within seconds)

No npm publish or app store resubmit required for these knobs.

## Widget draft persistence

If the report panel re-renders in the background (route change, theme toggle,
runtime config refresh), typed description, email, and reply text are preserved
along with cursor position. Drafts clear when the reporter submits or starts a
fresh report session.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Top banner vanished after saving console config | Host had `trigger: 'banner'`; old server always sent `launcher: 'auto'` | Upgrade to latest `@mushi-mushi/web`. Host banner wiring now wins over console defaults. |
| Console toggle has no effect | `runtimeConfig: false` or SDK never heartbeats | Set `runtimeConfig: 'auto'` and confirm project ID + API key |
| Capture button missing | Host or console disabled that capture mode | Check `capture.screenshot` / `capture.elementSelector` in init and SDK install card |
| Reporter lost typed text mid-report | Pre-fix SDK rebuild | Upgrade `@mushi-mushi/web` — drafts persist across re-renders |

## Related

- [Trigger modes](/concepts/trigger-modes) — launcher posture matrix
- [@mushi-mushi/web](/sdks/web) — SDK reference
- [Screenshot preview deep-dive](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_SCREENSHOT_PREVIEW.md)
