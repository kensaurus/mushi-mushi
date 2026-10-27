# PagerDuty

Source: https://kensaur.us/mushi-mushi/docs/plugins/pagerduty

---
title: PagerDuty
description: Page your on-call rotation through PagerDuty when Mushi triages a bug as critical, and resolve it when the fix lands — Events API v2 routing key setup.
---

# PagerDuty plugin

Pages whoever is on call when Mushi triages a bug as critical, and resolves
the page when the fix lands.

**Most people don't need the plugin.** Add PagerDuty on the console's
**Integrations** page (paste the Events API v2 routing key) and Mushi pages
and resolves for you. The plugin below is for sending the PagerDuty calls
from your own server.

## Setup (self-run plugin)

1. In PagerDuty, go to **Services → your service → Integrations** and add the **Events API v2** integration.
2. Copy the 32-character **Integration Key** (the routing key).
3. Start the server where Mushi can reach it over public HTTPS:

   ```bash
   npm i @mushi-mushi/plugin-pagerduty
   export MUSHI_PLUGIN_SECRET=...       # must match the signing secret in step 4
   export PAGERDUTY_ROUTING_KEY=...
   export SEVERITY_THRESHOLD=critical   # optional: low | medium | high | critical
   npx -p @mushi-mushi/plugin-pagerduty mushi-plugin-pagerduty
   ```

4. In the console: **Marketplace → PagerDuty Escalation → Install**. Set the
   webhook URL to `https://<your-host>/mushi/webhook`, and use the form's
   signing secret (Mushi generates one) as `MUSHI_PLUGIN_SECRET`. The listing subscribes to `report.classified` and
   `sla.breached`; add `fix.applied` and `report.status_changed` so pages
   resolve on their own.

## Behaviour

| Event | Action |
| --- | --- |
| `report.classified` with severity ≥ `SEVERITY_THRESHOLD` | Sends a PagerDuty `trigger` |
| `sla.breached` | Sends a `trigger` (Mushi does not emit this event yet) |
| `fix.applied` | Sends a `resolve` with the same `dedup_key` |
| `report.status_changed` to `fixed` or `resolved` | Sends a `resolve` with the same `dedup_key` |

PagerDuty event fields:

| PagerDuty field | Mushi source |
| --- | --- |
| `dedup_key` | `mushi::` — a re-sent event updates the same incident |
| `summary` | report `title` (or its id) |
| `source` | `mushi-mushi` |
| `severity` | `critical → critical`, `high → error`, `medium → warning`, `low → info` |
| `custom_details` | the full Mushi event envelope |

## Troubleshooting

- **No page fired** — check the plugin's last delivery status on the
  **Marketplace** page. A `401` from your server means the signing secret
  differs from `MUSHI_PLUGIN_SECRET`. Check the severity threshold too.
- **Duplicate incidents** — make sure PagerDuty is not set up both on the
  Integrations page and through this plugin.
- **Incident not auto-resolving** — add `fix.applied` and
  `report.status_changed` to the plugin's subscribed events.
