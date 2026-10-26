# `@mushi-mushi/plugin-bugsnag`

> **Your AI wrote it. Mushi tells you why it broke.**

Copies each bug Mushi triages into Bugsnag as an error, so user reports sit
next to your Bugsnag crashes, and marks it `fixed` when Mushi applies a fix.

**Status on Mushi Cloud:** the console's **Marketplace** has no Bugsnag
listing yet (checked 2026-10-26), so you can't install it from the console.
On a Mushi server you run yourself, add a `plugin_registry` row for it and
install it like any listed plugin. Getting Bugsnag errors *into* Mushi is the
separate `@mushi-mushi/adapters` package.

```bash
npm i @mushi-mushi/plugin-bugsnag
export MUSHI_PLUGIN_SECRET=...      # the signing secret set when the plugin is installed
export BUGSNAG_API_KEY=...          # Bugsnag Data API token
export BUGSNAG_PROJECT_SLUG=...     # visible in your Bugsnag project URL
export ADMIN_BASE_URL=https://...   # optional: Mushi console URL, for report links
npx -p @mushi-mushi/plugin-bugsnag mushi-plugin-bugsnag   # POST /mushi/webhook on PORT (default 3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/bugsnag

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-bugsnag @mushi-mushi/plugin-sdk express
```

```ts
import { createBugsnagPlugin } from '@mushi-mushi/plugin-bugsnag'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createBugsnagPlugin({
  apiKey: process.env.BUGSNAG_API_KEY!,
  projectSlug: process.env.BUGSNAG_PROJECT_SLUG!,
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` → `POST /v2/projects/{slug}/errors` (deterministic
  `groupingHash` keeps user-reported issues grouped in the Bugsnag dashboard).
- `fix.applied` → `PATCH /v2/projects/{slug}/errors/{errorId}` with
  `status: fixed`.

## Notes

- Outbound calls are wrapped in `withRetry` from `@mushi-mushi/plugin-sdk`
  (honours `Retry-After` on 429).
- The default error-id cache is in-memory, so after a restart `fix.applied`
  cannot find the error. Pass your own cache (`{ get, set }`) as the second
  argument to `createBugsnagPlugin` to keep it.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 76 edge functions · 508 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
