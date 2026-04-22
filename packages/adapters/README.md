# `@mushi-mushi/adapters`

Inbound webhook translators that turn third-party observability events
(Datadog, New Relic, Honeycomb, Grafana / Loki Alertmanager) into Mushi
Mushi reports. Use these when you want production monitors to land in the
same triage + fix pipeline as your user-filed bug reports.

## Install

```bash
npm i @mushi-mushi/adapters
```

## Supported sources

| Source                | Translator              | Webhook handler                   |
| --------------------- | ----------------------- | --------------------------------- |
| Datadog               | `translateDatadog`      | `createDatadogWebhookHandler`     |
| Honeycomb             | `translateHoneycomb`    | `createHoneycombWebhookHandler`   |
| New Relic             | `translateNewRelic`     | `createNewRelicWebhookHandler`    |
| Grafana / Loki (AM)   | `translateGrafanaLoki`  | `createGrafanaLokiWebhookHandler` |

Every translator outputs `MushiCaptureEventInput` (from `@mushi-mushi/core`)
so you can route the result to any sink — the hosted Mushi API, a queue, a
local database, a fan-out of all four.

## Quick start — Datadog → Hono

```ts
import { Hono } from 'hono'
import { createDatadogWebhookHandler } from '@mushi-mushi/adapters'
import { MushiNodeClient } from '@mushi-mushi/node'

const mushi = new MushiNodeClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})

const handler = createDatadogWebhookHandler({
  secret: process.env.DATADOG_WEBHOOK_SECRET!,
  sink: async (event) => {
    await mushi.captureReport({
      description: event.description,
      severity: event.severity,
      component: event.component,
      metadata: { ...event.metadata, source: event.source, tags: event.tags },
    })
  },
})

const app = new Hono()
app.post('/webhooks/datadog', async (c) => {
  const raw = await c.req.text()
  const res = await handler({
    rawBody: raw,
    headers: Object.fromEntries(c.req.raw.headers),
  })
  return c.json(res.body ?? {}, res.status)
})
```

## Severity mapping

Each adapter maps the source's native severity onto Mushi's four-level scale:

| Mushi        | Datadog | New Relic | Honeycomb | Grafana/AM |
| ------------ | ------- | --------- | --------- | ---------- |
| `critical`   | P1      | critical  | critical  | critical   |
| `high`       | P2      | high      | warning   | high       |
| `medium`     | P3      | medium    | info      | warning    |
| `low`        | P4–P5   | low       | —         | info       |

## Authentication

Datadog, New Relic, and Honeycomb don't sign webhooks — each handler
enforces a **shared-secret header** that you set on both ends. Grafana
Alertmanager supports HMAC; use the signed variant when available.

## License

MIT
