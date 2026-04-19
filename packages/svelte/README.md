# @mushi-mushi/svelte

Svelte SDK for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

> **One-command setup:** `npx mushi-mushi` auto-detects Svelte / SvelteKit and installs this package + `@mushi-mushi/web`.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Usage

```ts
import { initMushi, getMushi } from '@mushi-mushi/svelte'

initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

// Later
const mushi = getMushi()
mushi.submitReport({ title: 'broken', description: '...' })
```

### With Widget UI

```ts
import { initMushi } from '@mushi-mushi/svelte'
import { Mushi } from '@mushi-mushi/web'

initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

### SvelteKit error handler

```ts
import { createMushiErrorHandler } from '@mushi-mushi/svelte'

export const handleError = createMushiErrorHandler()
```

## Peer Dependencies

- `svelte` >= 4

## License

MIT
