# @mushi-mushi/vue

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

Adds a bug-report widget to your Vue 3 app. When a user reports a problem,
[Mushi Mushi](https://github.com/kensaurus/mushi-mushi) gets a screenshot, the
route and recent console and network events, explains the cause in plain
English, and hands your editor a fix to start from.

Register the plugin once with `app.use(MushiPlugin, config)`. It pulls in
`@mushi-mushi/web` for the widget, so do not call `Mushi.init()` separately.

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
