# `@mushi-mushi/node`

> **Your AI wrote it. Mushi tells you why it broke.**

Server-side SDK for [Mushi Mushi](https://kensaur.us/mushi-mushi). The browser SDKs
report user-observed bugs; this package reports **server-observed** ones —
uncaught exceptions, slow requests, failed integrations — into the same
`reports` table so classification, knowledge graph, and fix dispatch don't
care whether the bug was seen by a user or the backend.

## Install

```bash
npm i @mushi-mushi/node
```

## Quick start

### Express

```ts
import express from 'express'
import { mushiExpressErrorHandler } from '@mushi-mushi/node/express'

const app = express()

// ... your routes ...

app.use(
  mushiExpressErrorHandler({
    apiKey: process.env.MUSHI_API_KEY!,
    projectId: process.env.MUSHI_PROJECT_ID!,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_SHA,
  }),
)
```

### Fastify

```ts
import Fastify from 'fastify'
import { mushiFastifyPlugin } from '@mushi-mushi/node/fastify'

const app = Fastify()
mushiFastifyPlugin(app, {
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})
```

### Hono (Node / Edge)

```ts
import { Hono } from 'hono'
import { mushiHonoErrorHandler } from '@mushi-mushi/node/hono'

const app = new Hono()
app.onError(
  mushiHonoErrorHandler({
    apiKey: process.env.MUSHI_API_KEY!,
    projectId: process.env.MUSHI_PROJECT_ID!,
  }),
)
```

### Manual capture

Use the client directly when you want to report outside the request cycle
(cron jobs, queue workers, integration failures):

```ts
import { MushiNodeClient } from '@mushi-mushi/node'

const mushi = new MushiNodeClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
  environment: 'production',
  release: process.env.GIT_SHA,
})

await mushi.captureReport({
  description: 'Stripe webhook signature verification failed',
  severity: 'high',
  component: 'billing',
  metadata: { event: 'invoice.payment_failed' },
})
```

### Process-level fallbacks

Attach `uncaughtException` + `unhandledRejection` hooks so nothing escapes:

```ts
import { attachUnhandledHook } from '@mushi-mushi/node'

attachUnhandledHook({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})
```

## Reward webhook receiver

When a reporter crosses a reward tier (or earns points) in the Mushi console,
Mushi sends a signed webhook to your app. `createMushiRewardsHandler` is a
framework-agnostic receiver that **timing-safely verifies** the
`X-Mushi-Signature` HMAC and routes events to typed callbacks — this is where
you grant a role, unlock Pro, or apply a Stripe coupon.

```ts
import { createMushiRewardsHandler } from '@mushi-mushi/node'

const handler = createMushiRewardsHandler({
  // The mushi_whk_… secret shown once when you created the webhook in the console.
  secret: process.env.MUSHI_REWARD_WEBHOOK_SECRET!,

  onTierChanged: async (event) => {
    // Flat payload. host_credit_payload is the opaque "grant this" instruction
    // you defined on the tier in the console.
    if (event.host_credit_payload?.kind === 'pro_coupon') {
      await grantProAccess(event.external_user_id)
    }
  },

  onPointsAwarded: async (event) => {
    // Fires on reward.points_awarded (e.g. report.submitted / report.triaged).
  },

  // onEvent: async (event) => { … }  // catch-all, runs after the specific cb
})
```

### Next.js App Router / any Web-standard runtime

```ts
// app/api/mushi/reward-webhook/route.ts
export const POST = (req: Request) => handler.fetch(req)
```

### Express / Connect

`express.raw()` is **required** — the raw body must be available for HMAC
verification (a re-stringified parsed body can fail verification on key-order
differences):

```ts
app.post('/api/mushi/reward-webhook', express.raw({ type: '*/*' }), handler.express)
```

### API

| Export | Purpose |
|---|---|
| `createMushiRewardsHandler(opts)` | Returns `{ express, fetch }` adapters. A bad signature short-circuits with `401` before your callbacks run. |
| `verifyRewardSignature(rawBody, signature, secret)` | Standalone timing-safe `sha256=<hex>` check if you want to handle routing yourself. |
| `parseRewardEvent(rawBody)` | Parse a verified raw body into a typed `MushiRewardEvent` (throws on bad JSON). |

**Options:** `secret` (required), `onTierChanged`, `onPointsAwarded`, `onEvent`,
`signatureHeader` (default `x-mushi-signature`).

**Event types:** `MushiRewardEvent` (flat envelope: `event`, `end_user_id`,
`external_user_id?`, `occurred_at`), `MushiTierChangedEvent`
(`host_credit_payload`, `tier_slug`/`tier_after`), `MushiPointsAwardedEvent`
(`action`, `points`, `total_points`). Full economy reference:
[`docs/REWARDS.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/REWARDS.md).

## Distributed tracing

Middleware automatically reads incoming `traceparent` (W3C Trace Context) and
`sentry-trace` headers and stamps `traceId` / `spanId` on the report. This
lets the Mushi knowledge graph correlate a server-side failure with the
browser-side report a user filed from the same HTTP request, even across
microservices.

## Safety guarantees

- `captureReport` **never throws** — failures are swallowed and warn-logged
  once per process. Instrumentation can never take down the host.
- Requests use a 10-second `AbortController` timeout by default.
- No PII scrubbing runs on the server — scrub before calling the SDK if your
  payloads contain user data.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 51 edge functions · 298 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
