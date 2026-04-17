# `@mushi-mushi/plugin-pagerduty`

Reference Mushi Mushi plugin: page on-call via PagerDuty when a critical bug
is reported (or an SLA is breached).

## Install

```bash
npm i @mushi-mushi/plugin-pagerduty
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
PAGERDUTY_ROUTING_KEY=...      # PagerDuty Events API v2 routing key
SEVERITY_THRESHOLD=critical    # optional; default `critical`
PORT=3000                      # optional
npx mushi-plugin-pagerduty
```

Then in the Mushi admin Marketplace install the **PagerDuty Escalation**
plugin and point its `webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createPagerDutyPlugin } from '@mushi-mushi/plugin-pagerduty'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createPagerDutyPlugin({
  routingKey: process.env.PAGERDUTY_ROUTING_KEY!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` — pages when severity ≥ threshold.
- `sla.breached` — pages unconditionally with the breach severity.

## Dedup

Each PagerDuty event uses `mushi:<projectId>:<reportId>` as the dedup key,
so re-firing the same event will update the existing incident rather than
creating a duplicate.

## License

MIT
