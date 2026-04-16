# @mushi/svelte

Svelte SDK for Mushi Mushi bug reporting.

## Usage

```ts
import { initMushi, getMushi } from '@mushi/svelte'

initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

// Later
const mushi = getMushi()
mushi.submitReport({ title: 'broken', description: '...' })
```

### SvelteKit error handler

```ts
import { createMushiErrorHandler } from '@mushi/svelte'

export const handleError = createMushiErrorHandler()
```

## Peer Dependencies

- `svelte` >= 4

## License

MIT
