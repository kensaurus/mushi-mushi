# @mushi-mushi/svelte


Svelte SDK for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

> **One-command setup:** `npx mushi-mushi` auto-detects Svelte / SvelteKit and installs this package + `@mushi-mushi/web`.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Install

```bash
npm install @mushi-mushi/svelte @mushi-mushi/web
# or: npx mushi-mushi
```

## Environment variables

| Stack | Project ID | API key |
| --- | --- | --- |
| Vite / SvelteKit | `VITE_MUSHI_PROJECT_ID` | `VITE_MUSHI_API_KEY` |

See [Project ID & API keys](https://docs.mushimushi.dev/concepts/credentials).

## Usage

```ts
import { initMushi, getMushi } from '@mushi-mushi/svelte'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

const mushi = getMushi()
mushi.submitReport({ title: 'broken', description: '...' })
```

### With widget UI

```ts
import { initMushi } from '@mushi-mushi/svelte'
import { Mushi } from '@mushi-mushi/web'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

### SvelteKit error handler

```ts
import { createMushiErrorHandler } from '@mushi-mushi/svelte'

export const handleError = createMushiErrorHandler()
```

## API

| Export | Purpose |
| --- | --- |
| `initMushi(config)` | Initialize once at app startup |
| `getMushi()` | Access the SDK instance |
| `createMushiErrorHandler()` | SvelteKit `handleError` integration |

## Peer dependencies

- `svelte` >= 4

## License

MIT
