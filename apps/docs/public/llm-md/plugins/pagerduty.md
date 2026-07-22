# PagerDuty

Source: https://kensaur.us/mushi-mushi/docs/plugins/pagerduty

---
title: PagerDuty
---

# PagerDuty plugin

Pages your on-call rotation when a P0 or P1 report lands in Mushi.

## Setup

1. In PagerDuty, navigate to **Services → your service → Integrations** and add the **Events API v2** integration.
2. Copy the **Integration Key** (looks like `R01AB…`).
3. In Mushi: **Marketplace → PagerDuty → Install**.
4. Paste the integration key into `routing_key`.
5. Set `subscribed_severities` — default is `p0,p1`. Change to `p0,p1,p2` to also page for high-severity reports.

## Behaviour

| Event | Action |
| --- | --- |
| `report.created` where `severity ∈ subscribed_severities` | Fires a PagerDuty `trigger` event |
| `report.status_changed → resolved` | Fires a `resolve` with the same `dedup_key`, auto-closing the incident |

PagerDuty event fields:

| PagerDuty field | Mushi source |
| --- | --- |
| `dedup_key` | `report_id` — prevents double-paging on retries |
| `summary` | report `title` |
| `source` | report `url` |
| `severity` | `p0/p1 → critical`, `p2 → error`, `p3 → warning` |
| `custom_details` | `{ severity, taxonomy_path, blast_radius }` |

## Troubleshooting

- **No page fired** — check **Marketplace → PagerDuty → Deliveries** for the last dispatch status. A `401` means the integration key is wrong; a `429` means PagerDuty rate-limited the request.
- **Duplicate incidents** — confirm `dedup_key = report_id` is being used. If you've installed two PagerDuty plugins on the same project, deduplicate by removing one.
- **Incident not auto-resolving** — the `report.status_changed` event is only emitted when status is set via the Mushi API or admin console, not when the fix PR is merged (use `fix.applied` for that).
