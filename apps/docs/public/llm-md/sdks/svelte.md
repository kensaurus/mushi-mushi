# @mushi-mushi/svelte

Source: https://kensaur.us/mushi-mushi/docs/sdks/svelte

---
title: '@mushi-mushi/svelte'
---

# `@mushi-mushi/svelte`

Svelte / SvelteKit boot helpers over [`@mushi-mushi/web`](/sdks/web). Shared
wrapper notes: [Framework wrappers](/sdks/framework-wrappers).

```bash
npm install @mushi-mushi/svelte
```

See [Quickstart → Svelte](/quickstart/svelte) for the short install path.

## API surface

```ts

```

| Export | Purpose |
| --- | --- |
| `initMushi(config)` | Boot once (SSR-safe) — calls `Mushi.init` internally |
| `getMushi()` | SDK instance after init |
| `createMushiErrorHandler()` | SvelteKit `handleError` helper |
| `mushiHandleError(opts?)` | Lower-level handleError helper |

## Setup

```ts

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

Call from `hooks.client.ts` or a top-level `+layout.svelte` `onMount`.

## Submitting a report

```ts

const mushi = getMushi()
await mushi.captureEvent({
  description: 'Something feels off',
  category: 'bug',
})
```
