# `@mushi-mushi/plugin-discord`

Mushi Mushi plugin: post Discord embeds to an Incoming Webhook for key
report lifecycle events.

## Install

```bash
npm i @mushi-mushi/plugin-discord
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...                       # set when the plugin is installed in Mushi admin
DISCORD_WEBHOOK_URL=https://discord.com/...   # Incoming Webhook URL
ADMIN_BASE_URL=https://...                    # Mushi admin base URL (deep-links)
PORT=3000                                     # optional
npx mushi-plugin-discord
```

Install **Discord Notifier** in the Mushi admin Marketplace and point its
`webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createDiscordPlugin } from '@mushi-mushi/plugin-discord'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createDiscordPlugin({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
  adminBaseUrl: process.env.ADMIN_BASE_URL!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` — embed coloured by severity (`critical` red, `high`
  orange, `medium` yellow, `low` green).
- `fix.proposed` — blue embed.
- `fix.applied` — green embed.
- `report.status_changed` — grey embed with the new status.

## Notes

- All webhook calls retry transient `5xx` via `withRetry` from
  `@mushi-mushi/plugin-sdk`.
- Embed colour palette mirrors `_shared/discord.ts` server-side so
  notifications look consistent regardless of which path fires them.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 43 edge functions · 234 SQL migrations · 13 outbound plugins · 11 inbound adapters. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
