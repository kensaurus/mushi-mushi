# `@mushi-mushi/plugin-slack-app`

First-class Slack app for Mushi Mushi. Ships a `/mushi` slash command,
signing-secret verification, OAuth install flow, and a Slack App Manifest
you can drop into the Slack API console to provision the app in seconds.

> Slack's built-in **incoming webhook** path is still available via
> [`@mushi-mushi/plugin-zapier`](../plugin-zapier) for one-way
> notifications. This package is the full bidirectional app: slash
> commands, interactive buttons, and OAuth scopes for user-scoped actions.

## Install

```bash
npm i @mushi-mushi/plugin-slack-app
```

## One-time Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create from
   manifest**.
2. Paste the contents of [`manifest.json`](./manifest.json).
3. Set the **Request URL** for slash commands + interactivity to
   `https://<your-host>/slack/command`.
4. Set the **Redirect URL** for OAuth to
   `https://<your-host>/slack/oauth/callback`.
5. Copy the signing secret + client ID / secret into env vars.

## Quick start — Hono server

```ts
import { Hono } from 'hono'
import {
  verifySlackRequest,
  buildSlashRouter,
  buildInstallUrl,
  exchangeCode,
} from '@mushi-mushi/plugin-slack-app'

const app = new Hono()
const signingSecret = process.env.SLACK_SIGNING_SECRET!

const router = buildSlashRouter({
  listReports: async (projectId, limit) => mushi.listReports(projectId, limit),
  openReport:  async (id) => mushi.getReport(id),
  transitionReport: async (id, status) => mushi.transition(id, status),
  projectIdForTeam: async (teamId) => db.projectForSlackTeam(teamId),
})

app.post('/slack/command', async (c) => {
  const raw = await c.req.text()
  const verdict = verifySlackRequest({
    signingSecret,
    timestamp: c.req.header('X-Slack-Request-Timestamp') ?? '',
    signature: c.req.header('X-Slack-Signature') ?? '',
    rawBody: raw,
  })
  if (!verdict.ok) return c.json({ error: verdict.reason }, 401)

  const payload = Object.fromEntries(new URLSearchParams(raw)) as never
  return c.json(await router(payload))
})

app.get('/slack/install', (c) => {
  const state = crypto.randomUUID()
  const url = buildInstallUrl(
    {
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
      redirectUri: process.env.SLACK_REDIRECT_URI!,
      scopes: ['commands', 'chat:write', 'users:read'],
    },
    state,
  )
  return c.redirect(url)
})
```

## `/mushi` slash command

| Subcommand           | Effect                                                 |
| -------------------- | ------------------------------------------------------ |
| `/mushi list`        | 5 most recent reports for the installing team.         |
| `/mushi open <id>`   | Show classification + summary for one report.          |
| `/mushi resolve <id>`| Transition a report to `fixed`.                        |
| `/mushi help`        | Print the command reference.                           |

All responses are ephemeral (visible only to the invoking user) unless you
override `response_type` in a custom handler.

## Security

- `verifySlackRequest` runs HMAC-SHA256 over `v0:<timestamp>:<rawBody>` and
  compares in **constant time**. Reject requests older than 5 minutes to
  block replay.
- OAuth token rotation is enabled in the manifest — persist both
  `access_token` and `refresh_token`.
- Never log the raw `payload` from interactive actions; Slack embeds the
  invoking user's email there.

## License

MIT
