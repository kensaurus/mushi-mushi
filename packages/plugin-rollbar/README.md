# `@mushi-mushi/plugin-rollbar`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


Mushi Mushi plugin: mirror classified reports into Rollbar and resolve the
mirrored item when Mushi applies a fix.

## Install

```bash
npm i @mushi-mushi/plugin-rollbar
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
ROLLBAR_ACCESS_TOKEN=...       # Rollbar `post_server_item` (or write) access token
ADMIN_BASE_URL=https://...     # Mushi admin base URL
PORT=3000                      # optional
npx mushi-plugin-rollbar
```

Install **Rollbar Mirror** in the Mushi admin Marketplace and point its
`webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createRollbarPlugin } from '@mushi-mushi/plugin-rollbar'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createRollbarPlugin({
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN!,
  adminBaseUrl: process.env.ADMIN_BASE_URL!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` → `POST /api/1/item/` to create an Item.
- `fix.applied` → `PATCH /api/1/item/{id}` with `status: resolved`.

## Notes

- Outbound calls retry transient `429`/`5xx` via `withRetry` from
  `@mushi-mushi/plugin-sdk`.
- Auth header is `X-Rollbar-Access-Token` per Rollbar's REST API spec.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 51 edge functions · 323 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
