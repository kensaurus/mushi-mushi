# Bug report widget for Vue 3

Source: https://kensaur.us/mushi-mushi/docs/quickstart/vue

---
title: Bug report widget for Vue 3
description: "Free, open-source bug report widget for Vue 3: install @mushi-mushi/vue and register MushiPlugin with your project ID and public API key in main.ts."
---

# Bug report widget for Vue 3

This quickstart adds the Mushi Mushi bug-report widget to a Vue 3 app. The
steps match the [React quickstart](/quickstart/react); only the install and the
boot call differ.

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **Fastest:** run `npx mushi-mushi` in your app's folder. It signs you in
  through the browser, creates or picks a project, installs the SDK and writes
  both values to `.env.local`.
- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-vue)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

Put them in `.env.local` as `VITE_MUSHI_PROJECT_ID` and `VITE_MUSHI_API_KEY`.

## Install and register the plugin

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
