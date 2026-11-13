# Bug report widget for Svelte and SvelteKit

Source: https://kensaur.us/mushi-mushi/docs/quickstart/svelte

---
title: Bug report widget for Svelte and SvelteKit
description: "Free, open-source bug report widget for Svelte and SvelteKit: install mushi-mushi and call initMushi from hooks.client.ts or a root layout."
---

# Bug report widget for Svelte and SvelteKit

This page adds a report button to a Svelte or SvelteKit app. When something
breaks, your users tap it and write one sentence. You get the likely cause in
plain English, with a fix your AI editor can apply.

The fastest way is `npx mushi-mushi` in your app's folder: it gets your keys,
installs the package and prints the code below for you to paste. The steps
match the [React quickstart](/quickstart/react); only the install and the
start-up call differ.

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **Fastest:** run `npx mushi-mushi` in your app's folder. It signs you in
  through the browser, creates or picks a project, installs the SDK and writes
  both values to `.env.local`.
- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-svelte)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

Put them in `.env.local` as `VITE_MUSHI_PROJECT_ID` and `VITE_MUSHI_API_KEY`.

## Install and initialize

```bash
pnpm add mushi-mushi
```

```ts
import { initMushi } from 'mushi-mushi/svelte'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

Call `initMushi` from `hooks.client.ts` or a top-level `+layout.svelte` `onMount`.

**You'll see:** a small report button in the corner of your app. Tap it, send one sentence, and the report shows in the [console](https://kensaur.us/mushi-mushi/admin) within seconds.

Starting a new Svelte app? `npx mushi-mushi --template svelte my-app` makes one
with Mushi Mushi already in it ([how](/sdks/launcher#start-a-new-app-with-mushi-mushi-in-it)).

API detail: [`mushi-mushi/svelte`](/sdks/svelte). Widget behavior: [`mushi-mushi`](/sdks/web).
