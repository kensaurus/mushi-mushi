# `@mushi-mushi/plugin-rollbar`

> **Your AI wrote it. Mushi tells you why it broke.**

Copies each bug Mushi triages into Rollbar as an item, so user reports sit
next to your Rollbar errors, and resolves that item when Mushi applies a fix.

**Status on Mushi Cloud:** the console's **Marketplace** has no Rollbar
listing (checked 2026-10-26), so Mushi Cloud cannot send this plugin events
yet. It works with a Mushi server you run yourself once you add a
`plugin_registry` row for it. Getting Rollbar errors *into* Mushi is the
separate `@mushi-mushi/adapters` package.

```bash
npm i @mushi-mushi/plugin-rollbar
export MUSHI_PLUGIN_SECRET=...      # the signing secret set when the plugin is installed
export ROLLBAR_ACCESS_TOKEN=...     # Rollbar project access token with post_server_item (or write) scope
export ROLLBAR_PROJECT_ID=...       # Rollbar project id (required by the server)
export ADMIN_BASE_URL=https://...   # optional: Mushi console URL, for report links
npx -p @mushi-mushi/plugin-rollbar mushi-plugin-rollbar   # POST /mushi/webhook on PORT (default 3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/rollbar

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-rollbar @mushi-mushi/plugin-sdk express
```

```ts
import { createRollbarPlugin } from '@mushi-mushi/plugin-rollbar'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createRollbarPlugin({
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN!,
  projectId: process.env.ROLLBAR_PROJECT_ID!,
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` → `POST /api/1/item/` to create an Item.
- `fix.applied` → `PATCH /api/1/item/{id}` with `status: resolved`.

## Notes

- Outbound calls retry transient `429`/`5xx` via `withRetry` from
  `@mushi-mushi/plugin-sdk`.
- The report → item mapping is kept in memory by default, so after a restart
  `fix.applied` cannot find the item. Pass your own cache as the second
  argument to `createRollbarPlugin` to keep it.
- Auth header is `X-Rollbar-Access-Token` per Rollbar's REST API spec.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 76 edge functions · 507 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
