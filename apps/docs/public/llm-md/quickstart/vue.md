# Vue 3 quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/vue

---
title: Vue 3 quickstart
description: Add Mushi Mushi bug reporting to a Vue 3 app. Install @mushi-mushi/vue and register MushiPlugin with your project ID and public API key in main.ts.
---

# Vue 3 quickstart

Same steps as the [React quickstart](/quickstart/react); only the install and the boot call differ.

```bash
pnpm add @mushi-mushi/vue
```

```ts filename="src/main.ts"
import { createApp } from 'vue'
import { MushiPlugin } from '@mushi-mushi/vue'
import App from './App.vue'

createApp(App)
  .use(MushiPlugin, {
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  })
  .mount('#app')
```

API detail: [`@mushi-mushi/vue`](/sdks/vue). Widget behavior: [`@mushi-mushi/web`](/sdks/web).
