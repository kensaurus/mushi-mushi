# `@mushi-mushi/plugin-jira`

> **Your AI wrote it. Mushi tells you why it broke.**

Opens a Jira Cloud issue for each new Mushi bug report, moves it through
your Jira workflow as the report changes status, and comments when the fix
lands. It is a library: you write the small server around it.

**Do you need this package?** Not on Mushi Cloud: add Jira on the
**Integrations** page of the console (base URL, email, API token, project
key) and Mushi opens and resolves Jira issues itself. The console's
Marketplace has no Jira listing (checked 2026-10-26), so this package only
receives events from a Mushi server you run yourself, once you add a
`plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-jira @mushi-mushi/plugin-sdk express
```

You need Jira OAuth tokens first (below), then mount
`createJiraPluginHandler` on `POST /mushi/webhook`
([example](#wire-up-the-webhook-handler)).

Docs: https://kensaur.us/mushi-mushi/docs/plugins/jira

## OAuth setup (one-time per tenant)

1. Create a Jira Cloud OAuth 2.0 (3LO) app at
   [developer.atlassian.com](https://developer.atlassian.com/console/myapps/).
2. Enable the `read:jira-work`, `write:jira-work`, and `offline_access` scopes.
3. Set the callback URL to `https://<your-plugin-host>/oauth/jira/callback`.
4. Stash the client ID + secret as env vars.

```ts
import { buildAuthorizeUrl, exchangeCode, refreshTokens } from '@mushi-mushi/plugin-jira'

const config = {
  clientId: process.env.JIRA_CLIENT_ID!,
  clientSecret: process.env.JIRA_CLIENT_SECRET!,
  redirectUri: process.env.JIRA_REDIRECT_URI!,
  scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
}

// 1. Redirect the user to Jira to authorize.
const { url, state, codeVerifier } = buildAuthorizeUrl(config, projectId)

// 2. On callback, exchange `code` for tokens and store them.
const tokens = await exchangeCode(config, code, codeVerifier)
```

Tokens are short-lived — call `refreshTokens(config, tokens.refreshToken)`
before expiry, or persist the mapping and refresh lazily on 401. The refresh
result leaves `cloudId` and `cloudUrl` empty (they never change), so merge it
onto the stored record instead of replacing it:

```ts
const refreshed = await refreshTokens(config, stored.refreshToken)
const tokens = { ...stored, ...refreshed, cloudId: stored.cloudId, cloudUrl: stored.cloudUrl }
```

## Wire up the webhook handler

```ts
import express from 'express'
import { createJiraPluginHandler } from '@mushi-mushi/plugin-jira'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createJiraPluginHandler({
  secret: process.env.MUSHI_PLUGIN_SECRET!,
  tokens: loadTokensForTenant(),      // you persist these after OAuth
  jiraProjectKey: 'BUG',
  statusToTransition: {
    pending: 'To Do',
    fixing: 'In Progress',
    fixed: 'Done',
  },
})

const app = express()
app.post('/mushi/webhook', expressMiddleware(handler))
```

## Subscribed events

| Event                     | Effect on Jira                                                     |
| ------------------------- | ------------------------------------------------------------------ |
| `report.created`          | Creates a Jira issue under `jiraProjectKey` with mushi labels.     |
| `report.status_changed`   | Transitions the issue via `statusToTransition` map.                |
| `fix.applied`             | Adds a comment linking the GitHub PR (or fix summary).             |

Other Mushi events are ignored.

The report → issue key map lives in memory. After a restart,
`report.status_changed` and `fix.applied` for reports created before it do
nothing. Jira → Mushi sync (closing the Mushi report from Jira) is not part
of this package's exports.

## Status mapping defaults

| Mushi status   | Jira transition   |
| -------------- | ----------------- |
| `pending`      | `To Do`           |
| `classified`   | `To Do`           |
| `grouped`      | `To Do`           |
| `fixing`       | `In Progress`     |
| `fixed`        | `Done`            |
| `dismissed`    | `Done`            |

Override any mapping via the `statusToTransition` option.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 510 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
