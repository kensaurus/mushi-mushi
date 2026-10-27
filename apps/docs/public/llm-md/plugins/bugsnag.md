# Bugsnag

Source: https://kensaur.us/mushi-mushi/docs/plugins/bugsnag

---
title: Bugsnag
description: Copy triaged Mushi bug reports into Bugsnag and mark the error fixed when Mushi applies a fix — a self-hosted plugin with a Data API token.
---

# Bugsnag plugin

Copies each bug Mushi triages into Bugsnag as an error, and marks it `fixed`
when Mushi applies a fix.

**Not in the Mushi Cloud Marketplace yet.** The console has no Bugsnag
listing, so you can't install it from there. On a Mushi server you run
yourself, add a `plugin_registry` row for it and install it like any listed
plugin.
To bring Bugsnag errors *into* Mushi, use `@mushi-mushi/adapters` instead.

## Setup (self-hosted Mushi)

```bash
npm i @mushi-mushi/plugin-bugsnag
export MUSHI_PLUGIN_SECRET=...      # the signing secret set when the plugin is installed
export BUGSNAG_API_KEY=...          # Bugsnag Data API token
export BUGSNAG_PROJECT_SLUG=...     # from your Bugsnag project URL
export ADMIN_BASE_URL=https://...   # optional: console URL for report links
npx -p @mushi-mushi/plugin-bugsnag mushi-plugin-bugsnag
```

Point the plugin's webhook URL at `https://<your-host>/mushi/webhook`.

## Package

[`@mushi-mushi/plugin-bugsnag`](https://www.npmjs.com/package/@mushi-mushi/plugin-bugsnag)

## Events

| Event | Action |
| --- | --- |
| `report.classified` | Create a Bugsnag error (grouping hash `mushi--`) with a link back to the report |
| `fix.applied` | Set the error's status to `fixed` |
