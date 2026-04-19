# @mushi-mushi/vue

Vue 3 plugin for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

> **One-command setup:** `npx mushi-mushi` auto-detects Vue / Nuxt and installs this package + `@mushi-mushi/web`.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Usage

```ts
import { MushiPlugin } from '@mushi-mushi/vue'

app.use(MushiPlugin, {
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
})
```

### With Widget UI

```ts
import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

app.use(MushiPlugin, { projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

### Composables

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi-mushi/vue'

const mushi = useMushi()
mushi.submitReport({ title: 'broken layout', description: '...' })
```

## Peer Dependencies

- `vue` >= 3.3

## License

MIT
