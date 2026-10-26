# `@mushi-mushi/plugin-msteams`

> **Your AI wrote it. Mushi tells you why it broke.**

Posts a card to a Microsoft Teams channel when Mushi triages a bug, proposes
a fix, or applies it.

**Do you need this package?** Not on Mushi Cloud: paste a Teams incoming
webhook URL on the **Integrations** page of the console and Mushi posts to
the channel itself. The console's Marketplace has no Teams listing (checked
2026-10-26), so this package only receives events from a Mushi server you
run yourself, once you add a `plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-msteams
export MUSHI_PLUGIN_SECRET=...         # the signing secret set when the plugin is installed
export TEAMS_WEBHOOK_URL=https://...   # Teams incoming webhook URL
export ADMIN_BASE_URL=https://...      # optional: Mushi console URL, for report links
npx -p @mushi-mushi/plugin-msteams mushi-plugin-msteams   # POST /mushi/webhook on PORT (default 3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/msteams

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-msteams @mushi-mushi/plugin-sdk express
```

```ts
import { createMsteamsPlugin } from '@mushi-mushi/plugin-msteams'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createMsteamsPlugin({
  webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` — Adaptive Card with severity-coloured accent.
- `fix.proposed` — Adaptive Card with PR link if available.
- `fix.applied` — green confirmation card.

## Notes

- Adaptive Card schema version `1.4` so cards render correctly in modern
  Teams clients (desktop ≥ 1.5.x, mobile ≥ April 2024 release).
- All webhook calls retry transient `5xx` via `withRetry` from
  `@mushi-mushi/plugin-sdk`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 76 edge functions · 509 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
