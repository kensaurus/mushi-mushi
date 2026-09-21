# Vue 2 → Vue 3

Source: https://kensaur.us/mushi-mushi/docs/migrations/vue-2-to-vue-3

---
title: 'Vue 2 → Vue 3'
---

# Vue 2 → Vue 3

 

Vue 2 reached end-of-life on 2023-12-31. Most apps have already migrated;
this guide covers the holdouts and the Mushi-specific pieces.

The Mushi Vue adapter (`@mushi-mushi/vue`) supports **Vue 3 only**. Apps
still on Vue 2 must use the vanilla `@mushi-mushi/web` SDK; this guide
brings you onto the adapter.

  **Vue 2 is no longer receiving security patches.** The Vue team's official
  recommendation is to migrate. If you cannot, [HeroDevs ships a paid LTS](https://www.herodevs.com/support/vue-2-nes)
  for Vue 2.7 with security backports.

## What changes (high level)

- `new Vue({...}).$mount(...)` → `createApp(App).mount(...)`
- Options API still works in Vue 3, but the **Composition API** is the
  recommended style. You can mix both during the migration.
- Filters are gone. Methods or computed properties replace them.
- Functional components must be converted to regular components or use
  `defineComponent` with `functional: true` removed.
- `v-model` on a custom component changed semantics — see the
  [Vue 3 migration guide](https://v3-migration.vuejs.org/breaking-changes/v-model.html).
- Vue Router 3 → 4. Vuex 3 → 4 (or Pinia, recommended).
- Mushi: `@mushi-mushi/web` direct usage → `@mushi-mushi/vue` adapter.

## API mapping (Mushi-specific)

| Vue 2 (with @mushi-mushi/web) | Vue 3 (with @mushi-mushi/vue + @mushi-mushi/web) |
|-------------------------------|--------------------------------------------------|
| `Mushi.init({ projectId, apiKey })` in main.js | Same `Mushi.init(...)` PLUS `app.use(MushiPlugin, { projectId, apiKey })` |
| Manually attach `Vue.config.errorHandler = ...` to forward to Mushi | The adapter wires Vue 3's `app.config.errorHandler` automatically |
| Reach into `Mushi` directly from any component | Use `useMushi()` composable inside `` |

## Migration checklist

{`# Vue 3 ships a compat build that runs Vue 2 code with deprecation warnings:
npm install vue@^3
# Then in your build config, alias 'vue' to '@vue/compat'
# This lets you migrate incrementally without flag-day risk`} },
    { id: 'fix-warnings', label: 'Fix every Vue 2-style deprecation warning', content: <>Each warning links to its migration page. Common ones: filters removed, $on/$off/$once removed, functional: true removed. Work through them all before removing the compat alias.</> },
    { id: 'remove-compat', label: 'Remove @vue/compat alias once warnings are zero', content: <>Now you're on real Vue 3.</> },
    { id: 'router', label: 'Upgrade Vue Router 3 → 4', content: {`npm install vue-router@^4

// router.js
- import VueRouter from 'vue-router'
- Vue.use(VueRouter)
- export default new VueRouter({ routes })
+ import { createRouter, createWebHistory } from 'vue-router'
+ export default createRouter({ history: createWebHistory(), routes })`} },
    { id: 'state', label: 'Decide: Vuex 4 or Pinia', content: <>Vuex 4 is a Vue-3-compatible drop-in. Pinia is the new recommended state library — better TS, smaller, simpler. If you're touching state code anyway, Pinia is worth the switch.</> },
    { id: 'install-mushi-adapter', label: 'Install the Mushi Vue adapter', content: {`npm install @mushi-mushi/vue @mushi-mushi/web`} },
    { id: 'wire-mushi', label: 'Replace direct Mushi.init usage with the adapter', content: {`// main.ts

const credentials = {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey:    import.meta.env.VITE_MUSHI_API_KEY,
}

const app = createApp(App)

// 1. Vue plugin: wires useMushi() composable + Vue 3 errorHandler
app.use(MushiPlugin, credentials)

// 2. Web SDK: actually mounts the floating widget + capture pipeline
Mushi.init(credentials)

app.mount('#app')`} },
    { id: 'use-composable', label: 'Migrate components to useMushi()', content: {`

const mushi = useMushi()

async function reportIssue() {
  await mushi.submitReport({ description: 'Issue from Vue component' })
}
`} },
    { id: 'remove-vue2-mushi', label: 'Remove any Vue-2-era Mushi error-handler shims', content: <>If you previously did Vue.config.errorHandler = (err) =&gt; Mushi.captureException(err), delete it. The adapter installs its own app.config.errorHandler that calls Mushi automatically.</> },
    { id: 'verify', label: 'Smoke-test: throw an error, verify it lands as a Mushi report', content: <>Throw inside a Vue lifecycle hook. The adapter forwards it to Mushi as a report tagged with source: vue. Confirm it appears in the admin console.</> },
  ]}
/>

## Common gotchas

- **Forgetting `Mushi.init()` after `app.use(MushiPlugin, ...)`**. The Vue
  plugin only wires the composable + error handler; it does NOT mount the
  visual widget. You need both calls. (This is also why the in-console
  Install SDK card emits both lines — it caught a previous regression
  where users thought one was enough.)
- **`` and Options API mixing**. Both work in Vue 3, but
  `useMushi()` only works inside `setup()` / `` because it's
  a composable. For Options API components, use `inject('mushi')`
  (the plugin provides it).
- **Stale Vue 2 plugins**. Some older Mushi-adjacent plugins (Sentry-Vue
  v6, Vue-Logger v1) only support Vue 2. Audit your plugin list.

## Mushi behaviour during the migration

You can run **just `@mushi-mushi/web`** in compat mode and it works. The
adapter is purely additive — it gives you a nicer composable API and
auto-wires the error handler. Migrate Mushi to the adapter only after
your app is on real Vue 3 (compat alias removed).

## References

- [Vue 3 Migration Guide](https://v3-migration.vuejs.org/)
- [`@vue/compat` build](https://v3-migration.vuejs.org/migration-build.html)
- [Pinia (recommended state)](https://pinia.vuejs.org/)
- [`@mushi-mushi/vue` SDK reference](/sdks/vue)
