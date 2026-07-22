# `@mushi-mushi/plugin-bugsnag`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


Mushi Mushi plugin: mirror classified reports into Bugsnag and mark the
mirrored error as `fixed` when Mushi applies a fix.

## Install

```bash
npm i @mushi-mushi/plugin-bugsnag
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
BUGSNAG_API_KEY=...            # Bugsnag Data API token
BUGSNAG_PROJECT_SLUG=...       # visible in your Bugsnag project URL
ADMIN_BASE_URL=https://...     # Mushi admin base URL (used in deep-link)
PORT=3000                      # optional
npx mushi-plugin-bugsnag
```

Then in the Mushi admin Marketplace install the **Bugsnag Mirror** plugin and
point its `webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createBugsnagPlugin } from '@mushi-mushi/plugin-bugsnag'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createBugsnagPlugin({
  apiKey: process.env.BUGSNAG_API_KEY!,
  projectSlug: process.env.BUGSNAG_PROJECT_SLUG!,
  adminBaseUrl: process.env.ADMIN_BASE_URL!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` → `POST /v2/projects/{slug}/errors` (deterministic
  `groupingHash` keeps user-reported issues grouped in the Bugsnag dashboard).
- `fix.applied` → `PATCH /v2/projects/{slug}/errors/{errorId}` with
  `status: fixed`.

## Notes

- Outbound calls are wrapped in `withRetry` from `@mushi-mushi/plugin-sdk`
  (honours `Retry-After` on 429).
- The default error-id cache is in-memory; persist to
  `report_external_issues` for production deployments so resolves survive a
  restart.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 327 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
