# Rollbar

Source: https://kensaur.us/mushi-mushi/docs/plugins/rollbar

---
title: Rollbar
description: Copy triaged Mushi bug reports into Rollbar items and resolve them when fixes ship — a self-hosted plugin with an access token and project id.
---

# Rollbar plugin

Copies each bug Mushi triages into Rollbar as an item, and resolves the item
when Mushi applies a fix.

**Not available on Mushi Cloud yet.** The console's Marketplace has no
Rollbar listing, so Mushi Cloud cannot send this plugin events. It works with
a Mushi server you run yourself once you add a `plugin_registry` row for it.
To bring Rollbar errors *into* Mushi, use `@mushi-mushi/adapters` instead.

## Setup (self-hosted Mushi)

```bash
npm i @mushi-mushi/plugin-rollbar
export MUSHI_PLUGIN_SECRET=...      # the signing secret set when the plugin is installed
export ROLLBAR_ACCESS_TOKEN=...     # project access token with post_server_item (or write) scope
export ROLLBAR_PROJECT_ID=...       # required by the server
export ADMIN_BASE_URL=https://...   # optional: console URL for report links
npx -p @mushi-mushi/plugin-rollbar mushi-plugin-rollbar
```

Point the plugin's webhook URL at `https://<your-host>/mushi/webhook`.

## Package

[`@mushi-mushi/plugin-rollbar`](https://www.npmjs.com/package/@mushi-mushi/plugin-rollbar)

## Events

| Event | Action |
| --- | --- |
| `report.classified` | Create a Rollbar item (environment `production`, level from severity, fingerprint `mushi--`) |
| `fix.applied` | Resolve the item |
