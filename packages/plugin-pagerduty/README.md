# `@mushi-mushi/plugin-pagerduty`

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

For teams with someone on call. This pages whoever is on call in PagerDuty
when Mushi Mushi triages a bug as critical, and resolves the page when the fix
lands.

**Do you need this package?** Usually not. On Mushi Mushi Cloud you add
PagerDuty on the **Integrations** page of the console (paste the Events API v2
routing key, on any plan) and Mushi pages and resolves for you. Run this
package only if you want the PagerDuty calls to come from your own server.
Installing **PagerDuty Escalation** from the Marketplace needs a paid plan
(Builder or above, see [pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

```bash
npm i @mushi-mushi/plugin-pagerduty
export MUSHI_PLUGIN_SECRET=...       # the signing secret you set when installing "PagerDuty Escalation"
export PAGERDUTY_ROUTING_KEY=...     # PagerDuty Events API v2 routing key
export SEVERITY_THRESHOLD=critical   # optional; default `critical`
npx -p @mushi-mushi/plugin-pagerduty mushi-plugin-pagerduty   # POST /mushi/webhook on PORT (default 3000)
```

Then install **PagerDuty Escalation** from the console's **Marketplace**
page and set its webhook URL to `https://<your-host>/mushi/webhook`. The
listing subscribes to `report.classified` and `sla.breached` only, so add
`fix.applied` and `report.status_changed` to its subscribed events if you
want pages to resolve on their own.

Docs: https://kensaur.us/mushi-mushi/docs/plugins/pagerduty

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-pagerduty @mushi-mushi/plugin-sdk express
```

```ts
import { createPagerDutyPlugin } from '@mushi-mushi/plugin-pagerduty'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createPagerDutyPlugin({
  routingKey: process.env.PAGERDUTY_ROUTING_KEY!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified`: pages when the severity is at or above the threshold.
- `sla.breached`: pages with the breach severity, whatever the threshold.
  Mushi does not send this event yet.
- `fix.applied`: resolves the page.
- `report.status_changed`: resolves the page when the new status is
  `fixed` or `resolved`.

The returned handler also has `dispatchResolve({ reportId, dedupKey, summary })`
for resolving a page from your own code.

## Dedup

Each PagerDuty event uses `mushi:<projectId>:<reportId>` as the dedup key,
so a repeat of the same event updates the open incident. No second incident
opens.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
