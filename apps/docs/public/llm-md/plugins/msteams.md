# Microsoft Teams

Source: https://kensaur.us/mushi-mushi/docs/plugins/msteams

---
title: Microsoft Teams
description: Send cards to a Microsoft Teams channel when Mushi triages a report or a fix lands — paste a webhook on the Integrations page, or self-host the plugin.
---

# Microsoft Teams plugin

Posts a card to a Teams channel when Mushi triages a bug or a fix lands.

## Setup (Mushi Cloud, no code)

1. In Teams: add an incoming webhook to your channel (an **Incoming Webhook** connector, or a Workflows webhook) and copy its URL.
2. In the Mushi console: open the **Integrations** page and paste the URL on the Teams card.

Mushi posts to the channel itself; you do not need the npm package.

## Self-hosted plugin

[`@mushi-mushi/plugin-msteams`](https://www.npmjs.com/package/@mushi-mushi/plugin-msteams)
does the same from your own server with Adaptive Card 1.4 cards. The
console's Marketplace has no Teams listing, so it only receives events from a
Mushi server you run yourself, once you add a `plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-msteams
export MUSHI_PLUGIN_SECRET=...
export TEAMS_WEBHOOK_URL=https://...
export ADMIN_BASE_URL=https://...   # optional: console URL for report links
npx -p @mushi-mushi/plugin-msteams mushi-plugin-msteams
```

| Event | Card |
| --- | --- |
| `report.classified` | Coloured by severity |
| `fix.proposed` | With the PR link when there is one |
| `fix.applied` | Green confirmation |
