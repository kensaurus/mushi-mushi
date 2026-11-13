# Bug report widget for React

Source: https://kensaur.us/mushi-mushi/docs/quickstart/react

---
title: Bug report widget for React
description: "Free, open-source bug report widget for React and Next.js: install mushi-mushi, add your project key, and get a plain-English diagnosis per report."
---

# Bug report widget for React

This page adds a report button to a React app (Vite or Next.js). When
something breaks, your users tap it and write one sentence. You get a
screenshot, what the app was doing, and the likely cause in plain English
with a fix your AI editor can apply.

The fastest way is one command in your app's folder, `npx mushi-mushi`. It
gets your keys and installs the package, then prints the code for step 2 for
you to paste. The steps below are the same thing by hand.

  **Coming from Create React App?** Migrate to Vite first: see
  the [CRA → Vite migration guide](/migrations/cra-to-vite). All Mushi Mushi React
  examples below assume Vite + React 19.

## Try it live

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **Fastest:** run `npx mushi-mushi` in your app's folder. It signs you in
  through the browser, creates or picks a project, installs the SDK and writes
  both values to `.env.local`.
- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-react)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

Put them in `.env.local` as `VITE_MUSHI_PROJECT_ID` and `VITE_MUSHI_API_KEY`
(`NEXT_PUBLIC_MUSHI_PROJECT_ID` and `NEXT_PUBLIC_MUSHI_API_KEY` on Next.js).

  **`.env.local` never reaches your host.** Before you deploy, add the same two
  settings where your site is built: in Vercel, Project → Settings →
  Environment Variables (Production); in Netlify, Project configuration →
  Environment variables. Then redeploy. They are read at build time, so
  without them the report button does not appear on your live site.

## 1. Install

```bash
pnpm add mushi-mushi
# or: npm install mushi-mushi
```

`mushi-mushi` carries the React bindings (`mushi-mushi/react`), the web SDK and
the core types, so you only need this one dependency.

**You'll see:** `mushi-mushi` in the `dependencies` of your `package.json`.

## 2. Wrap your app

```tsx filename="src/main.tsx"
import { MushiProvider } from 'mushi-mushi/react'
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
import { MushiProvider } from 'mushi-mushi/react'

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

`npx mushi-mushi` prints this `providers.tsx` code when it detects Next.js,
ready to paste (or to hand to your AI editor). It does not edit your files.

**You'll see:** a small report button in the corner of your app when you reload it.
Keep callbacks such as `beforeSend` inside `providers.tsx`, because a Server
Component cannot pass functions to a client one.

  The web SDK uses your **public** API key (safe to bundle). All sensitive
  operations are gated server-side by RLS + the gateway. Never ship your
  service-role key to the browser.

## 3. Trigger reports

Add a hook anywhere in your tree to capture programmatic reports:

```tsx filename="src/components/CrashFallback.tsx"
import { useMushiSdk } from 'mushi-mushi/react'

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

Or rely on the built-in widget, with no extra code. The launcher mounts as
soon as `` initialises.

## 4. Verify

Tap the report button in your app and write one sentence. Then open the console at [kensaur.us/mushi-mushi/admin](https://kensaur.us/mushi-mushi/admin) (or your self-hosted
instance).

**You'll see:** your report on the **Bugs** page within seconds, and its plain-English diagnosis shortly after.

A one-sentence test report gets a thin diagnosis. For a real one, bring in a
bug you already know about: see
[Already have Sentry issues?](/quickstart#already-have-sentry-issues-bring-them-in)
A diagnosis that names your files needs your GitHub repository connected on
the console's **Connect** page.

## Next steps

- [Concepts → Classification pipeline](/concepts/classification)
- [SDK reference → mushi-mushi/react](/sdks/react)
- [Plugins → Receive a webhook in your own service](/plugins/building)
