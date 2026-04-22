# `@mushi-mushi/plugin-jira`

Bidirectional sync between Mushi Mushi reports and Jira Cloud issues.
Creates issues on `report.created`, updates them on `report.classified`,
transitions status on `report.status_changed`, and comments fix summaries on
`fix.applied`.

## Install

```bash
npm i @mushi-mushi/plugin-jira
```

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
before expiry, or persist the mapping and refresh lazily on 401.

## Wire up the webhook handler

```ts
import express from 'express'
import { createJiraPluginHandler } from '@mushi-mushi/plugin-jira'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

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

Other Mushi events are ignored — add them to the `on` map to customize.

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
