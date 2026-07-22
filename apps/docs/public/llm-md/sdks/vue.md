# @mushi-mushi/vue

Source: https://kensaur.us/mushi-mushi/docs/sdks/vue

---
title: '@mushi-mushi/vue'
---

# `@mushi-mushi/vue`

Vue 3 plugin + composables over [`@mushi-mushi/web`](/sdks/web). Shared wrapper
notes: [Framework wrappers](/sdks/framework-wrappers).

```bash
npm install @mushi-mushi/vue
```

  **Still on Vue 2?** This adapter requires Vue 3. See the [Vue 2 → Vue 3 migration guide](/migrations/vue-2-to-vue-3) — it walks through the bridge build and the Mushi-specific bits.

See [Quickstart → Vue](/quickstart/vue) for the full setup walkthrough.

## API surface

```ts

```

| Export | Purpose |
| --- | --- |
| `MushiPlugin` | `app.use(MushiPlugin, config)` — installs the plugin and boots the SDK |
| `useMushi()` | Returns the SDK singleton (composable) |
| `useMushiReport()` | Returns `{ submit, isSubmitting, lastError }` |

## Setup (Vite / Vue 3)

```ts
// main.ts

createApp(App)
  .use(MushiPlugin, {
    projectId: 'YOUR_PROJECT_ID',
    apiKey: 'YOUR_PUBLIC_API_KEY',
  })
  .mount('#app')
```

## Identifying users

```vue

const mushi = useMushi()
const { user } = useAuth()

watch(user, (u) => {
  if (u) mushi.identify(u.id, { email: u.email, name: u.name })
})

```

## Submitting a report

```vue

const { submit, isSubmitting } = useMushiReport()

  
    Report issue
  

```
