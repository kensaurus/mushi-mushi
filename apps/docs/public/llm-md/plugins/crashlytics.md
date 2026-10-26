# Crashlytics

Source: https://kensaur.us/mushi-mushi/docs/plugins/crashlytics

---
title: Crashlytics
description: Flag fixed Mushi reports in Firebase Remote Config so your mobile app can hide stale crash notices — a self-hosted plugin with a Google access token.
---

# Crashlytics plugin

When Mushi applies a fix, writes a `mushi_resolved_` flag to your
Firebase Remote Config, which your mobile app can read to stop showing a
stale crash notice. It does not create Crashlytics issues.

**Not available on Mushi Cloud yet.** The console's Marketplace has no
Crashlytics listing, so Mushi Cloud cannot send this plugin events. It works
with a Mushi server you run yourself once you add a `plugin_registry` row for
it. To bring Crashlytics crashes *into* Mushi, use `@mushi-mushi/adapters`.

## Setup (self-hosted Mushi)

```bash
npm i @mushi-mushi/plugin-crashlytics
export MUSHI_PLUGIN_SECRET=...   # the signing secret set when the plugin is installed
export GCP_ACCESS_TOKEN=...      # OAuth2 access token, firebase + cloud-platform scopes
export FIREBASE_PROJECT_ID=...
export FIREBASE_APP_ID=...       # e.g. 1:123456789012:android:abcdef
npx -p @mushi-mushi/plugin-crashlytics mushi-plugin-crashlytics
```

The plugin takes a ready access token and does not refresh it (tokens last
about an hour). Point the plugin's webhook URL at
`https://<your-host>/mushi/webhook`.

## Package

[`@mushi-mushi/plugin-crashlytics`](https://www.npmjs.com/package/@mushi-mushi/plugin-crashlytics)

## Events

| Event | Action |
| --- | --- |
| `fix.applied` | Set Remote Config `mushi_resolved_` to `"true"`; close the Crashlytics issue only if the event carries `crashlyticsIssueId` (Mushi does not send it today) |
