# @mushi-mushi/adapters

Source: https://kensaur.us/mushi-mushi/docs/sdks/adapters

---
title: '@mushi-mushi/adapters'
---

# `@mushi-mushi/adapters`

Inbound webhook translators that turn third-party observability events into Mushi Mushi reports — so an alert that fires in your existing monitoring also lands in your bug queue, deduped against the same knowledge graph as your user-filed reports.

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

Each adapter normalises the source's native severity onto Mushi's four-level scale.

| Mushi      | Datadog | New Relic | Honeycomb | Grafana / AM |
| ---------- | ------- | --------- | --------- | ------------ |
| `critical` | P1      | critical  | critical  | critical     |
| `high`     | P2      | high      | warning   | high         |
| `medium`   | P3      | medium    | info      | warning      |
| `low`      | P4–P5   | low       | —         | info         |

Crash-tracker adapters (Sentry / Bugsnag / Rollbar / Crashlytics) map their `level` / `severity` field directly; Opsgenie / CloudWatch / Firebase Analytics derive severity from the upstream alarm state.

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

The package ships ~90 unit tests covering both the happy-path translation and the forged-signature rejection for every adapter — run with `pnpm --filter @mushi-mushi/adapters test`.
