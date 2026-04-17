# @mushi-mushi/angular

Angular SDK for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

## Usage

```ts
import { provideMushi } from '@mushi-mushi/angular'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
  ]
})
```

### With Widget UI

```ts
import { provideMushi } from '@mushi-mushi/angular'
import { Mushi } from '@mushi-mushi/web'

bootstrapApplication(AppComponent, {
  providers: [provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })]
})
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

The module provides a global `ErrorHandler` that captures uncaught errors and an injectable `MushiService` for programmatic control.

## Peer Dependencies

- `@angular/core` >= 17

## License

MIT
