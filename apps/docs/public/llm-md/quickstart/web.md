# Vanilla JS quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/web

---
title: Vanilla JS quickstart
description: Add Mushi's browser SDK to any site without a framework — install @mushi-mushi/web, call Mushi.init, and file bug reports from your buttons or the widget.
---

# Vanilla JS quickstart

For non-React apps (or any framework you'd rather drive imperatively).

## Try it live

## 1. Install

```bash
pnpm add @mushi-mushi/web
```

## 2. Initialize

```ts filename="src/mushi.ts"
import { Mushi } from '@mushi-mushi/web'

export const mushi = Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

## 3. Submit

```ts filename="src/report-button.ts"
import { mushi } from './mushi'

document.querySelector('#report-bug')?.addEventListener('click', async () => {
  await mushi.captureEvent({
    description: 'Login button does nothing on mobile Safari.',
    severity: 'medium',
  })
})
```

`captureEvent` files the report without opening any UI. To open the widget
instead, call `mushi.report()`.

The widget launcher mounts automatically on `Mushi.init`. Set
`widget: { trigger: 'hidden' }` to keep it out of sight and open it only
from your own buttons.

  See [SDK reference → @mushi-mushi/web](/sdks/web) for the full config
  surface (PII scrubbing, rate limits, custom triggers, on-device pre-filter).
