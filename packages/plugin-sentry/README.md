# `@mushi-mushi/plugin-sentry`

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

For teams who already watch Sentry and want user reports there too. This
copies the bugs your users report through Mushi Mushi into Sentry, next to your
Sentry errors, and marks them resolved when Mushi applies a fix.

**Do you need this package?** Only for that copy into Sentry. On Mushi Mushi
Cloud, Sentry errors flowing *into* Mushi, and resolving the linked Sentry
issue when a Mushi fix merges, are built in: connect Sentry on the
**Integrations** page of the console, on any plan. Installing **Sentry Mirror**
from the Marketplace needs a paid plan (Builder or above, see
[pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

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

Optional, to resolve the Sentry issue on `fix.applied`:

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

- `report.classified`: for reports at or above the severity threshold,
  captures a Sentry event through the Store endpoint, with the fingerprint
  below. The code can instead send the report as **User Feedback** on an
  existing Sentry event when the payload carries `report.sentry_event_id` and
  an auth token is set, but Mushi does not send `sentry_event_id` today, so
  every report takes the Store path.
- `fix.proposed`: sends an event to Sentry only if `markInProgress: true`.
- `fix.applied`: captures an `info` event with `mushi.fixed=true`, and (when
  an auth token is set) resolves the Sentry issue tagged with the report id.

## Fingerprinting

Captured events (Store-endpoint fallback path, not User Feedback) use a
deterministic fingerprint of `['mushi', projectId, reportId]` so Sentry
de-dupes the user report into a single issue across re-deliveries. Tags
include `mushi.report_id`, `mushi.event`, `mushi.severity`, and (on fixes)
`mushi.pr_url`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
