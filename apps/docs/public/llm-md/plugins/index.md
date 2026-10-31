# index

Source: https://kensaur.us/mushi-mushi/docs/plugins

---
description: Send Mushi Mushi events to the tools you already use as HMAC-signed Standard Webhooks, with 13 first-party plugin packages and an SDK to build your own.
---

# Plugin marketplace

Mushi Mushi sends events out as **HMAC-signed JSON webhooks** with [Standard Webhooks](https://www.standardwebhooks.com/) headers (`webhook-id` / `webhook-timestamp` / `webhook-signature: v1,…`) to any tool you wire up. There are **13 first-party plugin packages**, and you can build your own with `@mushi-mushi/plugin-sdk` (signature checks, duplicate-delivery handling, typed events, a retry helper for your own outbound calls, and a small client for calling back into the Mushi Mushi API).

## Works with Sentry, or without it

You don't need Sentry. If you already use it, keep it: its errors land in the same list as user reports, each explained in plain English.

Bugs come in from users, monitoring tools and even your voice. Fixes and updates go out to your editor, coding agents, tracker and team chat.

## Available plugins

Six plugins are listed in the console's **Marketplace** today: PagerDuty, Linear, Sentry, Zapier, Cursor Cloud Agent and Claude Code Agent. Slack, Discord, Teams, GitHub Issues and Jira also work without a plugin, from the **Integrations** page. The other packages are for running the plugin on your own server.

| Plugin              | What it does                                                                 | In Marketplace | Doc |
| ------------------- | ---------------------------------------------------------------------------- | --- | --- |
| **Cursor Cloud Agent** | Starts a Cursor agent on critical triaged reports; no server needed       | Yes | [Cursor Cloud](/plugins/cursor-cloud) |
| **PagerDuty**       | Pages on `report.classified` at or above a severity (default critical); resolves on `fix.applied` or a report marked fixed | Yes | [PagerDuty](/plugins/pagerduty) |
| **Linear**          | `report.created` opens an issue, `report.classified` updates it              | Yes | [Linear](/plugins/linear) |
| **Sentry**          | Copies triaged reports at or above a severity (default high) into Sentry; resolves on fix | Yes | [Sentry](/plugins/sentry) |
| **Zapier**          | All events                                                                   | Yes | [Zapier](/plugins/zapier) |
| **Jira Cloud**      | `report.created` opens an issue; `report.status_changed` transitions it; comments on `fix.applied` | No  | [Jira Cloud](/plugins/jira) |
| **Slack app**       | Report cards with buttons and the `/mushi` command (built in via Integrations) | No  | [Slack](/plugins/slack) |
| **Discord**         | Embeds for `report.classified`, `fix.proposed`, `fix.applied`, `report.status_changed` | No  | [Discord](/plugins/discord) |
| **Microsoft Teams** | Adaptive cards for `report.classified`, `fix.proposed`, `fix.applied`        | No  | [Teams](/plugins/msteams) |
| **GitHub Issues**   | `report.classified` opens a labelled issue; `fix.applied` closes it          | No  | [GitHub Issues](/plugins/github-issues) |
| **Bugsnag**         | Copies triaged reports into Bugsnag; marks them fixed on `fix.applied`       | No  | [Bugsnag](/plugins/bugsnag) |
| **Rollbar**         | Copies triaged reports into Rollbar items; resolves them on `fix.applied`    | No  | [Rollbar](/plugins/rollbar) |
| **Crashlytics**     | On `fix.applied`, sets a Firebase Remote Config flag (it does not create Crashlytics issues) | No  | [Crashlytics](/plugins/crashlytics) |

Browse and install from the admin console: **Marketplace**. A plugin receives only the events in its **Subscribed events** list (empty or `*` means all).

## Webhook delivery contract

Every dispatch is:

- **POST** to your configured webhook URL with `Content-Type: application/json`.
- Body: `{ event, deliveryId, occurredAt, projectId, pluginSlug, data }`.
- **Standard Webhooks headers** ([standardwebhooks.com](https://www.standardwebhooks.com/)):
  - `webhook-id: `
  - `webhook-timestamp: <unix-secs>`
  - `webhook-signature: v1,<base64-hmac-sha256>` over `${id}.${ts}.${rawBody}`
- The HMAC key is your signing secret's raw bytes. Standard Webhooks libraries base64-decode the secret by default, so pass it raw (for example `new Webhook(secret, { format: 'raw' })` in the `standardwebhooks` npm package) or use the plugin SDK, which does this for you.
- Legacy headers are sent too: `X-Mushi-Event`, `X-Mushi-Signature: t=<unix-ms>,v1=` (HMAC-SHA256 over `${t}.${rawBody}`), `X-Mushi-Project`, `X-Mushi-Plugin`, `X-Mushi-Delivery`, and `X-Mushi-Retry-Attempt` on retries.
- Your endpoint has 8 seconds to answer. Any non-2xx answer, timeout or network error is retried: up to 5 attempts in all, about 30 s, 2 min, 10 min and 1 h apart (±20%). A retry keeps the same `webhook-id` and body, with a fresh timestamp and signature. After the fifth failure the delivery is marked `error`.
- Each delivery is logged with status, HTTP code, latency and the first 512 characters of your response, on the **Marketplace → Deliveries** tab.

## Build your own

See [Building a plugin](/plugins/building) and [Webhook events](/plugins/events).

`@mushi-mushi/plugin-sdk` exports `createPluginHandler` (checks the signature, drops duplicate deliveries and routes events to your handlers), `verifyStandardWebhooksSignature` and `verifySignature` if you want to check signatures yourself, and `withRetry` for retrying your own calls to other APIs.
