# Vue 3 quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/vue

---
title: Vue 3 quickstart
---

# Vue 3 quickstart

Same loop as [React](/quickstart/react) — swap the install and boot call.

```bash
pnpm add @mushi-mushi/vue
```

```ts filename="src/main.ts"

createApp(App)
  .use(MushiPlugin, {
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  })
  .mount('#app')
```

API detail: [`@mushi-mushi/vue`](/sdks/vue). Widget behavior: [`@mushi-mushi/web`](/sdks/web).
