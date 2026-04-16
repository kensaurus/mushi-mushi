# @mushi/vue

Vue 3 plugin for Mushi Mushi bug reporting.

## Usage

```ts
import { MushiPlugin } from '@mushi/vue'

app.use(MushiPlugin, {
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
})
```

### Composables

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi/vue'

const mushi = useMushi()
mushi.submitReport({ title: 'broken layout', description: '...' })
```

## Peer Dependencies

- `vue` >= 3.3

## License

MIT
