# Microsoft Teams

Source: https://kensaur.us/mushi-mushi/docs/plugins/msteams

---
title: Microsoft Teams
description: Send cards to a Microsoft Teams channel when Mushi Mushi triages a report or a fix lands. Paste a Workflows webhook in Integrations, or self-host the plugin.
---

# Microsoft Teams plugin

Posts a card to a Teams channel when Mushi Mushi triages a bug or a fix lands.

## Setup (Mushi Cloud, no code)

1. In Teams: create a Workflows webhook for your channel (the **Post to a channel when a webhook request is received** template) and copy its URL. Microsoft has retired the old Office 365 **Incoming Webhook** connector, so use Workflows.
2. In the Mushi console: open the **Integrations** page and paste the URL on the Teams card.

Mushi posts to the channel itself; you do not need the npm package.

## Self-hosted plugin

[`@mushi-mushi/plugin-msteams`](https://www.npmjs.com/package/@mushi-mushi/plugin-msteams)
does the same from your own server with Adaptive Card 1.4 cards. The
console's Marketplace has no Teams listing, so you can't install it from the
console. On a Mushi server you run yourself, add a `plugin_registry` row for
it and install it like any listed plugin.

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
| `fix.proposed` | With a PR button when there is a PR link |
| `fix.applied` | Green confirmation, with a PR button |

The fix cards also list a "Fix status" fact: proposed, applied or failed, taken
from the event.
