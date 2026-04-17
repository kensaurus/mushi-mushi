# @mushi-mushi/vue

Vue 3 plugin for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

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
