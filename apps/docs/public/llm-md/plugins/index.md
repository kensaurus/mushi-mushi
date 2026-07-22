# index

Source: https://kensaur.us/mushi-mushi/docs/plugins

# Plugin marketplace

Mushi events flow out as **HMAC-signed JSON webhooks** with [Standard Webhooks](https://www.standardwebhooks.com/) headers (`webhook-id` / `webhook-timestamp` / `webhook-signature: v1,…`) to any tool you wire up. The marketplace ships **12 first-party plugins** and lets you build your own with `@mushi-mushi/plugin-sdk` (retry helpers, signature verification, REST callback in one tiny package).

## Available plugins

| Plugin              | Triggers                                                           | Doc |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| **PagerDuty**       | `report.created` (P0/P1)                                           | [PagerDuty](/plugins/pagerduty) |
| **Linear**          | `report.classified`                                                | [Linear](/plugins/linear) |
| **Jira Cloud**      | `report.classified` + status sync                                  | [Jira Cloud](/plugins/jira) |
| **Slack app**       | `report.created` / `fix.pr_opened` + `/mushi` slash command        | [Slack](/plugins/slack) |
| **Discord**         | Configurable per-event embeds                                      | [Discord](/plugins/discord) |
| **Microsoft Teams** | Adaptive cards on classified reports                               | [Teams](/plugins/msteams) |
| **GitHub Issues**   | `report.classified` → labelled issue with Mushi backlink           | [GitHub Issues](/plugins/github-issues) |
| **Sentry**          | Mirror critical reports + resolve on fix                           | [Sentry](/plugins/sentry) |
| **Bugsnag**         | Mirror reports into Bugsnag projects + close on fix merge          | [Bugsnag](/plugins/bugsnag) |
| **Rollbar**         | Mirror reports + resolve Rollbar items on fix                      | [Rollbar](/plugins/rollbar) |
| **Crashlytics**     | Push Mushi reports into Firebase Crashlytics issues + close on fix | [Crashlytics](/plugins/crashlytics) |
| **Zapier**          | All events                                                         | [Zapier](/plugins/zapier) |

Browse and install from the admin console: **Marketplace**. Each plugin enforces strict scope — it only sees the events you subscribe it to.

## Webhook delivery contract

Every dispatch is:

- **POST** to your configured webhook URL with `Content-Type: application/json`.
- Body: `{ event, deliveryId, occurredAt, projectId, pluginSlug, data }`.
- **Standard Webhooks headers** ([standardwebhooks.com](https://www.standardwebhooks.com/)) — receivers can use any spec-compliant library to verify:
  - `webhook-id: `
  - `webhook-timestamp: <unix-secs>`
  - `webhook-signature: v1,<base64-hmac-sha256>` over `${id}.${ts}.${rawBody}`
- Legacy `X-Mushi-*` headers are also emitted for back-compat with first-generation receivers.
- Retried with exponential backoff on 5xx / network errors (3 attempts: 0 / 30 / 120s).
- Logged to `plugin_dispatch_log` with status, HTTP code, latency, and response excerpt — visible in **Marketplace → plugin → Deliveries**.

## Build your own

See [Building a plugin](/plugins/building) and [Webhook events](/plugins/events).

The `@mushi-mushi/plugin-sdk` exports `verifyStandardWebhook(headers, rawBody, secret)` and `withRetry(fn)` so a production-ready receiver is ~20 lines of code.
