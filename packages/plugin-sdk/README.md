# `@mushi-mushi/plugin-sdk`

Build third-party plugins for [Mushi Mushi](https://mushimushi.dev). Plugins are
stand-alone HTTPS services that receive **signed event webhooks** from the
Mushi platform and may optionally call back into the REST API to comment on,
re-classify, or transition reports.

## Why a webhook model?

A webhook server is a stronger isolation boundary than running plugin code
inside the Mushi platform itself:

- Plugin failures, timeouts, or memory leaks can't take down the host.
- Plugin authors keep control of their language, deployment, and persistence.
- The Mushi backend does not need to vet/audit plugin code at install time.
- A plugin can be migrated, scaled, or rolled back independently of Mushi.

The trade-off is latency: the Mushi pipeline doesn't block on plugin
acknowledgement (deliveries are async), so plugins that need synchronous
mutation should call the REST API back from the handler.

## Install

```bash
npm i @mushi-mushi/plugin-sdk
```

## Quick start (Express)

```ts
import express from 'express'
import { createPluginHandler, expressMiddleware, createMushiClient } from '@mushi-mushi/plugin-sdk'

const mushi = createMushiClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})

const handler = createPluginHandler({
  secret: process.env.MUSHI_PLUGIN_SECRET!,
  on: {
    'report.created': async (e) => {
      console.log('New report', e.data)
    },
    'report.classified': async (e) => {
      const { classification } = e.data as { classification: { severity: string } }
      if (classification.severity === 'critical') {
        await mushi.comment((e.data as any).report.id, 'Auto-paged on-call.', { visibleToReporter: false })
      }
    },
  },
})

const app = express()
app.post('/mushi/webhook', expressMiddleware(handler))
app.listen(3000)
```

## Quick start (Hono / Edge)

```ts
import { Hono } from 'hono'
import { createPluginHandler, honoHandler } from '@mushi-mushi/plugin-sdk/hono'

const handler = createPluginHandler({
  secret: process.env.MUSHI_PLUGIN_SECRET!,
  on: { '*': async (e) => console.log(e.event, e.deliveryId) },
})

const app = new Hono()
app.post('/mushi/webhook', honoHandler(handler))
export default app
```

## Wire format

| Header                 | Value                                                                |
|------------------------|----------------------------------------------------------------------|
| `X-Mushi-Event`        | Event name (e.g. `report.created`)                                   |
| `X-Mushi-Signature`    | `t=<unix-ms>,v1=<hex>` — Stripe-style                                |
| `X-Mushi-Project`      | Project UUID                                                         |
| `X-Mushi-Plugin`       | Plugin slug (matches the marketplace listing)                        |
| `X-Mushi-Delivery`     | Per-delivery UUID; safe as an idempotency key                        |

The `v1` signature is `HMAC_SHA256(secret, "${t}.${rawBody}")` in lowercase
hex. Tolerance is 5 minutes by default and is verified in constant time.

## Marketplace

Once your plugin is ready, submit it to the Mushi marketplace by opening a PR
that adds your `plugin.json` manifest under `apps/admin/src/marketplace/`.
A reviewer will validate the manifest, the public callback URL, and the
requested API permissions before listing it.

## Reference plugins

The Mushi monorepo ships three open-source reference plugins built on this
SDK; copy and adapt them as a starting point:

- [`@mushi-mushi/plugin-pagerduty`](../plugin-pagerduty) — paged on critical
  severity events.
- [`@mushi-mushi/plugin-linear`](../plugin-linear) — bidirectional sync with
  Linear issues.
- [`@mushi-mushi/plugin-zapier`](../plugin-zapier) — fan-out to any Zapier
  workflow via incoming webhook.

## License

MIT
