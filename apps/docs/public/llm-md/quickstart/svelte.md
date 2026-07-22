# Svelte quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/svelte

---
title: Svelte quickstart
---

# Svelte quickstart

Same loop as [React](/quickstart/react) — swap the install and boot call.

```bash
pnpm add @mushi-mushi/svelte
```

```ts

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

Call `initMushi` from `hooks.client.ts` or a top-level `+layout.svelte` `onMount`.

API detail: [`@mushi-mushi/svelte`](/sdks/svelte). Widget behavior: [`@mushi-mushi/web`](/sdks/web).
