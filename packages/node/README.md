# `@mushi-mushi/node`

Server-side SDK for [Mushi Mushi](https://mushimushi.dev). The browser SDKs
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
