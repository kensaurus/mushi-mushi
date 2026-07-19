# Zapier

Source: https://kensaur.us/mushi-mushi/docs/plugins/zapier

---
title: Zapier
---

# Zapier plugin

Fan every Mushi event out to Zapier and wire it into any of the 6,000+ Zapier integrations — Slack, Notion, Google Sheets, HubSpot, Jira, and more.

## Setup

1. In Zapier, create a **Zap** with the **Webhook by Zapier → Catch Hook** trigger.
2. Copy the webhook URL (e.g. `https://hooks.zapier.com/hooks/catch/…`).
3. In Mushi: **Marketplace → Zapier → Install**.
4. Paste the URL into `webhook_url`.
5. Optionally restrict to a subset of events (e.g. only `report.created`, `fix.applied`).

## Signature verification in Zapier

Mushi signs every payload with `HMAC-SHA256`. To verify inside Zapier, add a **Code by Zapier** step before your action:

```js
// Code by Zapier — JavaScript
const crypto = require('crypto')

const secret = process.env.MUSHI_WEBHOOK_SECRET  // set in Zapier Storage
const sig = inputData.mushiSignature               // from the webhook header
const body = JSON.stringify(inputData)

const expected = crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex')

if (sig !== expected) {
  throw new Error('Invalid signature — possible replay attack')
}
output = [{ verified: true }]
```

## Common Zaps

| Trigger | Action | Use case |
| --- | --- | --- |
| `report.created` (P0) | Post to Slack `#incidents` | Immediate team alert |
| `report.classified` | Create row in Google Sheets | Bug tracking in a spreadsheet |
| `fix.applied` | Create Notion database entry | Changelog / release notes |
| `report.created` | Create HubSpot ticket | Link product bugs to customer accounts |
| `judge.score_recorded` (score < 0.6) | Send Slack DM to team lead | Alert on low-quality fixes |

## Troubleshooting

- **Zap not firing** — check **Marketplace → Zapier → Deliveries** in Mushi. A non-2xx status from Zapier is logged with the response body.
- **Events arriving out of order** — Zapier processes webhooks sequentially per Zap. For high-volume projects, create separate Zaps per event type.
- **Payload too large** — Zapier's webhook step has a 1 MB body limit. Mushi payloads are typically < 10 KB; if they exceed this, contact support.
