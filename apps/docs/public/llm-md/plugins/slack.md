# Slack app

Source: https://kensaur.us/mushi-mushi/docs/plugins/slack

---
title: Slack app
description: Triage Mushi bug reports from Slack — add the app from the Integrations page, and each report posts as a card with buttons to fix, resolve or dismiss.
---

# Slack app plugin

Triage a bug from the channel it lands in. Mushi posts each classified report
as a Block Kit card carrying the plain-English title, root cause, and evidence
counts — and the card's buttons let you dispatch a fix, resolve, or dismiss
without opening the console.

**Why it exists** — the fastest triage is the one that doesn't need a second
tab.

**Who it's for** — teams whose bugs already get discussed in Slack.

## Setup

On Mushi Cloud there is nothing to install or host:

1. In the Mushi console, open the **Integrations** page and click **Add to
   Slack** on the Slack card. Approve the install in Slack.
2. Pick the channel for report notifications.
3. Invite the Mushi bot to that channel.

Running the Mushi backend yourself? Create the Slack app from the manifest
in [`@mushi-mushi/plugin-slack-app`](https://www.npmjs.com/package/@mushi-mushi/plugin-slack-app),
point its Interactivity Request URL at `<functions-url>/slack-interactions`,
and set `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`
on the server. The package README lists every URL and scope.

## What's on the card

| Element | What it tells you |
| --- | --- |
| Header | Severity, category, project — plus `(N×)` when the bug is a repeat |
| Title | The plain-language headline ("Checkout button does nothing"), with the technical summary beneath it |
| 🔍 line | Likely root cause from Stage 2 |
| Context row | Area · component · confidence · reporter · environment · page · release |
| Evidence row | Console errors, failed requests, repro-step count, screenshot, SDK version |
| Footer | Report id and session id |

Rows only render when there's something to show, so a thin report stays a
small card.

## Acting from the channel

| Button | What happens |
| --- | --- |
| **Triage →** | Opens the report in the console, scoped to the right project |
| **Dispatch fix** | Runs the fix agent and opens a draft PR. Swaps to *Install GitHub App* / *Enable Autofix* when the prerequisites are missing |
| **Resolve ✓** | Marks the report resolved and notifies the reporter |
| **Dismiss** | Marks it dismissed (noise, duplicate, won't fix), behind a confirm dialog |
| **Reply to reporter** | Opens a box for a message the person who reported the bug sees word for word in "Your reports" in your app. Only shown when the report came from your app's widget |

Resolve and Dismiss run the same transition contract as the console — plugin
event, linked-issue resolution, and reporter notification — so acting from
Slack and acting from the web app can't drift apart.

After an action the card rewrites itself in place: the button row is replaced
with an outcome line naming who acted and when, and a threaded reply records
it in channel history.

  **Assign is deliberately absent.** Reports have no assignee column, so an
  "Assign" button would be a UI with nothing behind it.

## Slash commands

Once Slack is added, `/mushi` answers (self-hosted backends point **Slash
Commands → `/mushi`** at `<functions-url>/api/v1/webhooks/slack/commands`):

| Command | What happens |
| --- | --- |
| `/mushi list` | The latest 10 open reports, linked to the console |
| `/mushi open ` | One report's summary and console link |
| `/mushi resolve ` | Marks it resolved, the same as the card's **Resolve ✓** |
| `/mushi reply  ` | Answers the person who reported it. Same path as **Reply to reporter**: they see your message word for word in your app, and get an email or push only if they opted in |
| `/mushi voice ` | Voice intake by text; see [Voice intake](/integrations/voice-intake) |

`` is the full report id or its first 6+ characters. Replies are capped at
2,000 characters and only reach reports filed from your app's widget.

The reporter sees a reply from "Developer". Every reply sent from Slack, by
`/mushi reply` or the card's button, also writes a `report.reporter_replied`
entry to the console's audit log naming the Slack user (and, for the command,
the channel) it came from.

## Package

[`@mushi-mushi/plugin-slack-app`](https://www.npmjs.com/package/@mushi-mushi/plugin-slack-app)

You don't need the package on Mushi Cloud. It holds the pieces for hosting
the Slack side yourself: the slash command router (`list`, `open `,
`resolve `, `help`), `verifySlackRequest`, the OAuth helpers
(`buildInstallUrl`, `exchangeCode`), the app manifest, and
`createSlackPlugin`, which posts `report.classified`, `fix.proposed`,
`fix.applied` and `report.status_changed` to a Slack incoming webhook.

## What gets posted

| Moment | Action |
| --- | --- |
| A report is triaged | Post the Block Kit card to the channel |
| A fix PR opens | Thread with the PR link |
| A QA story fails or recovers | Transition-aware threaded updates |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Buttons do nothing | Interactivity Request URL not set, or the signing secret doesn't match |
| Cards post but Triage 404s | `ADMIN_BASE_URL` unset on the server — the deep link can't be built |
| No cards at all | No bot token for the project, and no `slack_webhook_url` fallback configured |
