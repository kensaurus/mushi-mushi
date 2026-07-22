# Plugin marketplace

Source: https://kensaur.us/mushi-mushi/docs/admin/marketplace

---
title: Plugin marketplace
---

# Plugin marketplace

**Route:** `/marketplace`

The marketplace lets you install outbound plugins — PagerDuty, Linear, Zapier, and
others — that receive webhook events from Mushi when reports are classified, fixes are
deployed, or tiers are triggered.

The `plugins` entitlement is required to install plugins. An upgrade prompt appears if
it isn't active on your plan.

---

## Sections

### Available plugins

A card grid showing all plugins in the catalogue. Each card shows:
- Plugin name, publisher, category, short description, version
- **Install status** — installed badge if already active
- **Reliability stats** — total dispatches, ok rate, avg latency (from the dispatch log)

Use the **text search**, **category filter**, and **Installed only** toggle to narrow
the list.

### Installed

The installed plugins list with per-plugin controls (see Actions below).

### Recent deliveries

A dispatch log table showing the most recent outbound webhook calls. Filterable by
**plugin slug** and **status** (`ok`, `error`, `timeout`). Use this to debug delivery
problems or confirm an event fired.

---

## Installing a plugin

1. Find the plugin in the Available section.
2. Click **Install**.
3. Fill in the install form:
   - **Webhook URL** — your endpoint that receives events
   - **Signing secret** — auto-generated; verify the `X-Mushi-Signature` header in your handler
   - **Subscribed events** — select which event types to receive
4. Click **Install**.

---

## Managing installed plugins

| Action | Description |
|--------|-------------|
| **Test** | Fires a test webhook event to confirm delivery |
| **Pause / Resume** | Toggle `isActive` — paused plugins skip dispatch |
| **Edit URL** | Update the webhook URL without reinstalling |
| **Rotate secret** | Generate a new signing secret |
| **Uninstall** | Removes the plugin (confirmation required) |

---

## Signing verification

Every outbound webhook includes an `X-Mushi-Signature` header (HMAC-SHA256 of the
request body using your signing secret). Always verify this in your handler before
processing events:

```ts

function verify(body: string, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

---

## First-party plugins

### Cursor Cloud Agent

The **Cursor Cloud Agent** plugin (`cursor-cloud-agent`) is a first-party Mushi plugin that dispatches a Cursor Cloud Agent when qualifying events fire. The agent opens a signed draft PR on your GitHub repo automatically — no manual review needed.

**Subscribes to:** `report.classified` · `fix.requested` · `qa_story.failed` · `skill_pipeline.step.dispatched`

**Configure after installing:**
| Field | Description |
|-------|-------------|
| **API Key** | Your Cursor API key |
| **Workspace ID** | Your Cursor workspace ID (`ws_…`) |
| **Model** | `composer-2.5` (default) or `composer-latest` |
| **Auto-create PRs** | Toggle — enabled by default |
| **Max iterations** | Agent loop budget (default: 1) |

Unlike standard webhook plugins, the Cursor Cloud Agent plugin dispatches **directly to the Cursor REST API** — there's no outbound webhook URL to configure. HMAC verification for inbound events is handled internally by the Mushi platform.

The dispatch result (agent ID, run ID, PR URL) is visible in [Fixes](/admin/fixes) under the Cursor badge.

---

## Building a plugin

See [Plugins → Building a plugin](/plugins/building) for the full plugin schema,
event payload reference, and publishing guide.

---

## Related pages

- [Plugins → Building a plugin](/plugins/building) — create your own integration
- [Plugins → Events reference](/plugins/events) — full event payload schemas
- [Settings](/admin/settings) — API keys for BYOK plugin providers
