# @mushi-mushi/svelte

> **Your AI built it. Mushi Mushi makes it better.**

Adds a bug-report widget to your Svelte or SvelteKit app. When a user reports
a problem, [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) gets a
screenshot, the route and recent console and network events, explains the
cause in plain English, and hands your editor a fix to start from.

The same code ships in the [`mushi-mushi`](https://www.npmjs.com/package/mushi-mushi) package: `npm install mushi-mushi`, then `import { initMushi } from 'mushi-mushi/svelte'`. This package keeps working and keeps getting updates.

Call `initMushi(config)` once, from `hooks.client.ts` or a top-level
`+layout.svelte` `onMount`. It pulls in `@mushi-mushi/web` for the widget, so
do not call `Mushi.init()` separately.

```bash
npm install mushi-mushi   # then import from 'mushi-mushi/svelte'
# or: npx mushi-mushi
# or: npm install @mushi-mushi/svelte   # same code; import from '@mushi-mushi/svelte'
```

```ts
import { initMushi } from 'mushi-mushi/svelte'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

Docs: [Svelte SDK](https://kensaur.us/mushi-mushi/docs/sdks/svelte) ·
[Quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/svelte) ·
[Credentials](https://kensaur.us/mushi-mushi/docs/concepts/credentials)

## License

MIT
