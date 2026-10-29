# `@mushi-mushi/plugin-linear`

> **Your AI wrote it. Mushi tells you why it broke.**

For people who plan their work in Linear. This opens a Linear issue for each
new Mushi Mushi bug report, updates it once Mushi has triaged the report, and
can move it along your Linear workflow.

**Do you need this package?** Usually not. On Mushi Mushi Cloud you connect
Linear on the **Integrations** page of the console (OAuth or an API key, on
any plan) and Mushi files and closes Linear issues itself. Run this package
only if you want the Linear calls to come from your own server. Installing
**Linear Sync** from the Marketplace needs a paid plan (Builder or above, see
[pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

```bash
npm i @mushi-mushi/plugin-linear
export MUSHI_PLUGIN_SECRET=...      # the signing secret you set when installing "Linear Sync"
export LINEAR_API_KEY=lin_api_...   # Linear personal API key
export LINEAR_TEAM_ID=...           # Linear team id
npx -p @mushi-mushi/plugin-linear mushi-plugin-linear   # POST /mushi/webhook on PORT (default 3000)
```

Then install **Linear Sync** from the console's **Marketplace** page and set
its webhook URL to `https://<your-host>/mushi/webhook`.

Docs: https://kensaur.us/mushi-mushi/docs/plugins/linear

## Subscribed events

- `report.created`: creates a Linear issue and remembers which issue belongs
  to the report.
- `report.classified`: updates the issue's title and description with the
  triage result.
- `report.status_changed`: moves the issue to the Linear workflow state in
  `stateMap[newStatus]`. This needs a `stateMap` (Mushi status → Linear
  state id), so it works only when you call `createLinearPlugin` yourself;
  the stand-alone server sets no `stateMap` and never moves issues.

`MUSHI_API_KEY` is read by the stand-alone server but nothing in it posts
back to Mushi yet. To comment on the Mushi report yourself, call
`attachMushiBackComment({ mushiApiKey, projectId })`, which returns a
`createMushiClient` client.

## Caching

The default cache is in-memory, so after a restart the next event for an
existing report opens a second issue. For production, replace it with Redis
or your DB:

```ts
import { createLinearPlugin } from '@mushi-mushi/plugin-linear'

const plugin = createLinearPlugin(cfg, {
  get: (id) => redis.get(`mushi:linear:${id}`),
  set: (id, issueId) => redis.set(`mushi:linear:${id}`, issueId),
})
```

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
