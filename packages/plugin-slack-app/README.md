# `@mushi-mushi/plugin-slack-app`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


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
2. Paste the contents of [`manifest.json`](./manifest.json). It targets the
   hosted Mushi backend; self-hosters replace the
   `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1` prefix with their
   own functions host:
   - slash command `/mushi` → `<functions>/api/v1/webhooks/slack/commands`
   - Events API → `<functions>/api/v1/webhooks/slack/events`
     (Slack sends a one-time `url_verification` challenge; the route
     answers it, so save the manifest with the backend already deployed)
   - Interactivity → `<functions>/slack-interactions`
   - OAuth redirect → `<functions>/api/v1/webhooks/slack/oauth-callback`
   (Running this package standalone instead? Point everything at
   `https://<your-host>/slack/command` and `/slack/oauth/callback`.)
3. Copy the signing secret + client ID / secret into the backend secrets
   (`SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`).
4. Install to the workspace from the Mushi console (**Integrations → Slack →
   Add to Slack**) so the bot token is vaulted per project, then invite the
   bot to the channels where clips will be dropped.

### Scopes and events (why each one is in the manifest)

| Scope / event | Used for |
| --- | --- |
| `commands` | `/mushi` slash command |
| `chat:write`, `chat:write.public` | Report cards, threaded replies, voice transcript cards |
| `channels:read` | Channel picker in the console |
| `channels:history`, `groups:history`, `im:history` | Receive `message` events (audio clips arrive as `message` events with `files[]`) in public / private channels and DMs |
| `files:read` | `files.info` + downloading the clip (`url_private_download` / `aac`) for transcription |
| `im:read`, `im:write` | Open a DM with the invoking user |
| `users:read`, `users:read.email` | Map Slack users to console members |
| `message.channels`, `message.groups`, `message.im` | Voice clips shared in channels / private channels / DMs |
| `file_shared` | Second signal for a shared clip (deduped on the file id) |
| `app_mention`, `app_home_opened` | Existing mention + App Home behaviour |

Voice clips are never transcribed by Slack's own `transcription` object;
the backend downloads the audio and runs its own speech-to-text, then posts
the verbatim transcript with **Confirm / Cancel** buttons before anything is
dispatched.

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
| `/mushi voice <text>`| Dictate a request (hosted backend only): transcript is read back with Confirm / Cancel buttons before dispatch. |
| `/mushi list`        | Most recent open reports (5 standalone, 10 on the hosted backend). |
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


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 58 edge functions · 347 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
