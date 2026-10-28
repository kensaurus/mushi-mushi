# `@mushi-mushi/plugin-crashlytics`

> **Your AI wrote it. Mushi tells you why it broke.**

When Mushi applies a fix, writes a `mushi_resolved_<reportId>` flag to your
Firebase Remote Config, which your mobile app can read to stop showing a
stale crash notice.

**Status on Mushi Cloud:** the console's **Marketplace** has no Crashlytics
listing yet (checked 2026-10-26), so you can't install it from the console.
On a Mushi server you run yourself, add a `plugin_registry` row for it and
install it like any listed plugin. Getting Crashlytics crashes *into* Mushi is the
separate `@mushi-mushi/adapters` package.

```bash
npm i @mushi-mushi/plugin-crashlytics
export MUSHI_PLUGIN_SECRET=...   # the signing secret set when the plugin is installed
export GCP_ACCESS_TOKEN=...      # Google OAuth2 access token (firebase + cloud-platform scopes), expires in ~1 h
export FIREBASE_PROJECT_ID=...   # e.g. my-app-12345
export FIREBASE_APP_ID=...       # e.g. 1:123456789012:android:abcdef
npx -p @mushi-mushi/plugin-crashlytics mushi-plugin-crashlytics   # POST /mushi/webhook on PORT (default 3000)
```

Optional: `FIREBASE_SERVICE_ACCOUNT_EMAIL` (used in log lines) and
`ADMIN_BASE_URL`. The plugin does not refresh `GCP_ACCESS_TOKEN`; restart it
with a fresh token before the old one expires.

Docs: https://kensaur.us/mushi-mushi/docs/plugins/crashlytics

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-crashlytics @mushi-mushi/plugin-sdk express
```

```ts
import { createCrashlyticsPlugin } from '@mushi-mushi/plugin-crashlytics'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createCrashlyticsPlugin({
  accessToken: process.env.GCP_ACCESS_TOKEN!,
  projectId: process.env.FIREBASE_PROJECT_ID!,
  appId: process.env.FIREBASE_APP_ID!,
  serviceAccountEmail: process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL ?? '',
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `fix.applied` →
  - Remote Config: sets parameter `mushi_resolved_<reportId>` (dashes become
    underscores) to `"true"`, using the template ETag to avoid overwriting a
    concurrent change.
  - Crashlytics v1alpha: PATCHes the issue to `state: CLOSED`, but only when
    the event carries a `crashlyticsIssueId`. Mushi does not send that field
    today, so in practice only the Remote Config flag is written.

## Notes

- The plugin is **outbound-only**; for inbound Crashlytics → Mushi
  ingestion use the Crashlytics adapter in `@mushi-mushi/adapters`.
- Token refresh is the caller's responsibility: run the process behind a
  service-account refresher (Google ADC, IAM Workload Identity) or restart it
  with a new token.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 527 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
