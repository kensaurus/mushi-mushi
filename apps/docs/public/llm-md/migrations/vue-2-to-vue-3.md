# Vue 2 → Vue 3

Source: https://kensaur.us/mushi-mushi/docs/migrations/vue-2-to-vue-3

---
title: 'Vue 2 → Vue 3'
description: Upgrade a Vue 2 app to Vue 3 and move from the plain Mushi Mushi web SDK to the @mushi-mushi/vue plugin, with an interactive migration checklist.
---

# Vue 2 → Vue 3

 

Vue 2 reached end-of-life on 2023-12-31. This guide covers the upgrade
and the Mushi Mushi pieces.

The Mushi Vue adapter (`@mushi-mushi/vue`) supports **Vue 3.3 and later**
(its peer dependency is `vue >=3.3`). Apps still on Vue 2 use the plain
`@mushi-mushi/web` SDK; this guide brings you onto the adapter.

  **Vue 2 is no longer receiving security patches.** The Vue team's official
  recommendation is to migrate. If you cannot, [HeroDevs ships a paid LTS](https://www.herodevs.com/support/nes-vue)
  for Vue 2.7 with security backports.

## What changes (high level)

- `new Vue({...}).$mount(...)` → `createApp(App).mount(...)`
- Options API still works in Vue 3, but the **Composition API** is the
  recommended style. You can mix both during the migration.
- Filters are gone. Methods or computed properties replace them.
- Functional components are plain functions in Vue 3; the `functional`
  option and `` are gone.
- `v-model` on a custom component changed semantics; see the
  [Vue 3 migration guide](https://v3-migration.vuejs.org/breaking-changes/v-model.html).
- Vue Router 3 → 4. Vuex 3 → 4 (or Pinia, recommended).
- Mushi: `@mushi-mushi/web` direct usage → `@mushi-mushi/vue` adapter.

## API mapping (Mushi Mushi)

| Vue 2 (with @mushi-mushi/web) | Vue 3 (with @mushi-mushi/vue + @mushi-mushi/web) |
|-------------------------------|--------------------------------------------------|
| `Mushi.init({ projectId, apiKey })` in main.js | `app.use(MushiPlugin, { projectId, apiKey })` only; the plugin calls `Mushi.init()` itself |
| Manually attach `Vue.config.errorHandler = ...` to forward to Mushi | The adapter chains onto Vue 3's `app.config.errorHandler` automatically |
| Use the instance from `Mushi.init()` in components | Use the `useMushi()` composable inside `` / `setup()` |

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
    { id: 'install-mushi-adapter', label: 'Install the Mushi Vue adapter', content: {`npm install @mushi-mushi/vue
# @mushi-mushi/web comes with it as a dependency`} },
    { id: 'wire-mushi', label: 'Replace direct Mushi.init usage with the adapter', content: {`// main.ts

const app = createApp(App)

// Initialises the SDK (widget + capture), provides useMushi(),
// and chains onto app.config.errorHandler. Don't also call Mushi.init().
app.use(MushiPlugin, {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey:    import.meta.env.VITE_MUSHI_API_KEY,

app.mount('#app')`} },
    { id: 'use-composable', label: 'Migrate components to useMushi()', content: {`

const mushi = useMushi()

async function reportIssue() {
  await mushi?.captureEvent({ description: 'Issue from Vue component' })

`} },
    { id: 'remove-vue2-mushi', label: 'Remove any Vue-2-era Mushi error-handler shims', content: <>If you previously did Vue.config.errorHandler = (err) =&gt; mushi.captureException(err), delete it, along with your own Mushi.init() call. The adapter chains its own app.config.errorHandler that reports to Mushi.</> },
    { id: 'verify', label: 'Smoke-test: throw an error, verify it lands as a Mushi report', content: <>Throw inside a Vue lifecycle hook. The adapter sends it to Mushi with source vue-error-handler. Confirm it appears in the admin console.</> },

/>

## Common gotchas

- **Calling `Mushi.init()` as well as `app.use(MushiPlugin, ...)`**. Since
  `@mushi-mushi/vue` 1.0 the plugin initialises the SDK itself; a second
  `Mushi.init()` only logs "Already initialized". Remove it.
- **`` and Options API mixing**. Both work in Vue 3, but
  `useMushi()` is a composable, so call it inside `setup()` /
  ``. In an Options API component, add a `setup()` option
  that returns it, or use `Mushi.getInstance()` from `@mushi-mushi/web`.
- **Stale Vue 2 plugins**. Check each Vue plugin you use (error
  reporting, logging, UI kits) for a Vue 3 version.

## Mushi Mushi during the migration

You can run **just `@mushi-mushi/web`** in compat mode and it works. The
adapter is purely additive: it gives you a nicer composable API and
auto-wires the error handler. Migrate Mushi to the adapter only after
your app is on real Vue 3 (compat alias removed).

## References

- [Vue 3 Migration Guide](https://v3-migration.vuejs.org/)
- [`@vue/compat` build](https://v3-migration.vuejs.org/migration-build.html)
- [Pinia (recommended state)](https://pinia.vuejs.org/)
- [`@mushi-mushi/vue` SDK reference](/sdks/vue)
