# `@mushi-mushi/plugin-crashlytics`

Mushi Mushi plugin: when Mushi marks a report fixed, close the matching
Crashlytics issue (and write a Remote Config marker so the mobile client can
short-circuit duplicate reports).

## Install

```bash
npm i @mushi-mushi/plugin-crashlytics
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...                # set when the plugin is installed in Mushi admin
GOOGLE_OAUTH_BEARER=...                # short-lived Google OAuth2 access token
FIREBASE_PROJECT_ID=...                # Firebase project id
PORT=3000                              # optional
npx mushi-plugin-crashlytics
```

Issue an OAuth2 bearer with the
`https://www.googleapis.com/auth/firebase` scope and refresh it via your
service-account workflow before each run.

## Programmatic usage

```ts
import { createCrashlyticsPlugin } from '@mushi-mushi/plugin-crashlytics'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createCrashlyticsPlugin({
  bearer: process.env.GOOGLE_OAUTH_BEARER!,
  projectId: process.env.FIREBASE_PROJECT_ID!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `fix.applied` →
  - Remote Config: PATCH `mushi_resolved_{reportId} = true` so the mobile SDK
    can suppress duplicate reports for the same root cause.
  - Crashlytics v1alpha: PATCH the issue to `state: CLOSED`.

## Notes

- The plugin is **outbound-only**; for inbound Crashlytics → Mushi
  ingestion use the Crashlytics adapter in `@mushi-mushi/adapters`.
- Bearer token refresh is the caller's responsibility — design assumes the
  process runs behind a service-account refresher (Google ADC, IAM
  Workload Identity).

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 43 edge functions · 234 SQL migrations · 13 outbound plugins · 11 inbound adapters. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
