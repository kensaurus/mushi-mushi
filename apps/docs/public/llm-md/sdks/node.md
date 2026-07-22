# @mushi-mushi/node

Source: https://kensaur.us/mushi-mushi/docs/sdks/node

---
title: '@mushi-mushi/node'
---

# `@mushi-mushi/node`

Server-side SDK for Node.js apps — forward unhandled exceptions, attach
HTTP error-handler middleware to Express / Fastify / Hono, and tag
every report with the route, request id, and user (when supplied).

## Install

```bash
pnpm add @mushi-mushi/node
```

## Express

```ts

const app = express()
// …all your routes…
app.use(
  mushiExpressErrorHandler({
    apiKey: process.env.MUSHI_API_KEY!,
    projectId: process.env.MUSHI_PROJECT_ID!,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_SHA,
  }),
) // mount LAST so it sees every other route
```

## Fastify

```ts

const app = Fastify()
mushiFastifyPlugin(app, {
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})
```

## Hono

```ts

const app = new Hono()
app.onError(
  mushiHonoErrorHandler({
    apiKey: process.env.MUSHI_API_KEY!,
    projectId: process.env.MUSHI_PROJECT_ID!,
  }),
)
```

## Process-level fallbacks

Attach `uncaughtException` + `unhandledRejection` hooks so nothing escapes:

```ts

attachUnhandledHook({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
})
```

## Programmatic submit

Use the client directly when you want to report outside the request cycle
(cron jobs, queue workers, integration failures):

```ts

const mushi = new MushiNodeClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
  environment: 'production',
  release: process.env.GIT_SHA,
})

await mushi.captureReport({
  description: 'Refund webhook returned 500',
  severity: 'high',
  component: 'billing',
  metadata: { invoiceId, attempt },
})
```

The Node SDK speaks the same wire protocol as the web SDK and shares
classification quotas — server-thrown bugs and user-side bugs land in
the same queue.
