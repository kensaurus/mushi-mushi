# `@mushi-mushi/plugin-discord`

> **Your AI wrote it. Mushi tells you why it broke.**

Posts a message to a Discord channel when Mushi triages a bug, proposes a
fix, applies it, or changes a report's status.

**Do you need this package?** Not on Mushi Cloud: paste a Discord webhook
URL on the **Integrations** page of the console and Mushi posts to the
channel itself. The console's Marketplace has no Discord listing (checked
2026-10-26), so this package only receives events from a Mushi server you
run yourself, once you add a `plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-discord
export MUSHI_PLUGIN_SECRET=...                       # the signing secret set when the plugin is installed
export DISCORD_WEBHOOK_URL=https://discord.com/...   # channel webhook URL
export ADMIN_BASE_URL=https://...                    # optional: Mushi console URL, for report links
npx -p @mushi-mushi/plugin-discord mushi-plugin-discord   # POST /mushi/webhook on PORT (default 3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/discord

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-discord @mushi-mushi/plugin-sdk express
```

```ts
import { createDiscordPlugin } from '@mushi-mushi/plugin-discord'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createDiscordPlugin({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
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

<sub>Monorepo scale (July 2026): 77 edge functions · 514 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
