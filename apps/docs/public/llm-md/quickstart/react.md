# React quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/react

---
title: React quickstart
description: Add the Mushi React SDK in one command — npx mushi-mushi installs the bug-reporting widget, writes env vars, and files your first test report.
---

# React quickstart

Get a shake-to-report widget into a React app in under five minutes.

  {QUICKSTART_ONE_KEY_CALLOUT}

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

  return (
    
      
    
  )
}
```

  The web SDK uses your **public** API key (safe to bundle). All sensitive
  operations are gated server-side by RLS + the gateway. Never ship your
  service-role key to the browser.

## 3. Trigger reports

Add a hook anywhere in your tree to capture programmatic reports:

```tsx filename="src/components/CrashFallback.tsx"

  const { submit } = useMushiReport()
  return (
    
      Something broke.
       submit({ description: error.message, severity: 'high' })}>
        Send a bug report
      
    
  )
}
```

Or rely on the built-in shake-to-report widget — no code required, just
configure `enableWidget: true` (default) on the provider.

## 4. Verify

Open your admin console at [kensaur.us/mushi-mushi/admin](https://kensaur.us/mushi-mushi/admin) (or your self-hosted
instance) — your first report should appear in the Reports list within a
second of submission, classified by the LLM pipeline within ~10s.

## Next steps

- [Concepts → Classification pipeline](/concepts/classification)
- [SDK reference → @mushi-mushi/react](/sdks/react)
- [Plugins → Receive a webhook in your own service](/plugins/building)
