# @mushi-mushi/vue

> **Your AI wrote it. Mushi tells you why it broke.**

Vue 3 plugin for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

> **One-command setup:** `npx mushi-mushi` auto-detects Vue / Nuxt and installs this package + `@mushi-mushi/web`.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Install

```bash
npm install @mushi-mushi/vue @mushi-mushi/web
# or: npx mushi-mushi
```

## Environment variables

| Stack | Project ID | API key |
| --- | --- | --- |
| Vite / Vue CLI | `VITE_MUSHI_PROJECT_ID` | `VITE_MUSHI_API_KEY` |
| Nuxt | `NUXT_PUBLIC_MUSHI_PROJECT_ID` | `NUXT_PUBLIC_MUSHI_API_KEY` |

See [Project ID & API keys](https://docs.mushimushi.dev/concepts/credentials).

## Usage

```ts
import { createApp } from 'vue'
import { MushiPlugin } from '@mushi-mushi/vue'

const app = createApp(App)

app.use(MushiPlugin, {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

### With widget UI

```ts
import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

app.use(MushiPlugin, {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

### Composables

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi-mushi/vue'

const mushi = useMushi()
mushi.submitReport({ title: 'broken layout', description: '...' })
```

## API

| Export | Purpose |
| --- | --- |
| `MushiPlugin` | Vue plugin — init at app root |
| `useMushi()` | SDK instance + report helpers |
| `useMushiReport()` | Convenience submit hook |
| `useMushiWidget()` | Widget open/close helpers |

## Peer dependencies

- `vue` >= 3.3

## License

MIT
