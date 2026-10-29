# Next.js static export

Source: https://kensaur.us/mushi-mushi/docs/sdks/nextjs-static-export

---
title: Next.js static export
description: Mushi Mushi in a Next.js static export. Put public env vars in NEXT_PUBLIC_*, init client-side only, and set runtimeConfig false only for a fully offline site.
---

# Next.js static export

A static export has no Next.js server, so the public Mushi Mushi env vars must be `NEXT_PUBLIC_*` (inlined at build time), and `Mushi.init()` must run on the client. The SDK's runtime config is fetched in the browser from the Mushi Mushi API, so it works in a static export too. Set `runtimeConfig: false` only for a fully static or offline deployment:

```tsx
Mushi.init({
  projectId: process.env.NEXT_PUBLIC_MUSHI_PROJECT_ID!,
  apiKey: process.env.NEXT_PUBLIC_MUSHI_API_KEY!,
  apiEndpoint: process.env.NEXT_PUBLIC_MUSHI_API_ENDPOINT,
  runtimeConfig: false,
  preset: 'production-calm',
})
```

Runtime config is fetched by default everywhere, localhost included. If the fetch fails (for example, a stopped local Supabase stack), the SDK falls back to the cached config and its built-in defaults.

Use `widget.anchor` instead of Shadow DOM CSS injection when the exported site has sticky UI:

```ts
widget: {
  anchor: {
    bottom: 'calc(72px + env(safe-area-inset-bottom))',
    right: '16px',
  },
}
```
