# `@mushi-mushi/plugin-sentry`

Reference Mushi Mushi plugin: mirror critical user-reported bugs into Sentry,
and resolve the matching Sentry issue when Mushi applies a fix.

Mushi already _consumes_ Sentry data via the Seer poller / webhook (see
`packages/server/.../sentry-seer-poll`); this plugin is the complementary
**outbound** bridge so user reports show up next to telemetry-only errors
in Sentry.

## Install

```bash
npm i @mushi-mushi/plugin-sentry
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
SENTRY_DSN=...                 # project DSN — used for the store endpoint
SEVERITY_THRESHOLD=high        # optional; default `high`

# Optional: enable auto-resolve on `fix.applied`
SENTRY_AUTH_TOKEN=...          # org auth token with event:admin + project:read
SENTRY_ORG_SLUG=acme
SENTRY_PROJECT_SLUG=web

PORT=3000                      # optional
npx mushi-plugin-sentry
```

Then in the Mushi admin Marketplace install the **Sentry Mirror** plugin and
point its `webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createSentryPlugin } from '@mushi-mushi/plugin-sentry'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

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

- `report.classified` — captures an event in Sentry when severity ≥ threshold.
- `fix.proposed` — annotates Sentry only if `markInProgress: true`.
- `fix.applied` — captures an `info` event with `mushi.fixed=true`, and
  (when an auth token is supplied) resolves the matching Sentry issue.

## Fingerprinting

Every captured event uses a deterministic fingerprint of
`['mushi', projectId, reportId]` so Sentry de-dupes the user report into a
single issue across re-deliveries. Tags include `mushi.report_id`,
`mushi.event`, `mushi.severity`, and (on fixes) `mushi.pr_url`.

## License

MIT
