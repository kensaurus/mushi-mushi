# @mushi-mushi/angular

> **Your AI wrote it. Mushi tells you why it broke.**

Angular SDK for Mushi Mushi bug reporting. **API-only** — captures errors and submits reports but does not include the widget UI. Add `@mushi-mushi/web` alongside this package for the full Shadow DOM widget experience.

> **One-command setup:** `npx mushi-mushi` auto-detects Angular and installs this package + `@mushi-mushi/web`.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Install

```bash
npm install @mushi-mushi/angular @mushi-mushi/web
# or: npx mushi-mushi
```

## Environment variables

The wizard writes `VITE_MUSHI_*` for Angular CLI / Vite-based apps:

| Variable | Purpose |
| --- | --- |
| `VITE_MUSHI_PROJECT_ID` | Project slug (`proj_…`) or UUID from Admin → Projects |
| `VITE_MUSHI_API_KEY` | Ingest key (`mushi_…`) |

See [Project ID & API keys](https://kensaur.us/mushi-mushi/docs/concepts/credentials) for format details.

## Usage

```ts
import { provideMushi } from '@mushi-mushi/angular'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    }),
  ],
})
```

### With widget UI

```ts
import { provideMushi } from '@mushi-mushi/angular'
import { Mushi } from '@mushi-mushi/web'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    }),
  ],
})

Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

`provideMushi()` registers a global `ErrorHandler` and an injectable `MushiService` for programmatic reports.

## API

| Export | Purpose |
| --- | --- |
| `provideMushi(config)` | Standalone provider — init + global error handler |
| `MushiService` | Injectable service for `submitReport()` |

## Peer dependencies

- `@angular/core` >= 17

## License

MIT
