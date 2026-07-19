# Vanilla JS quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/web

---
title: Vanilla JS quickstart
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

const mushi = Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

window.addEventListener('beforeunload', () => mushi.flushOfflineQueueNow())
```

## 3. Submit

```ts

document.querySelector('#report-bug')?.addEventListener('click', async () => {
  await mushi.submitReport({
    description: 'Login button does nothing on mobile Safari.',
    severity: 'medium',
  })
})
```

The widget (Shake-to-Report on touch devices, sticky button on desktop)
mounts automatically with `enableWidget: true`, which is the default.

  See [SDK reference → @mushi-mushi/web](/sdks/web) for the full config
  surface (PII scrubbing, rate limits, custom triggers, on-device pre-filter).
