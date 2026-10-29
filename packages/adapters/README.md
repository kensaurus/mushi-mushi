# `@mushi-mushi/adapters`

> **Your AI wrote it. Mushi tells you why it broke.**

Already send errors to Sentry, Crashlytics, Bugsnag or Rollbar? These webhook
handlers forward them into [Mushi Mushi](https://github.com/kensaurus/mushi-mushi),
so a crash lands in the same queue as your users' bug reports and gets the same
plain-English diagnosis and ready fix. You do not need any of these tools to use
Mushi Mushi; this package is only for when you already have one.

**Do you need this package?** Not for Sentry on Mushi Mushi Cloud: open
**Integrations → Sentry** in the console, paste your Sentry internal
integration's Client Secret, and Sentry alerts go straight into the queue
([how](https://kensaur.us/mushi-mushi/docs/plugins/sentry#route-sentry-errors-into-mushi-mushi-inbound)).
The other sources have no built-in receiver. For those you run one of these
handlers on your own server and pass each event on, for example with
`@mushi-mushi/node` and a project API key.

## Quick start: Sentry to Hono

```bash
npm i @mushi-mushi/adapters @mushi-mushi/node
```

```ts
import { Hono } from 'hono';
import { createSentryAdapter } from '@mushi-mushi/adapters/sentry';
import { MushiNodeClient } from '@mushi-mushi/node';

const mushi = new MushiNodeClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
});

const handler = createSentryAdapter({
  secret: process.env.SENTRY_WEBHOOK_SECRET!, // the secret in your Sentry webhook settings
  sink: async (event) => {
    await mushi.captureReport({
      description: event.description,
      severity: event.severity,
      component: event.component,
      metadata: { ...event.metadata, source: event.source, tags: event.tags },
    });
  },
});

const app = new Hono();
app.post('/webhooks/sentry', async (c) => {
  const res = await handler({
    rawBody: await c.req.text(),
    headers: Object.fromEntries(c.req.raw.headers),
  });
  return Response.json(res.body ?? {}, { status: res.status });
});
```

Every other source has the same shape: a `create…` handler that checks the
source's signature or secret, then calls your `sink`. Docs:
[adapters reference](https://kensaur.us/mushi-mushi/docs/sdks/adapters)

## Supported sources

| Source                 | Translator                   | Webhook handler                   |
| ---------------------- | ---------------------------- | --------------------------------- |
| Sentry                 | `translateSentry`            | `createSentryAdapter`             |
| Bugsnag                | `translateBugsnag`           | `createBugsnagAdapter`            |
| Rollbar                | `translateRollbar`           | `createRollbarAdapter`            |
| Crashlytics (Firebase) | `translateCrashlytics`       | `createCrashlyticsAdapter`        |
| Firebase Analytics     | `translateFirebaseAnalytics` | `createFirebaseAnalyticsAdapter`  |
| AWS CloudWatch (SNS)   | `translateCloudWatch`        | `createCloudWatchAdapter`         |
| Opsgenie               | `translateOpsGenie`          | `createOpsGenieAdapter`           |
| Datadog                | `translateDatadog`           | `createDatadogWebhookHandler`     |
| New Relic              | `translateNewRelic`          | `createNewRelicWebhookHandler`    |
| Honeycomb              | `translateHoneycomb`         | `createHoneycombWebhookHandler`   |
| Grafana / Loki (AM)    | `translateGrafanaLoki`       | `createGrafanaLokiWebhookHandler` |

Every translator outputs `MushiCaptureEventInput` (from `@mushi-mushi/core`)
so you can send the result anywhere: the hosted Mushi Mushi API, a queue, a
local database, or several of these at once. Subpath imports are supported, e.g.
`@mushi-mushi/adapters/cloudwatch`.

## Severity mapping

Each adapter maps the source's native severity onto Mushi's four-level scale:

| Mushi      | Sentry (`level`) | Datadog | New Relic (`priority`) | Honeycomb (contains) | Grafana/AM       |
| ---------- | ---------------- | ------- | ---------------------- | -------------------- | ---------------- |
| `critical` | fatal            | P1      | critical               | critical             | critical, page   |
| `high`     | error            | P2      | high                   | high, error          | high, error      |
| `medium`   | warning          | P3      | warning, medium        | warn                 | warning, warn    |
| `low`      | info, debug      | P4–P5   | low                    | info                 | info, low        |

A Sentry metric alert maps to `high` when it opens and carries no severity when it resolves.

## Authentication

Each adapter uses the strongest auth its upstream supports:

| Adapter             | Method                        | Header                    |
| ------------------- | ----------------------------- | ------------------------- |
| Sentry              | shared secret (timing-safe)   | `sentry-hook-secret`      |
| Bugsnag             | HMAC-SHA256 (hex)             | `X-Bugsnag-Signature`     |
| Rollbar             | shared token (timing-safe)    | `X-Rollbar-Access-Token`  |
| Crashlytics         | Firebase ID Token JWT (`aud`) | `X-Firebase-ID-Token`     |
| Firebase Analytics  | Google OIDC bearer (`aud`)    | `Authorization: Bearer …` |
| CloudWatch (SNS)    | RSA-SHA1 / SHA256 cert verify | `x-amz-sns-message-type`  |
| Opsgenie            | HMAC-SHA256 (base64)          | `X-OG-Signature`          |
| Datadog             | shared secret (timing-safe)   | `x-datadog-secret-token`  |
| New Relic           | HMAC-SHA256 (hex)             | `X-NewRelic-Signature`    |
| Honeycomb           | HMAC-SHA256 (`sha256=…`)      | `X-Honeycomb-Signature`   |
| Grafana / Loki (AM) | shared token (timing-safe)    | `X-Grafana-Token`         |

Tests under `src/__tests__/` cover translation and the rejection of a wrong
signature or secret for all eleven sources.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
