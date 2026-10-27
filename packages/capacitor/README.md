# @mushi-mushi/capacitor

> **Your AI wrote it. Mushi tells you why it broke.**

The Capacitor and Ionic plugin for [Mushi Mushi](https://kensaur.us/mushi-mushi). Users shake the phone or tap a button to report a bug. Mushi gets a screenshot and their note, explains the cause in plain English, and hands your editor a fix to start from.

## Quickstart

```bash
npm install @mushi-mushi/capacitor   # or: npx mushi-mushi (detects Capacitor)
npx cap sync
```

```ts
import { Mushi } from '@mushi-mushi/capacitor';

await Mushi.configure({
  projectId: 'proj_...',
  apiKey: 'mushi_...',
  // Native builds default to Mushi Cloud. The browser preview (ionic serve) needs it set:
  endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
  triggerMode: 'both', // shake + floating button
});
```

Docs: [Capacitor SDK reference](https://kensaur.us/mushi-mushi/docs/sdks/capacitor) · [Project ID and API keys](https://kensaur.us/mushi-mushi/docs/concepts/credentials)

The plugin uses the same project API key as the web SDK (`mushi_…`), minted in the console under **Projects → API Keys**. The npm package vendors the standalone iOS and Android SDK sources, so you do not need a separate Maven or SwiftPM Mushi dependency.

Other frameworks: [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## More calls

```ts
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
client used by the standalone web SDK. One difference: the fallback has no
default `endpoint`, so `report()` throws until you pass one to `configure()`.

## Permissions

No runtime permissions required. iOS uses `motionShake`; Android uses the
accelerometer (no permission needed). The widget is rendered via the native
bottom sheet from the standalone SDKs.

## Configuration

| Field                  | Default                              | Notes |
|------------------------|--------------------------------------|-------|
| `projectId`            | _required_                           | Project UUID |
| `apiKey`               | _required_                           | Project API key (`mushi_...`) |
| `endpoint`             | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` on iOS and Android; none in the browser fallback | Override for self-hosting. Required in the browser fallback |
| `triggerMode`          | `'shake'`                            | `'shake'` / `'button'` / `'both'` / `'none'` |
| `captureScreenshot`    | `true`                               | Disable for HIPAA-sensitive flows |
| `minDescriptionLength` | `20`                                 | Matches the web/native SDK contracts |
| `useNativeWidget`      | `false`                              | When `true`, uses the bottom-sheet from the native SDK |
| `theme`                | _none_                               | `{ accentColor?, dark? }` for the native bottom sheet |
| `triggerInset`         | `{ bottom: 96, trailing: 20 }` (iOS) / `{ bottom: 96, end: 20 }` (Android) | Per-edge offset in points / dp so the native button clears tab bars and primary buttons. Keys: `bottom`, `leading` / `trailing` (iOS), `start` / `end` (Android) |
| `triggerInsetPreset`   | _none_                               | `'tabBarSafe'` (72 bottom — apps with a bottom tab bar) or `'dockSafe'` (96 bottom — apps with a tall dock or mini-player). Only fills in fields you didn't already set on `triggerInset`, so you can override per-edge while keeping the safe baseline |

## License

MIT — see [LICENSE](./LICENSE).


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 514 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
