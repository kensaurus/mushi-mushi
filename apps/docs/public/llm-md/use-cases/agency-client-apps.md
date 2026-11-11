# You build apps for clients

Source: https://kensaur.us/mushi-mushi/docs/use-cases/agency-client-apps

---
title: You build apps for clients
description: "For agencies and freelancers who run several client apps: a report button per app, a plain-English cause per bug, and what it costs and who sees what."
---

# You build apps for clients

## What goes wrong for you

Your clients send bugs by email, chat messages and screenshots, often days
after they happened. "The form is broken" can cost you an hour just to work out
which app, which page and which form. Their customers, who saw the bug first,
usually tell nobody.

## What Mushi Mushi does

- Each client app gets a **report button**. Anyone using the app can tap it and
  type one sentence. Mushi Mushi adds a picture of the screen, the page and what
  they tapped.
- Reports from every app land in **one console**, sorted by app, with repeat
  reports of the same bug grouped into one.
- Each bug gets a **plain-English diagnosis** (the likely cause, how serious it
  is and how sure Mushi Mushi is) and a **fix prompt** for Cursor, Claude Code,
  Lovable or Bolt.
- When you mark a bug fixed, the person who reported it sees that in the
  widget.

## What you do

1. Create one app (the console also calls it a project) per client app and add
   the button: one command in Cursor or Claude Code, or one prompt in Lovable
   or Bolt.
2. Decide who may see what **before** you invite anyone. See the next section.
3. When a report comes in, read the diagnosis, paste the fix prompt into your AI
   editor, check the change and ship it.

The [team setup checklist](/quickstart/team-setup) walks through roles,
integrations and reviews.

## Who can see what

  **A member of a team can read every app in that team.** That includes the
  read-only **Viewer** role. An invitation is to the team, not to one app. So
  never invite a client into a team that also holds another client's app: they
  would see the other client's bug reports.

To let a client see only their own app, put that app in **its own team**:

1. In the console's team switcher, choose **Create team** and name it after the
   client. One account can own several teams.
2. Create the client's app inside that team.
3. Upgrade that app to Studio, then invite the client as a **Viewer** under
   **Team → Team members**. Invitations need Studio; a team on Free or Builder
   has one seat, yours.

A new team starts on the Free plan (one app, 100 diagnoses a month). Plans are
bought per app (see [What it costs](#what-it-costs)), so a separate team for a
client costs the same as keeping their app in your main team.

If the client does not need the console at all, skip the invitation. Forward
them the report or connect a shared Slack channel, and keep every app in one
team.

### What the people using the app see

They never see your console. In the widget, a person who reported a bug gets a
**Your reports** list with each report's status in plain words ("Looking into
it", "Fix in progress", "Fixed"), your replies, and a box to answer you. They
need no account: the list belongs to that browser. They do not see the
diagnosis, the severity, your code or the pull request.

## How long it takes

A few minutes per app. A test report gets its diagnosis in about 10 seconds.

## What it costs

| Plan | Apps in a team | People | Diagnoses a month | Price |
| --- | --- | --- | --- | --- |
| Free | 1 | 1 | 100 | $0 |
| Builder | 3 | 1 | 1,000 | $29 a month, or $290 a year |
| Studio | 10 | 5 | 3,000 | $79 a month, or $790 a year |

**Eight client apps fit in one Studio team**: Studio allows 10 apps, for $79 a
month or $790 a year. Read the next part before you budget.

**The plan's diagnoses go to the app you upgrade, not to the whole team.** You
upgrade from one app's card on the Billing page, and the subscription is
attached to that app. That app gets 3,000 diagnoses a month. Every other app in
the team keeps 100 diagnoses a month and stops there until the 1st (its reports
are still kept) unless you upgrade that app too.

| What you want | Per month |
| --- | --- |
| 8 apps: one busy app with 3,000 diagnoses, seven quiet apps with 100 each | $79 |
| 8 apps, each with 3,000 diagnoses | 8 × $79 = $632 |

What the whole team gets from one Studio subscription: room for 10 apps, the 5
seats, 180 days of history on every app, plugins, and no Mushi Mushi mark on
any app's widget.

**Seats.** Studio has 5 seats and you are one of them. Every member takes a
seat, a client Viewer included. So does every invitation that has not been
accepted yet, until it is accepted, revoked or expires after 7 days.

**The most you can be billed.** On a monthly plan, each diagnosis past the
included ones costs $0.03, up to a spend cap. The cap belongs to the upgraded
app: $50 a month by default on Builder, $200 on Studio.

- Worst case for one Studio app in a calendar month, at the default cap:
  $79 + $200 = **$279**, plus any tax.
- Want a fixed bill? Open **Team → Billing**, find the app's card and set its
  **Spending cap** to **$0**. Diagnoses then pause at 3,000 until the 1st, and
  that app never costs more than $79 a month.
- Annual plans have no overage at all: they pause at the included diagnoses.
- An app you have not upgraded is never billed.

**The brand mark.** On Builder and Studio the widget carries no Mushi Mushi
mark. On Free it shows a small "Bug reports by Mushi Mushi" link at the foot of
the widget. You can turn it off under **Settings → General**, or with
`brandFooter: false` in the widget settings in your code.

Details on [pricing](/pricing).

## What to tell your client

- **Where the data is kept.** In Tokyo, Japan (Supabase on AWS
  `ap-northeast-1`). There is no other region today.
  See [Data residency](/security/data-residency).
- **Which AI companies see it.** To write the diagnosis, Mushi Mushi sends the
  report's text and logs to Anthropic, OpenAI or OpenRouter in the United
  States, after removing personal details it can recognise, along with the
  screenshot and code snippets. Mushi Mushi does not train models on reports or
  code. The full list of companies is in the
  [Privacy Policy, section 5](/legal/privacy#5-sub-processors).
- **How long it is kept.** Reports are deleted after 14 days on Free, 90 on
  Builder and 180 on Studio. You can set a shorter time per app under
  **Team → Compliance**.
- **Who is responsible.** For the reports from a client's app, you or your
  client decide what is collected; Mushi Mushi only processes it for you. The
  data-processing terms are summarised in the
  [Privacy Policy, section 4](/legal/privacy#4-data-where-mushi-is-the-processor).
  There is no separate data-processing agreement page yet; if a client needs a
  signed one, email kensaurus@gmail.com.
- **What their own privacy notice must say.** That a bug report can include a
  screenshot, console and network log lines and the page address. This duty is
  in the [Terms, section 5](/legal/terms#5-acceptable-use).

The Terms and the Privacy Policy are plain-English drafts that a lawyer has not
reviewed yet. Tell a client who asks.

## Leaving

1. **Remove the button.** Delete the script tag or the SDK from the app and
   deploy. No new reports are sent.
2. **Cancel the subscription** for that app: **Team → Billing → Manage** opens
   Stripe's customer portal. Do this before you delete the app.
3. **Delete the app** under **Manage apps**. An owner or admin can do it. Its
   reports are deleted with it.

If you only remove the button, the reports already collected are deleted when
they pass your plan's retention time. Backups roll off after 7 days.

## Next

- [See a sample report](/demo/diagnosis), no sign-up.
- [Agency feedback tools compared](/compare/agency-feedback-tools): Marker.io,
  BugHerd, Userback and Mushi Mushi.
- [Team setup checklist](/quickstart/team-setup).
- [Pricing](/pricing).
