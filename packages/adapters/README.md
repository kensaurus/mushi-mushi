# `@mushi-mushi/adapters`

> **Your AI wrote it. Mushi tells you why it broke.**

Inbound event adapters (Sentry, Datadog, …).


Inbound webhook translators that turn third-party observability events into
Mushi Mushi reports. Use these when you want production monitors (Sentry,
Datadog, CloudWatch, …) and crash reports (Bugsnag, Rollbar, Crashlytics) to
land in the same triage + fix pipeline as your user-filed bugs.

## Install

```bash
npm i @mushi-mushi/adapters
```

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
so you can route the result to any sink — the hosted Mushi API, a queue, a
local database, a fan-out of several. Subpath imports are supported, e.g.
`@mushi-mushi/adapters/cloudwatch`.

## Quick start — Datadog → Hono

```ts
import { Hono } from 'hono';
import { createDatadogWebhookHandler } from '@mushi-mushi/adapters';
import { MushiNodeClient } from '@mushi-mushi/node';

const mushi = new MushiNodeClient({
  apiKey: process.env.MUSHI_API_KEY!,
  projectId: process.env.MUSHI_PROJECT_ID!,
});

const handler = createDatadogWebhookHandler({
  secret: process.env.DATADOG_WEBHOOK_SECRET!,
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
app.post('/webhooks/datadog', async (c) => {
  const raw = await c.req.text();
  const res = await handler({
    rawBody: raw,
    headers: Object.fromEntries(c.req.raw.headers),
  });
  return c.json(res.body ?? {}, res.status);
});
```

## Severity mapping

Each adapter maps the source's native severity onto Mushi's four-level scale:

| Mushi      | Datadog | New Relic | Honeycomb | Grafana/AM |
| ---------- | ------- | --------- | --------- | ---------- |
| `critical` | P1      | critical  | critical  | critical   |
| `high`     | P2      | high      | warning   | high       |
| `medium`   | P3      | medium    | info      | warning    |
| `low`      | P4–P5   | low       | —         | info       |

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

Tests under `src/__tests__/` cover both the happy-path and forged-signature
cases (89 tests total).

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 54 edge functions · 324 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
