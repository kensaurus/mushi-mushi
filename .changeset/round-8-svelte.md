---
'@mushi-mushi/svelte': minor
---

API-surface and SvelteKit `handleError` integration.

- `MushiConfig` is now re-exported from `@mushi-mushi/core`.
- `initMushi` returns `null` on the server so SvelteKit SSR is safe.
- New `mushiHandleError` exports a SvelteKit `handleError` server-hook
  adapter that captures the error on Mushi and optionally formats
  `App.Error` for the renderer:

  ```ts
  // src/hooks.server.ts
  import { mushiHandleError } from '@mushi-mushi/svelte'
  export const handleError = mushiHandleError({
    format: (err) => ({ message: 'Something broke; we logged it.' }),
  })
  ```
