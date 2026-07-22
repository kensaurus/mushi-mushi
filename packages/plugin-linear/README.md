# `@mushi-mushi/plugin-linear`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


Reference Mushi Mushi plugin: create and bidirectionally sync Linear issues
from Mushi reports.

## Install

```bash
npm i @mushi-mushi/plugin-linear
```

## Run as a stand-alone server

```bash
LINEAR_API_KEY=lin_...
LINEAR_TEAM_ID=team-uuid
MUSHI_PLUGIN_SECRET=...
MUSHI_API_KEY=...           # optional; required only for back-comments
PORT=3000
npx mushi-plugin-linear
```

## Subscribed events

- `report.created` — creates a Linear issue and stashes the mapping.
- `report.classified` — updates the issue title/description with the
  classifier output.
- `report.status_changed` — moves the issue to the configured workflow
  state via `stateMap` (optional).

## Caching

The default cache is in-memory. For production, replace it with Redis or
your DB to survive restarts:

```ts
const plugin = createLinearPlugin(cfg, {
  get: (id) => redis.get(`mushi:linear:${id}`),
  set: (id, issueId) => redis.set(`mushi:linear:${id}`, issueId),
})
```

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 327 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
