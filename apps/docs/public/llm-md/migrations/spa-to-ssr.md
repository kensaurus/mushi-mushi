# SPA → SSR (Next.js / Nuxt / SvelteKit)

Source: https://kensaur.us/mushi-mushi/docs/migrations/spa-to-ssr

---
title: 'SPA → SSR (Next.js / Nuxt / SvelteKit)'
description: Move a Vite SPA to Next.js, Nuxt or SvelteKit. Env var prefix changes, where to mount Mushi Mushi so it survives navigation, and hydration gotchas.
---

# SPA → SSR (Next.js / Nuxt / SvelteKit)

 

Move a Vite SPA (React, Vue, or Svelte) onto a server-rendered framework
(Next.js, Nuxt, or SvelteKit respectively) for SEO, faster TTFB, and
real route-level data loading.

The Mushi Mushi bits are: env-var prefix changes, where to mount the
provider so it survives navigation, and what to do about hydration
warnings. The framework-level migration mechanics are upstream:

- React SPA → **Next.js** App Router: [Next.js: migrating from Vite](https://nextjs.org/docs/app/guides/migrating/from-vite)
- Vue SPA → **Nuxt**: [Nuxt installation](https://nuxt.com/docs/4.x/getting-started/installation)
- Svelte SPA → **SvelteKit**: [creating a SvelteKit project](https://svelte.dev/docs/kit/creating-a-project)

## Env-var prefix mapping

This is the change that most often breaks the SDK after a move:

| Vite SPA | Next.js | Nuxt | SvelteKit |
|----------|---------|------|-----------|
| `VITE_MUSHI_PROJECT_ID` | `NEXT_PUBLIC_MUSHI_PROJECT_ID` | `NUXT_PUBLIC_MUSHI_PROJECT_ID` | `VITE_MUSHI_PROJECT_ID` (unchanged) |
| `VITE_MUSHI_API_KEY` | `NEXT_PUBLIC_MUSHI_API_KEY` | `NUXT_PUBLIC_MUSHI_API_KEY` | `VITE_MUSHI_API_KEY` (unchanged) |
| `import.meta.env.VITE_*` | `process.env.NEXT_PUBLIC_*` | `useRuntimeConfig().public.*` (declare the keys in `nuxt.config`) | `import.meta.env.VITE_*` |

SvelteKit runs on Vite, so `VITE_` variables keep working; if you prefer
SvelteKit's own `PUBLIC_` prefix, read them from `$env/static/public`
instead. Rerunning `npx mushi-mushi init` in the new project writes the
prefix the CLI uses for that framework into your `.env.local`.

## Migration checklist (generic, picks the right framework as you go)

React SPA → Next.js (App Router). Vue SPA → Nuxt. Svelte SPA → SvelteKit. Don't switch UI framework AND rendering model in the same migration — it doubles the risk.</> },
    { id: 'bootstrap', label: 'Bootstrap the new framework alongside the old SPA', content: {`# Pick one:
npx create-next-app@latest        # Next.js
npm create nuxt@latest            # Nuxt
npx sv create                     # SvelteKit`} },
    { id: 'design-system', label: 'Port shared design tokens / global CSS first', content: <>If you use Tailwind, the config carries over almost as-is. CSS-in-JS users on emotion/styled-components need to wire up the SSR adapter for their library before any components move.</> },
    { id: 'routes', label: 'Migrate routes one at a time', content: <>For each SPA route, create the equivalent file-based route in the new framework. Keep the SPA running for any route not yet ported (proxy or redirect).</> },
    { id: 'data', label: 'Move data fetching to the server', content: <>SWR / react-query calls inside SPA components → Server Component fetches (Next.js) / asyncData (Nuxt) / load functions (SvelteKit). The SDK doesn't care; this is purely a perf win.</> },
    { id: 'env-prefix', label: 'Rename env vars per the table above', content: <>Run npx mushi-mushi init in the new project — it detects the framework and writes correct env-var names automatically.</> },
    { id: 'mushi-provider', label: 'Mount Mushi at the root of the new framework', content: {`// Next.js App Router — app/providers.tsx (CLIENT component)
'use client'

  return {children}

// Nuxt: nuxt.config.ts declares the keys (NUXT_PUBLIC_MUSHI_* fill them)
export default defineNuxtConfig({
  runtimeConfig: { public: { mushiProjectId: '', mushiApiKey: '' } },

// Nuxt: plugins/mushi.client.ts (MushiPlugin initialises the SDK itself)

export default defineNuxtPlugin((nuxtApp) => {
  const cfg = useRuntimeConfig()
  nuxtApp.vueApp.use(MushiPlugin, {
    projectId: cfg.public.mushiProjectId,
    apiKey: cfg.public.mushiApiKey,

// SvelteKit: src/routes/+layout.svelte (initMushi initialises the SDK itself)

  import { onMount } from 'svelte'
  import { initMushi } from '@mushi-mushi/svelte'
  onMount(() => {
    initMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,

`} },
    { id: 'hydration', label: 'Verify no hydration warnings', content: <>Mushi renders its widget into a Shadow DOM mounted on document.body on the client side only. It does NOT cause hydration mismatches because the widget is never present in server-rendered HTML. If you see hydration warnings, they're from your code, not Mushi.</> },
    { id: 'dynamic-import', label: 'For Nuxt/Next, use a .client suffix or "use client" for Mushi code', content: <>Mushi&apos;s provider and hooks ({``}, useMushi(), useMushiReport()) run in the browser. Mark them client-only (a .client plugin in Nuxt, 'use client' in Next.js) so SSR doesn&apos;t try to run them.</> },
    { id: 'sitemap', label: 'Confirm SSR routes are crawlable', content: <>Run a Lighthouse SEO audit on a few key pages. If TTFB is slower than the old SPA, you've probably introduced an unnecessary serverside fetch — profile and remove it.</> },
    { id: 'redirect', label: 'Redirect old SPA routes to the new ones (when all migrated)', content: <>Either at the CDN layer (Cloudflare / S3 redirects) or via the new framework's redirects config.</> },
    { id: 'verify', label: 'Smoke-test Mushi from a server-rendered page', content: <>Open a page that's rendered by the SSR pipeline. Open the floating widget, submit a report, and confirm the report shows the SSR-rendered route.</> },

/>

## Where the Mushi Mushi widget lives across SSR vs CSR

The Mushi visual widget mounts client-side, in a Shadow DOM child of
`document.body`, after `Mushi.init()` runs. Because it doesn't render in
the server-side HTML, you'll see:

- ✅ No hydration warnings caused by the widget itself
- ✅ Crawlers don't see the widget (it's not in the initial HTML)
- ⚠️ The widget appears only after the client-side JavaScript runs, so on
  slow networks the page shows briefly without it (intentional, to keep
  server HTML lean)

## Common gotchas

- **`useMushi()` in a Server Component** (Next.js App Router): build
  error. Add `'use client'`. See the
  [Next.js Pages → App Router guide](/migrations/nextjs-pages-to-app-router#server-components-and-usemushi)
  for the recommended pattern.
- **Calling `Mushi.init()` as well as the framework adapter.** Since 1.0,
  `MushiPlugin` (Vue/Nuxt) and `initMushi()` (Svelte) initialise the SDK
  themselves; a second `Mushi.init()` only logs "Already initialized".
  Remove it.
- **Env-var prefix typos.** The SDK throws an error saying `projectId`
  and `apiKey` are required. Run `npx mushi-mushi init` to regenerate the
  env section.

## References

- [Next.js: Migrating from Vite](https://nextjs.org/docs/app/guides/migrating/from-vite)
- [Nuxt installation](https://nuxt.com/docs/4.x/getting-started/installation)
- [Creating a SvelteKit project](https://svelte.dev/docs/kit/creating-a-project)
- [`@mushi-mushi/react`](/sdks/react) / [`@mushi-mushi/vue`](/sdks/vue) / [`@mushi-mushi/svelte`](/sdks/svelte) SDK references
