# @mushi-mushi/svelte

> **Your AI wrote it. Mushi tells you why it broke.**

Svelte / SvelteKit — `initMushi(config)` once. Pulls in `@mushi-mushi/web` for
the Shadow DOM widget; do not call `Mushi.init()` separately.

```bash
npm install @mushi-mushi/svelte
# or: npx mushi-mushi
```

```ts
import { initMushi } from '@mushi-mushi/svelte'

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
