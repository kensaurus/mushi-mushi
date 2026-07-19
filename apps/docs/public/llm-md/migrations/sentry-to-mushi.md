# Sentry + Mushi (enrich or standalone)

Source: https://kensaur.us/mushi-mushi/docs/migrations/sentry-to-mushi

---
title: 'Sentry + Mushi (enrich or standalone)'
---

# Sentry + Mushi (enrich or standalone)

 

**This is not a rip-out guide.** Sentry is excellent at exception tracking,
performance monitoring, and release health — keep it. Mushi adds what Sentry
doesn't do: user-triggered bug reports with plain-English AI diagnosis and a
paste-ready fix you can hand to your editor's agent via MCP.

  **Two ways to run Mushi with Sentry:**
  1. **Enrich** — keep Sentry as-is; Mushi captures user bug reports and links
     each one to the matching Sentry event via `@mushi-mushi/plugin-sentry`.
  2. **Standalone** — use Mushi on its own for capture + diagnosis + fix. You
     can add Sentry later (or never); nothing in Mushi assumes it.

## What each tool is for

| Job | Sentry | Mushi |
|-----|--------|-------|
| Unhandled exception capture | ✅ best-in-class | ✅ (basic) |
| Performance / tracing / release health | ✅ | ❌ — keep Sentry |
| User-triggered bug reports (widget, shake) | ✅ (User Feedback) | ✅ feedback-first |
| Plain-English AI diagnosis per report | Seer ($40/contributor add-on) | ✅ included, BYOK on self-host |
| Paste-ready fix prompt via MCP | read-only MCP | ✅ full fix-dispatch loop |
| Self-host | complex (Sentry self-hosted) | ✅ Supabase / Docker / Helm |
| Open source | FSL | MIT SDKs / AGPLv3 server |

## Option 1 — Enrich: run both, link events

Install Mushi alongside Sentry. Neither SDK interferes with the other —
Mushi's widget is Shadow-DOM isolated and captures on user trigger only.

```ts

Sentry.init({ dsn: 'YOUR_DSN' })
Mushi.init({ projectId: 'YOUR_PROJECT_ID', apiKey: 'YOUR_PUBLIC_KEY' })

// Link every Mushi report to the active Sentry scope:
const eventId = Sentry.lastEventId()
if (eventId) Mushi.setMetadata({ sentryEventId: eventId })
```

With [`@mushi-mushi/plugin-sentry`](/plugins/sentry) installed on the
server side, reports carry a one-click "Open in Sentry" link and Mushi's
diagnosis includes the Sentry stack trace as evidence.

If you use Sentry Session Replay, see
[Sentry Replay coexistence](/sdks/sentry-replay-coexistence) for the
CSP + sampling configuration that lets both record cleanly.

## Option 2 — Standalone

Run the wizard; it detects your framework and wires everything:

```bash
npx mushi-mushi
```

Mushi captures unhandled exceptions too (via `window.onerror` /
`unhandledrejection` and the Node handler), so a small app gets full
coverage without Sentry. If you outgrow it on the monitoring side, add
Sentry then — the SDKs coexist by design.

## API mapping (for code you already have)

| Sentry | Mushi |
|--------|-------|
| `Sentry.init({ dsn })` | `Mushi.init({ projectId, apiKey })` |
| `Sentry.setUser({ id, email })` | `Mushi.setUser({ id, email })` |
| `Sentry.setTag(k, v)` / `setContext` | `Mushi.setMetadata({ [k]: v })` |
| `Sentry.captureException(err)` | `Mushi.report({ description: err.message })` (or keep sending to Sentry) |
| `Sentry.captureMessage(msg)` | `Mushi.report({ description: msg })` |
| `Sentry.addBreadcrumb(...)` | automatic — Mushi's breadcrumb buffer records clicks, navigation, console, network |
| User Feedback widget | `` widget (shake / button / programmatic `mushi.openWidget()`) |

## Migration checklist

Run npx mushi-mushi — browser sign-in, project pick, SDK install, and env vars are automated.</> },
    { id: 'install', label: 'Install Mushi alongside Sentry (do not remove Sentry)', content: {`npm install @mushi-mushi/react
# Sentry stays in package.json`} },
    { id: 'mount-both', label: 'Mount both SDKs', content: {`Sentry.init({ dsn: 'YOUR_DSN' })
Mushi.init({ projectId: 'YOUR_PROJECT_ID', apiKey: 'YOUR_PUBLIC_KEY' })`} },
    { id: 'link-events', label: 'Link Sentry events into Mushi metadata', content: {`const eventId = Sentry.lastEventId()
if (eventId) Mushi.setMetadata({ sentryEventId: eventId })`} },
    { id: 'mirror-identify', label: 'Mirror Sentry.setUser into Mushi.setUser', content: {`function identifyEverywhere(user) {
  Sentry.setUser(user)
  Mushi.setUser(user)
}`} },
    { id: 'wire-mcp', label: 'Wire the Mushi MCP server into your editor', content: <>Run npx mushi-mushi setup --ide cursor (or claude / continue / zed). Now get_fix_context returns a paste-ready fix for every diagnosed report.</> },
    { id: 'verify', label: 'Submit a test report and check the Sentry link', content: <>Trigger an error, submit a Mushi report, and confirm the sentryEventId metadata opens the right Sentry event.</> },
  ]}
/>

## When would you actually drop Sentry?

Only if you never used its monitoring depth — small apps that adopted
Sentry solely for error emails sometimes find Mushi's capture + diagnosis
covers them. That's a side effect, not the goal. If you rely on tracing,
release health, or alerting rules, **keep Sentry**; Mushi is built to sit
next to it.

## References

- [`@mushi-mushi/plugin-sentry`](/plugins/sentry)
- [Sentry Replay coexistence](/sdks/sentry-replay-coexistence)
- [Mushi MCP server](/quickstart/mcp)
- [Sentry User Feedback docs](https://docs.sentry.io/product/user-feedback/)
