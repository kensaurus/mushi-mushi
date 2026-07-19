# @mushi-mushi/capacitor

> **Your AI wrote it. Mushi tells you why it broke.**

Capacitor plugin for [Mushi Mushi](https://kensaur.us/mushi-mushi) — the open-source,
LLM-driven bug intake, classification, and autofix platform.

> **One-command setup:** `npx mushi-mushi` auto-detects Capacitor and installs this package.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

> **Status**: v0.8.x surface stable; API may evolve before a coordinated 1.0 across all packages.

The Capacitor plugin uses a **public ingest key** (`mush_pk_…`) — not the `mushi_…` web key. See [Project ID & API keys](https://kensaur.us/mushi-mushi/docs/concepts/credentials).

The npm package vendors the standalone iOS and Android SDK sources for the
native side, so Capacitor apps do not need a separate Maven or SwiftPM Mushi
dependency at build time.

## Install

```bash
npm install @mushi-mushi/capacitor
npx cap sync
```

## Quickstart

```ts
import { Mushi } from '@mushi-mushi/capacitor';

await Mushi.configure({
  projectId: 'proj_...',
  apiKey: 'mush_pk_...',
  triggerMode: 'both',
  captureScreenshot: true,
  minDescriptionLength: 20,
});

// Programmatic report:
await Mushi.report({
  description: 'Profile photo upload spinner never stops on tablets',
  category: 'bug',
});

// Listen for successful submissions (e.g. to mirror into Sentry):
const handle = await Mushi.addListener('reportSubmitted', (payload) => {
  console.log('Mushi submitted', payload);
});

// Native widget:
await Mushi.showWidget();
```

### Breadcrumbs

Append entries to the native ring buffer (50-entry FIFO, flushed with
every report). The bridge round-trips through the iOS / Android
`Mushi.addBreadcrumb()` so the same shape lands on every platform.

```ts
await Mushi.addBreadcrumb({
  category: 'ui.tap',          // or 'navigation' | 'console' | 'network' | 'lifecycle' | 'custom'
  level: 'info',               // optional — 'debug' | 'info' | 'warning' | 'error' (default 'info')
  message: 'Tapped Save',
  data: { screen: 'profile' }, // optional — non-string values are coerced to strings
});

const { breadcrumbs } = await Mushi.getBreadcrumbs();
```

> Native enums emit `ui.tap` and `network` (touch devices, native
> network stacks); the web SDK emits `ui.click` / `xhr` / `fetch`.
> Admin tooling treats them as the same buckets.

## Web fallback

When the app runs in a browser preview (`ionic serve`), the plugin falls back
to a pure-TS implementation that calls the same `@mushi-mushi/core` API
client used by the standalone web SDK. Behaviour matches production exactly.

## Permissions

No runtime permissions required. iOS uses `motionShake`; Android uses the
accelerometer (no permission needed). The widget is rendered via the native
bottom sheet from the standalone SDKs.

## Configuration

| Field                  | Default                              | Notes |
|------------------------|--------------------------------------|-------|
| `projectId`            | _required_                           | Project UUID |
| `apiKey`               | _required_                           | Public ingest key (`mush_pk_...`) |
| `endpoint`             | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`         | Override for self-hosting |
| `triggerMode`          | `'shake'`                            | `'shake'` / `'button'` / `'both'` / `'none'` |
| `captureScreenshot`    | `true`                               | Disable for HIPAA-sensitive flows |
| `minDescriptionLength` | `20`                                 | Matches the web/native SDK contracts |
| `useNativeWidget`      | `false`                              | When `true`, uses the bottom-sheet from the native SDK |
| `triggerInset`         | `{ right: 24, bottom: 32 }`          | Per-edge offset (in points / dp) forwarded to the iOS `MushiConfig.TriggerInset` and Android `MushiConfig.TriggerInset` so the native FAB clears tab bars and primary CTAs |
| `triggerInsetPreset`   | _none_                               | `'tabBarSafe'` (≈72 pt bottom — apps with a bottom tab bar) or `'dockSafe'` (≈96 pt bottom — apps with a tall iOS-style dock or mini-player). Only fills in fields you didn't already set on `triggerInset`, so you can override per-edge while keeping the safe baseline |

## License

MIT — see [LICENSE](../../LICENSE) at the repo root.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 325 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
