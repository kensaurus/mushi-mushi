# @mushi-mushi/vue

> **Your AI wrote it. Mushi tells you why it broke.**

Vue 3 plugin — `app.use(MushiPlugin, config)` once. Pulls in `@mushi-mushi/web`
for the Shadow DOM widget; do not call `Mushi.init()` separately.

```bash
npm install @mushi-mushi/vue
# or: npx mushi-mushi
```

```ts
import { createApp } from 'vue'
import { MushiPlugin } from '@mushi-mushi/vue'

createApp(App)
  .use(MushiPlugin, {
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  })
  .mount('#app')
```

Docs: [Vue SDK](https://kensaur.us/mushi-mushi/docs/sdks/vue) ·
[Quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/vue) ·
[Credentials](https://kensaur.us/mushi-mushi/docs/concepts/credentials)

## License

MIT
