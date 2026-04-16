# @mushi-mushi/angular

Angular SDK for Mushi Mushi bug reporting.

## Usage

```ts
import { provideMushi } from '@mushi-mushi/angular'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
  ]
})
```

The module provides a global `ErrorHandler` that captures uncaught errors and an injectable `MushiService` for programmatic control.

## Peer Dependencies

- `@angular/core` >= 17

## License

MIT
