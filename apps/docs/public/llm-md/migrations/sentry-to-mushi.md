# Sentry + Mushi Mushi (enrich or standalone)

Source: https://kensaur.us/mushi-mushi/docs/migrations/sentry-to-mushi

---
title: 'Sentry + Mushi Mushi (enrich or standalone)'
description: Add Mushi Mushi alongside Sentry or run it on its own. Three setups, the Sentry webhook for errors, and user bug reports with plain-English diagnoses.
---

# Sentry + Mushi Mushi (enrich or standalone)

 

**This is not a rip-out guide.** Sentry is good at exception tracking,
performance monitoring, and release health, so keep it. Mushi Mushi adds
user-triggered bug reports with a plain-English AI diagnosis and a
paste-ready fix you can hand to your editor's agent via MCP.

  **Three ways to run Mushi with Sentry:**
  1. **Route errors in (recommended).** Point a Sentry internal integration's
     webhook at `/v1/webhooks/sentry?projectId=<your-project>` (and import
     the issues you already have) and Sentry errors land
     in the same Mushi queue as user reports: deduped per issue, diagnosed in
     plain English, fix-dispatchable. Merging the fix resolves the Sentry issue;
     resolving in Sentry resolves the report; a repeat alert on a fixed report
     reopens it as a regression. See [the Sentry plugin page](/plugins/sentry)
     for the setup.
  2. **Enrich.** Keep Sentry as-is. Mushi captures user bug reports, and with
     `sentry` set in the Mushi config each report carries the active Sentry
     event, trace and replay IDs. (`@mushi-mushi/plugin-sentry` is the
     opposite direction: it copies Mushi reports into Sentry.)
  3. **Standalone.** Use Mushi on its own for capture, diagnosis and fix. You
     can add Sentry later (or never); nothing in Mushi assumes it.

## What each tool is for

| Job | Sentry | Mushi |
|-----|--------|-------|
| Unhandled exception capture | ✅ best-in-class | ✅ (basic) |
| Performance / tracing / release health | ✅ | ❌ (keep Sentry) |
| User-triggered bug reports (widget) | ✅ (User Feedback) | ✅ feedback-first (shake on the mobile SDKs) |
| Plain-English AI diagnosis per report | Seer (paid add-on, $40 per active contributor/mo) | ✅ included, BYOK on self-host |
| Paste-ready fix prompt via MCP | Sentry MCP: issue lookup, status updates, and Seer root cause + suggested fix (Seer add-on) | ✅ full fix-dispatch loop |
| Self-host | complex (Sentry self-hosted) | ✅ Supabase / Docker / Helm |
| Open source | FSL | MIT SDKs / AGPLv3 server |

## Option 1: Enrich (run both, link events)

Install Mushi alongside Sentry. The two SDKs don't interfere: Mushi's
widget is Shadow-DOM isolated.

```ts
import * as Sentry from '@sentry/react'
import { Mushi } from '@mushi-mushi/web'

Sentry.init({ dsn: 'YOUR_DSN' })

// Mushi looks for Sentry on globalThis. A bundled Sentry SDK isn't there
// by default, so expose it once:
;(globalThis as Record<string, unknown>).Sentry = Sentry

const mushi = Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: 'YOUR_PUBLIC_KEY',
  // At submit time, attach the last Sentry event ID, scope, trace and
  // replay IDs to each report.
  sentry: {},
})
```

To also copy Mushi reports into Sentry, run
[`@mushi-mushi/plugin-sentry`](/plugins/sentry) on your server.

If you use Sentry Session Replay, see
[Sentry Replay coexistence](/sdks/sentry-replay-coexistence) for the
CSP + sampling configuration that lets both record cleanly.

## Option 2: Standalone

Run the wizard; it detects your framework and wires everything:

```bash
npx mushi-mushi
```

Mushi captures unhandled exceptions too (via `window.onerror` /
`unhandledrejection` and the Node handler), so a small app can skip
Sentry. If you outgrow it on the monitoring side, add Sentry then. The
SDKs coexist.

## API mapping (for code you already have)

`Mushi.init()` returns the SDK instance; the methods below are called on
it (`const mushi = Mushi.init({...})`). In React, get it with
`useMushiSdk()` from `@mushi-mushi/react`.

| Sentry | Mushi Mushi |
|--------|-------|
| `Sentry.init({ dsn })` | `const mushi = Mushi.init({ projectId, apiKey })` |
| `Sentry.setUser({ id, email })` | `mushi.setUser({ id, email })` |
| `Sentry.setTag(k, v)` | `mushi.setTag(k, v)` |
| `Sentry.setContext(name, ctx)` | `mushi.setMetadata(name, ctx)` |
| `Sentry.captureException(err)` | `mushi.captureException(err)` (or keep sending to Sentry) |
| `Sentry.captureMessage(msg)` | `mushi.captureEvent({ description: msg })` |
| `Sentry.addBreadcrumb(...)` | `mushi.addBreadcrumb(...)`; clicks, navigation, console and network are recorded automatically |
| User Feedback widget | The Mushi widget (by default a floating button on desktop, an edge tab on phones), or open it yourself with `mushi.open()` |

## Migration checklist

Run npx mushi-mushi. It handles browser sign-in, project pick, SDK install, and env vars.</> },
    { id: 'install', label: 'Install Mushi alongside Sentry (do not remove Sentry)', content: {`npm install @mushi-mushi/web
# or @mushi-mushi/react on React. Sentry stays in package.json`} },
    { id: 'mount-both', label: 'Mount both SDKs, with Sentry linking on', content: {`Sentry.init({ dsn: 'YOUR_DSN' })
;(globalThis as Record<string, unknown>).Sentry = Sentry
const mushi = Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: 'YOUR_PUBLIC_KEY',
  sentry: {},
})`} },
    { id: 'mirror-identify', label: 'Mirror Sentry.setUser into mushi.setUser', content: {`function identifyEverywhere(user: { id: string; email?: string; name?: string }) {
  Sentry.setUser(user)
  mushi.setUser(user)
}`} },
    { id: 'wire-mcp', label: 'Wire the Mushi MCP server into your editor', content: <>Run npx mushi-mushi setup --ide cursor (or claude / continue / zed). Now get_fix_context returns a paste-ready fix for every diagnosed report.</> },
    { id: 'verify', label: 'Submit a test report and check the Sentry link', content: <>Trigger an error, submit a Mushi report, and confirm the report shows the Sentry event ID of that error.</> },

/>

## When would you actually drop Sentry?

Only if you never used its monitoring depth. If a small app adopted
Sentry only for error emails, Mushi's capture and diagnosis may cover it.
That's a side effect, not the goal. If you rely on tracing,
release health, or alerting rules, **keep Sentry**; Mushi is built to sit
next to it.

## References

- [`@mushi-mushi/plugin-sentry`](/plugins/sentry)
- [Sentry Replay coexistence](/sdks/sentry-replay-coexistence)
- [Mushi MCP server](/quickstart/mcp)
- [Sentry User Feedback docs](https://docs.sentry.io/product/user-feedback/)
