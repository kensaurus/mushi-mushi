# Microsoft Teams

Source: https://kensaur.us/mushi-mushi/docs/plugins/msteams

---
title: Microsoft Teams
---

# Microsoft Teams plugin

Delivers Adaptive Cards to a Teams incoming webhook when reports are classified or fixes land.

## Setup

1. In Teams: add an **Incoming Webhook** connector to your channel.
2. In Mushi: **Marketplace → Microsoft Teams → Install** and paste the webhook URL.
3. Set severity filters if you only want P0/P1 cards.

## Package

[`@mushi-mushi/plugin-msteams`](https://www.npmjs.com/package/@mushi-mushi/plugin-msteams)

## Events

| Event | Action |
| --- | --- |
| `report.classified` | Adaptive Card with severity + component |
| `fix.applied` | Card with merge summary |
