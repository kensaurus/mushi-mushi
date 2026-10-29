# Building a plugin

Source: https://kensaur.us/mushi-mushi/docs/plugins/building

---
title: Building a plugin
description: Build your own Mushi Mushi plugin, an HTTP endpoint that receives HMAC-signed webhook events and checks them with @mushi-mushi/plugin-sdk in a few lines.
---

# Building a plugin

A Mushi Mushi plugin is an HTTPS endpoint that receives HMAC-signed webhook events and does something useful with them. `@mushi-mushi/plugin-sdk` gives you a handler that checks the signature, drops duplicate deliveries and routes each event to your code, plus typed event shapes.

```bash
npm install @mushi-mushi/plugin-sdk hono
```

`hono` (or `express`) is an optional peer dependency; install the one your
server uses.

## Minimal receiver

```ts
import { Hono } from 'hono'
import { createPluginHandler } from '@mushi-mushi/plugin-sdk'
import { honoHandler } from '@mushi-mushi/plugin-sdk/hono'

const handler = createPluginHandler({
  secret: process.env.MUSHI_PLUGIN_SECRET!,
  on: {
    'report.classified': async (e) => {
      await handleTriaged(e.data)
    },
    'fix.applied': async (e) => {
      await handleFixApplied(e.data)
    },
  },
})

const app = new Hono()
app.post('/mushi/webhook', honoHandler(handler))

export default app
```

`honoHandler` comes from the `/hono` subpath, and `expressMiddleware` from
`@mushi-mushi/plugin-sdk/express`. For any other framework, call
`handler({ rawBody, headers })` yourself and send back the `status` and `body`
it returns. Events with no handler (and no `'*'` handler) are answered `200`
and ignored.

  Answer within 8 seconds. Mushi Mushi treats a slower answer as a timeout and retries it, even though the SDK handler's own time limit is 25 seconds. Any non-2xx answer is retried too: up to 5 attempts in all, about 30 s, 2 min, 10 min and 1 h apart. Queue long work instead of awaiting it inline. Retries reuse the same `deliveryId`, so the handler's duplicate check skips work that already succeeded (the default store is in memory; pass a `dedupStore` to share it across instances).

## Typed event shapes

```ts
import type {
  MushiEventEnvelope,
  MushiEventName,
  MushiReportCreatedEvent,
  MushiReportClassifiedEvent,
  MushiReportStatusChangedEvent,
  MushiFixEvent,
  MushiJudgeScoreEvent,
} from '@mushi-mushi/plugin-sdk'
```

`parseEvent(raw)` and `isKnownEvent(name)` are there for runtime checks.

Some SDK types promise fields the server doesn't send: fix events other than
`fix.requested` have no `fix.status`, `report.status_changed` has `actor`
rather than `actorUserId`, and the `judge` fields differ. See
[Webhook events](/plugins/events) for the payloads as sent.

## Signature verification

`createPluginHandler` checks the [Standard Webhooks](https://www.standardwebhooks.com/) headers when they are present: `webhook-signature: v1,` is HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, with the timestamp in seconds. Otherwise it checks the legacy `X-Mushi-Signature: t=<unix-ms>,v1=` header, HMAC-SHA256 over `${t}.${rawBody}`. Both reject a timestamp more than 5 minutes off.

To check by hand, use `verifyStandardWebhooksSignature({ rawBody, webhookId, webhookTimestamp, webhookSignature, secret })` or `verifySignature({ rawBody, header, secret })`. Always pass the exact raw body you received, not re-serialized JSON.

## Publishing to the marketplace

1. Open a PR with a migration in `packages/server/supabase/migrations/` that inserts a `plugin_registry` row. Required columns: `slug`, `name`, `short_description`, `publisher`, and `manifest` (a JSON object with `subscribes`, the default event list, and `config`). Optional: `long_description`, `homepage_url`, `source_url`, `required_scopes`, `category`.
2. Add a doc page at `apps/docs/content/plugins/.mdx`.
3. Once the migration is applied to the database, the listing appears under **Marketplace** for every project.

## Local testing

The SDK ships a `mushi-plugin` command that posts a signed sample event to
your local server:

```bash
export MUSHI_PLUGIN_SECRET=dev-secret
export MUSHI_PLUGIN_URL=http://localhost:3000/mushi/webhook   # default: http://localhost:3000/webhook
npx mushi-plugin simulate report.classified
```

To test against Mushi Mushi itself, expose your endpoint over HTTPS (for example `ngrok http 3000`), install the plugin with that URL, then press **Test** on it under **Marketplace → Installed**. The test sends a `test.delivery` event with `data: { test: true }`, and the result shows on the **Deliveries** tab.
