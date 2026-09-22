# React quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/react

---
title: React quickstart
description: Add the Mushi React SDK in one command — npx mushi-mushi installs the bug-reporting widget, writes env vars, and files your first test report.
---

# React quickstart

Get a shake-to-report widget into a React app in under five minutes.

  **Coming from Create React App?** Migrate to Vite in an afternoon — see
  the [CRA → Vite migration guide](/migrations/cra-to-vite). All Mushi React
  examples below assume Vite + React 19.

## Try it live

## 1. Install

```bash
pnpm add @mushi-mushi/react
# or: npm install @mushi-mushi/react
```

`@mushi-mushi/react` re-exports from `@mushi-mushi/core` and `@mushi-mushi/web`,
so you only need this one dependency.

## 2. Wrap your app

```tsx filename="src/main.tsx"
import { MushiProvider } from '@mushi-mushi/react'
import { App } from './App'

export function Root() {
  return (
    <MushiProvider
      config={{
        projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
        apiKey: import.meta.env.VITE_MUSHI_API_KEY,
      }}
    >
      <App />
    </MushiProvider>
  )
}
```

### Next.js App Router

`` uses React context, so it goes in a client component, not
straight into `app/layout.tsx`:

```tsx filename="app/providers.tsx"
'use client'
import { MushiProvider } from '@mushi-mushi/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MushiProvider
      config={{
        projectId: process.env.NEXT_PUBLIC_MUSHI_PROJECT_ID!,
        apiKey: process.env.NEXT_PUBLIC_MUSHI_API_KEY!,
      }}
    >
      {children}
    </MushiProvider>
  )
}
```

```tsx filename="app/layout.tsx"
import { Providers } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

`npx mushi-mushi` writes this `providers.tsx` for you when it detects Next.js.
Keep callbacks such as `beforeSend` inside `providers.tsx`, because a Server
Component cannot pass functions to a client one.

  The web SDK uses your **public** API key (safe to bundle). All sensitive
  operations are gated server-side by RLS + the gateway. Never ship your
  service-role key to the browser.

## 3. Trigger reports

Add a hook anywhere in your tree to capture programmatic reports:

```tsx filename="src/components/CrashFallback.tsx"
import { useMushiSdk } from '@mushi-mushi/react'

export function CrashFallback({ error }: { error: Error }) {
  const mushi = useMushiSdk()
  return (
    <div role="alert">
      <p>Something broke.</p>
      <button onClick={() => void mushi?.captureException(error, { severity: 'high' })}>
        Send a bug report
      </button>
    </div>
  )
}
```

`useMushiSdk()` returns `null` until the provider has initialised, hence the
`?.`. To open the report widget from a button instead, use
`const { report } = useMushi()` and call `report()`.

Or rely on the built-in widget — no code required. The launcher mounts as
soon as `` initialises.

## 4. Verify

Open your admin console at [kensaur.us/mushi-mushi/admin](https://kensaur.us/mushi-mushi/admin) (or your self-hosted
instance) — your first report should appear in the Reports list within a
second of submission, classified by the LLM pipeline within ~10s.

## Next steps

- [Concepts → Classification pipeline](/concepts/classification)
- [SDK reference → @mushi-mushi/react](/sdks/react)
- [Plugins → Receive a webhook in your own service](/plugins/building)
