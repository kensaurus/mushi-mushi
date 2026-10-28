# `@mushi-mushi/plugin-sentry`

> **Your AI wrote it. Mushi tells you why it broke.**

Copies the bugs your users report through Mushi into Sentry, so they show up
next to your Sentry errors, and marks them resolved when Mushi applies a fix.

**Do you need this package?** Only for that copy into Sentry. On Mushi Cloud,
Sentry errors flowing *into* Mushi, and resolving the linked Sentry issue
when a Mushi fix merges, are built in: connect Sentry on the
**Integrations** page of the console.

```bash
npm i @mushi-mushi/plugin-sentry
export MUSHI_PLUGIN_SECRET=...   # the signing secret you set when installing "Sentry Mirror"
export SENTRY_DSN=...            # project DSN, used for the store endpoint
export SEVERITY_THRESHOLD=high   # optional; default `high`
npx -p @mushi-mushi/plugin-sentry mushi-plugin-sentry   # POST /mushi/webhook on PORT (default 3000)
```

Then install **Sentry Mirror** from the console's **Marketplace** page and
set its webhook URL to `https://<your-host>/mushi/webhook`.

Docs: https://kensaur.us/mushi-mushi/docs/plugins/sentry

Optional, to resolve the Sentry issue on `fix.applied` and attach reports as
User Feedback:

```bash
export SENTRY_AUTH_TOKEN=...     # org auth token with event:admin + project:read
export SENTRY_ORG_SLUG=acme
export SENTRY_PROJECT_SLUG=web
export MARK_IN_PROGRESS=true     # also send an event on fix.proposed
```

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-sentry @mushi-mushi/plugin-sdk express
```

```ts
import { createSentryPlugin } from '@mushi-mushi/plugin-sentry'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createSentryPlugin({
  sentryDsn: process.env.SENTRY_DSN!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
  severityThreshold: 'high',
  // Optional: enables auto-resolve.
  sentryAuthToken: process.env.SENTRY_AUTH_TOKEN,
  sentryOrgSlug: 'acme',
  sentryProjectSlug: 'web',
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` — forwarded to Sentry as **User Feedback** via
  `POST /api/0/projects/{org}/{project}/user-feedback/` when an
  `sentryAuthToken` + a valid `sentry_event_id` are both present on the
  report. The feedback is then attached to the originating Sentry issue so
  triage sees the user's words next to the existing event. When either is
  missing the plugin falls back to the legacy Store endpoint and captures
  a fresh event with the deterministic fingerprint below.
- `fix.proposed` — annotates Sentry only if `markInProgress: true`.
- `fix.applied` — captures an `info` event with `mushi.fixed=true`, and
  (when an auth token is supplied) resolves the matching Sentry issue.

## Fingerprinting

Captured events (Store-endpoint fallback path, not User Feedback) use a
deterministic fingerprint of `['mushi', projectId, reportId]` so Sentry
de-dupes the user report into a single issue across re-deliveries. Tags
include `mushi.report_id`, `mushi.event`, `mushi.severity`, and (on fixes)
`mushi.pr_url`. The User Feedback path uses Sentry's native event grouping
instead — feedback attaches to whichever issue owns the linked
`sentry_event_id`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 526 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
