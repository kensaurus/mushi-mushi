# `@mushi-mushi/plugin-sdk`

> **Your AI wrote it. Mushi tells you why it broke.**

Write your own small HTTPS server that reacts when Mushi files, triages or
fixes a bug. The SDK checks Mushi's signature on each request, drops repeat
deliveries and calls your handler for the event.

You only need this to connect a tool Mushi does not cover. Slack, Discord,
Teams, Linear, Jira, GitHub Issues, PagerDuty and Sentry are connected on the
**Integrations** page of the Mushi console with no code.

```bash
npm i @mushi-mushi/plugin-sdk express
```

```ts
import express from 'express'
import { createPluginHandler } from '@mushi-mushi/plugin-sdk'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createPluginHandler({
  secret: process.env.MUSHI_PLUGIN_SECRET!,
  on: { 'report.classified': async (e) => console.log(e.data) },
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/sdks/plugin-sdk

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

## Express, with a call back into Mushi

`expressMiddleware` reads the raw body itself, so mount it before
`express.json()` or the signature check fails.

```ts
import express from 'express'
import { createPluginHandler, createMushiClient } from '@mushi-mushi/plugin-sdk'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

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

## Hono / Edge

```ts
import { Hono } from 'hono'
import { createPluginHandler } from '@mushi-mushi/plugin-sdk'
import { honoHandler } from '@mushi-mushi/plugin-sdk/hono'

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
| `webhook-id`           | [Standard Webhooks](https://www.standardwebhooks.com/): same as `X-Mushi-Delivery` |
| `webhook-timestamp`    | Standard Webhooks: unix seconds                                      |
| `webhook-signature`    | Standard Webhooks: `v1,<base64>` over `${webhook-id}.${webhook-timestamp}.${rawBody}` |

The `v1` signature is `HMAC_SHA256(secret, "${t}.${rawBody}")` in lowercase
hex. Tolerance is 5 minutes by default and is verified in constant time.
`createPluginHandler` checks the Standard Webhooks headers when all three are
present, and `X-Mushi-Signature` otherwise. To verify by hand, call
`verifySignature({ rawBody, header, secret })` or
`verifyStandardWebhooksSignature({ rawBody, webhookId, webhookTimestamp, webhookSignature, secret })`;
both return `{ ok: true }` or `{ ok: false, reason }`.

The body is `{ event, deliveryId, occurredAt, projectId, pluginSlug, data }`.
The event names are in `KNOWN_EVENTS` (`report.created`, `report.classified`,
`report.status_changed`, `fix.requested`, `fix.proposed`, `fix.applied`,
`fix.failed`, `qa_story.failed`, `qa_story.recovered`, and more). Unknown
events should be ignored, not treated as errors.

## Outbound HTTP utilities

The SDK ships two zero-dependency helpers used by every reference plugin:

### `withRetry(fn, opts)`

Exponential back-off + bounded-additive jitter for outbound HTTP calls.
Retries `429` (honouring `Retry-After`), `503`, `504`, other `5xx`, and
network errors; fails fast on other `4xx`. Throw the raw `Response` object
so the wrapper can read status + headers:

```ts
import { withRetry } from '@mushi-mushi/plugin-sdk'

const json = await withRetry(async () => {
  const res = await fetch(url, { method: 'POST', body })
  if (!res.ok) throw res                    // expose status + Retry-After
  return res.json()
}, { maxAttempts: 4, idempotencyKey: deliveryId })
```

### `assertFields(payload, required)` / `safeParseInbound(payload, required)`

Two type-narrowing guards for inbound webhook payloads. `assertFields`
throws `TypeError`; `safeParseInbound` returns `{ ok, data | error }` for
use at I/O boundaries.

## Marketplace

The console's **Marketplace** page lists only reviewed plugins. Mushi sends
events to a plugin once it is installed there with your server's public
HTTPS URL and a signing secret. To get a listing, submit it with
`POST /v1/marketplace/submissions`; a reviewer checks the manifest, the
callback URL and the requested permissions.

## Reference plugins

The Mushi monorepo ships open-source reference plugins built on this SDK;
copy and adapt them as a starting point:

**Project management / on-call**

- [`@mushi-mushi/plugin-pagerduty`](../plugin-pagerduty) — paged on critical events; auto-resolves on `fix.applied`.
- [`@mushi-mushi/plugin-jira`](../plugin-jira) — creates Jira issues and moves them when the report status changes.
- [`@mushi-mushi/plugin-linear`](../plugin-linear) — creates and updates Linear issues.
- [`@mushi-mushi/plugin-github-issues`](../plugin-github-issues) — open + close GitHub Issues with the `mushi-bug` label.

**Chat / notifications**

- [`@mushi-mushi/plugin-slack-app`](../plugin-slack-app) — `/mushi` slash command, Slack request verification, OAuth helpers.
- [`@mushi-mushi/plugin-discord`](../plugin-discord) — embed posts to a Discord webhook.
- [`@mushi-mushi/plugin-msteams`](../plugin-msteams) — Adaptive Card 1.4 notifications.

**Error monitoring (mirrored writes)**

- [`@mushi-mushi/plugin-sentry`](../plugin-sentry) — mirror reports into Sentry; resolve on fix.
- [`@mushi-mushi/plugin-bugsnag`](../plugin-bugsnag) — Bugsnag Data API v2 mirror.
- [`@mushi-mushi/plugin-rollbar`](../plugin-rollbar) — Rollbar item mirror + auto-resolve.
- [`@mushi-mushi/plugin-crashlytics`](../plugin-crashlytics) — sets a Remote Config `mushi_resolved_*` flag on fix.

**Workflow**

- [`@mushi-mushi/plugin-zapier`](../plugin-zapier) — fan-out to any Zapier workflow via incoming webhook.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 527 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
