# `@mushi-mushi/plugin-msteams`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


Mushi Mushi plugin: post Adaptive Card 1.4 notifications to a Microsoft
Teams Incoming Webhook for the major report lifecycle events.

## Install

```bash
npm i @mushi-mushi/plugin-msteams
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
TEAMS_WEBHOOK_URL=https://...  # Microsoft Teams Incoming Webhook URL
ADMIN_BASE_URL=https://...     # Mushi admin base URL (deep-links)
PORT=3000                      # optional
npx mushi-plugin-msteams
```

Install **Microsoft Teams** in the Mushi admin Marketplace and point its
`webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createMsTeamsPlugin } from '@mushi-mushi/plugin-msteams'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createMsTeamsPlugin({
  webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
  adminBaseUrl: process.env.ADMIN_BASE_URL!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` — Adaptive Card with severity-coloured accent.
- `fix.proposed` — Adaptive Card with PR link if available.
- `fix.applied` — green confirmation card.

## Notes

- Adaptive Card schema version `1.4` so cards render correctly in modern
  Teams clients (desktop ≥ 1.5.x, mobile ≥ April 2024 release).
- All webhook calls retry transient `5xx` via `withRetry` from
  `@mushi-mushi/plugin-sdk`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 54 edge functions · 324 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
