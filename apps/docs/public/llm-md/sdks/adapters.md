# @mushi-mushi/adapters

Source: https://kensaur.us/mushi-mushi/docs/sdks/adapters

---
title: '@mushi-mushi/adapters'
description: Turn Sentry, Datadog, Bugsnag and other monitoring webhooks into Mushi reports with @mushi-mushi/adapters, deduped against the same queue as user reports.
---

# `@mushi-mushi/adapters`

Already send errors to Sentry, Crashlytics, Bugsnag or Rollbar? These webhook handlers forward them into Mushi, so a crash lands in the same queue as your users' bug reports and gets the same plain-English diagnosis and ready fix. You do not need any of these tools to use Mushi; this package is only for when you already have one.

## Install

```bash
pnpm add @mushi-mushi/adapters
```

## Eleven supported sources

| Source                        | Translator                   | Webhook handler                   |
| ----------------------------- | ---------------------------- | --------------------------------- |
| Sentry                        | `translateSentry`            | `createSentryAdapter`             |
| Datadog                       | `translateDatadog`           | `createDatadogWebhookHandler`     |
| Bugsnag                       | `translateBugsnag`           | `createBugsnagAdapter`            |
| Rollbar                       | `translateRollbar`           | `createRollbarAdapter`            |
| Firebase Crashlytics          | `translateCrashlytics`       | `createCrashlyticsAdapter`        |
| Firebase Analytics            | `translateFirebaseAnalytics` | `createFirebaseAnalyticsAdapter`  |
| New Relic                     | `translateNewRelic`          | `createNewRelicWebhookHandler`    |
| Honeycomb                     | `translateHoneycomb`         | `createHoneycombWebhookHandler`   |
| Grafana / Loki (Alertmanager) | `translateGrafanaLoki`       | `createGrafanaLokiWebhookHandler` |
| AWS CloudWatch (via SNS)      | `translateCloudWatch`        | `createCloudWatchAdapter`         |
| Opsgenie                      | `translateOpsGenie`          | `createOpsGenieAdapter`           |

Every translator returns a `MushiCaptureEventInput` (from `@mushi-mushi/core`) so you can route the result to any sink — the hosted Mushi API, a queue, your own database, a fan-out of several. Subpath imports are supported, e.g. `@mushi-mushi/adapters/cloudwatch`.

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
  return Response.json(res.body ?? {}, { status: res.status });
});
```

## Severity mapping

Each adapter normalises the source's native severity onto Mushi's four-level scale.

| Mushi      | Sentry (`level`) | Datadog | New Relic (`priority`) | Honeycomb (contains) | Grafana / AM   |
| ---------- | ---------------- | ------- | ---------------------- | -------------------- | -------------- |
| `critical` | fatal            | P1      | critical               | critical             | critical, page |
| `high`     | error            | P2      | —                      | high, error          | high, error    |
| `medium`   | warning          | P3      | warning                | warn                 | warning, warn  |
| `low`      | info, debug      | P4–P5   | —                      | info                 | info, low      |

The other crash-tracker adapters (Bugsnag / Rollbar / Crashlytics) map their `level` / `severity` field directly; Opsgenie / CloudWatch / Firebase Analytics derive severity from the upstream alarm state.

## Authentication

Every adapter uses the strongest auth its upstream supports — never a shared bearer where a real signature exists.

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

Unit tests cover translation and forged-signature rejection for Sentry, Bugsnag, Rollbar, Crashlytics, Firebase Analytics, CloudWatch and Opsgenie; Datadog, New Relic, Honeycomb and Grafana have none yet. Run them with `pnpm --filter @mushi-mushi/adapters test`.
