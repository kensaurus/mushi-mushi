# @mushi-mushi/react

> **Your AI wrote it. Mushi tells you why it broke.**

React / Next.js SDK for [Mushi Mushi](https://www.npmjs.com/package/mushi-mushi) — the comprehension layer for AI-built apps. When your app breaks, Mushi tells you why in plain English, with the fix ready to paste, right inside your editor.

> **One-command setup:** `npx mushi-mushi` auto-detects React / Next.js and installs this package with the right env vars and prefix (`NEXT_PUBLIC_`, `VITE_`, etc.).
>
> **Other frameworks:** [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)

## What this does

Adds a floating 🐛 button (or your own button via `MushiTrigger`) to your React app. Users click it, scribble a note, and Mushi captures: a screenshot, the current route, the user's description, and the last few seconds of console and network activity. An AI classifies the report (severity, category, component) within seconds. Duplicate reports across users collapse to one row. Stable clusters are promoted to named learning rules that feed into your next PR review and your next AI agent run.

See the [main README](https://www.npmjs.com/package/mushi-mushi) for the full before/after and pros/cons.

## Install

```bash
npm install @mushi-mushi/react
# or: npx mushi-mushi
```

## Quick start

```tsx
import { MushiProvider } from '@mushi-mushi/react';

function App() {
  return (
    <MushiProvider config={{
      projectId: process.env.REACT_APP_MUSHI_PROJECT_ID!,  // UUID from Admin → Projects
      apiKey: process.env.REACT_APP_MUSHI_API_KEY!,        // from Admin → Settings → API Keys
    }}>
      <YourApp />
    </MushiProvider>
  );
}
```

**Next.js App Router** — put the provider in `app/layout.tsx`:

```tsx
import { MushiProvider } from '@mushi-mushi/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <MushiProvider config={{
          projectId: process.env.NEXT_PUBLIC_MUSHI_PROJECT_ID!,
          apiKey: process.env.NEXT_PUBLIC_MUSHI_API_KEY!,
        }}>
          {children}
        </MushiProvider>
      </body>
    </html>
  );
}
```

## Headless integration

Attach the reporter to any element in your existing design system:

```tsx
import { MushiTrigger, MushiAttach } from '@mushi-mushi/react'

// Polymorphic wrapper — any element or component
<MushiTrigger as="button" category="bug" className="my-feedback-btn">
  Report a bug
</MushiTrigger>

// With Radix / shadcn
<MushiTrigger as={Button} variant="ghost" size="sm">Feedback</MushiTrigger>

// Attach to an element you can't wrap
<MushiAttach selector="#help-button" category="bug" />
```

## API

```tsx
import { MushiProvider, useMushi, useMushiReport, useMushiReady, MushiErrorBoundary } from '@mushi-mushi/react'
```

| Export | Purpose |
|---|---|
| `<MushiProvider>` | Context wrapper — initialize once at your app root |
| `useMushi()` | SDK instance: `open()`, `close()`, `setUser()`, `setContext()` |
| `useMushiReport()` | `submitReport({ description, category })` convenience hook |
| `useMushiReady()` | `boolean` — true once the SDK has finished initializing |
| `<MushiErrorBoundary>` | Catches React render errors and pre-fills a report with the stack |
| `<MushiTrigger>` | Polymorphic headless trigger — wraps any element |
| `<MushiAttach>` | Attaches reporter to a CSS selector without wrapping |

## Bundle size

~819 B brotli. Requires `@mushi-mushi/core` and `@mushi-mushi/web` (installed automatically — not bundled inline).

## Peer dependencies

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 327 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
