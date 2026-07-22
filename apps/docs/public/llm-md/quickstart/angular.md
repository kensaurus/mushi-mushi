# Angular quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/angular

---
title: Angular quickstart
---

# Angular quickstart

Same loop as [React](/quickstart/react) — swap the install and boot call.

```bash
pnpm add @mushi-mushi/angular
```

```ts filename="src/app/app.config.ts"

  providers: [
    provideMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    }),
  ],
}
```

API detail: [`@mushi-mushi/angular`](/sdks/angular). Widget behavior: [`@mushi-mushi/web`](/sdks/web).
