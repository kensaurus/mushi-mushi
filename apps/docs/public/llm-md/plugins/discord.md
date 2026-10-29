# Discord

Source: https://kensaur.us/mushi-mushi/docs/plugins/discord

---
title: Discord
description: Post Mushi Mushi report and fix events to a Discord channel. Paste a channel webhook on the Integrations page, or run the self-hosted Discord plugin.
---

# Discord plugin

Posts a message to a Discord channel when Mushi Mushi triages a bug or a fix
lands.

## Setup (Mushi Cloud, no code)

1. In Discord: **Channel settings → Integrations → Webhooks → New Webhook**, then copy its URL.
2. In the Mushi console: open the **Integrations** page and paste the URL on the Discord card.

Mushi posts to the channel itself; you do not need the npm package.

## Self-hosted plugin

[`@mushi-mushi/plugin-discord`](https://www.npmjs.com/package/@mushi-mushi/plugin-discord)
does the same from your own server. The console's Marketplace has no Discord
listing, so you can't install it from the console. On a Mushi server you run
yourself, add a `plugin_registry` row for it and install it like any listed
plugin.

```bash
npm i @mushi-mushi/plugin-discord
export MUSHI_PLUGIN_SECRET=...
export DISCORD_WEBHOOK_URL=https://discord.com/...
export ADMIN_BASE_URL=https://...   # optional: console URL for report links
npx -p @mushi-mushi/plugin-discord mushi-plugin-discord
```

| Event | Embed |
| --- | --- |
| `report.classified` | Coloured by severity (critical red, high orange, medium yellow, low green) |
| `fix.proposed` | Blue, with the PR link when there is one |
| `fix.applied` | Green, with the PR link |
| `report.status_changed` | Grey, "moved from X to Y" |

The fix embeds also have a "Fix status" field: proposed, applied or failed,
taken from the event.
