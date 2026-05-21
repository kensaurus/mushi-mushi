---
'@mushi-mushi/angular': minor
---

API-surface, Angular Universal SSR safety, and standalone DI.

- `MushiConfig` is now re-exported from `@mushi-mushi/core`.
- `MushiService` constructor uses `@Optional() @Inject(MUSHI_CONFIG)`
  and an `isBrowser()` guard so Angular Universal SSR doesn't crash.
- New `provideMushiAngular(config)` returns a `Provider[]` for Angular
  16+ standalone DI:

  ```ts
  // app.config.ts
  import { provideMushiAngular } from '@mushi-mushi/angular'
  export const appConfig = {
    providers: [
      provideMushiAngular({ apiKey: 'mushi_…', projectId: '…' }),
    ],
  }
  ```
