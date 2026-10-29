# Who Mushi Mushi is for

Source: https://kensaur.us/mushi-mushi/docs/who-its-for

---
title: Who Mushi Mushi is for
description: "Solo builders who make apps with AI, developers who own their code, and teams: the pains each has and what Mushi Mushi does about them."
---

# Who Mushi Mushi is for

Mushi Mushi was built for one person first: someone who makes apps with AI tools
and then has to deal with the bugs. Two other groups get just as much from it.
Find yours below.

## You build apps with AI, mostly on your own

You use Lovable, Bolt, Cursor or Claude Code. Your app has real users. You did
not write most of the code by hand, and you don't always know how it works.

**What hurts**

- A user writes "it's broken" and you have no idea where to start.
- You ask the AI to fix it, the fix looks fine, and something else breaks.
- You can't watch your app all day, so you hear about problems late, or never:
  most people who hit a bug just leave.

**What Mushi Mushi does**

- Your app gets a report button. Each report comes with a picture of the screen,
  the page and what the person tapped, and Mushi Mushi explains the likely cause
  in plain English.
- Your AI editor gets a ready fix prompt. In Cursor or Claude Code you ask "get
  the latest Mushi report and fix it"; in Lovable or Bolt you paste the prompt.
- It also looks for bugs nobody reports: [a first-time user test](/what-it-does#first-user-test),
  [a watch on your live site](/what-it-does#site-watch), and
  [a check for known security holes](/what-it-does#vulnerabilities).

**Start here:** the install box on the [home page](/) (one command for Claude
Code, one click for Cursor, a script tag for [Lovable or Bolt](/quickstart/lovable-bolt)).
The free plan covers one app with 100 diagnoses a month, no card and no AI key.

## You're a developer and you own your code

You read the diffs. You might already run Sentry. You use AI agents, but you
don't merge what they write without checking it.

**What hurts**

- Error tools tell you what the code threw, not what the person on the other end
  saw. Triage still eats your mornings.
- Agent-written pull requests pile up, and each one needs a careful read.
- CI is slow or expensive, and when it fails you can't tell whether it was your
  code or the machine.

**What Mushi Mushi does**

- Every report and every Sentry error lands in one list, with duplicates merged
  and a diagnosis that names the files and the steps to reproduce it.
- Agents can open fix pull requests, and [a second AI reviews each one](/what-it-does#ai-review)
  against the original report before anything merges. When you choose "Merge when
  ready", approved fixes land one at a time, each branch updated and its tests
  passed first.
- [Your CI bill and runners](/what-it-does#ci-cost), explained: which workflows
  cost the most, what is wasted, and whether a failure was your code or the
  machine.
- It works where you work: an [MCP server](/sdks/mcp) for your editor, a
  [CLI](/sdks/cli), and SDKs for web, React Native, Capacitor and Node.
- It is open source (SDKs MIT, server AGPL), and you can
  [run all of it yourself](/self-hosting).

**Start here:** `npx mushi-mushi` in your app folder, then connect your editor
from the [connect page](/connect).

## You run a team or a company

Several people ship. Bug reports come from support tickets, Slack, app store
reviews and error monitoring, and nobody sees all of them.

**What hurts**

- Bug reports are scattered, and the same bug gets reported five ways.
- Tickets arrive without steps to reproduce, so engineers spend the first hour
  guessing.
- You need to know where the data goes, who can see it, and what it costs.

**What Mushi Mushi does**

- One list for every source: the in-app button, Sentry, low-star App Store and
  Google Play reviews, Slack, and a phone shortcut. Each report gets a diagnosis
  before anyone opens it.
- Sends issues to Linear, Jira or GitHub Issues and alerts to Slack or Discord,
  so nobody has to leave the tools they already use.
- Team seats and roles, an audit log, and a monthly spending cap you set.
- For companies: single sign-on, longer data retention, and the option to run it
  on your own servers. See [security](/security) and
  [data residency](/security/data-residency).

**Start here:** compare the plans on [pricing](/pricing). The Studio plan
includes 10 apps and 5 seats; Enterprise adds single sign-on and self-hosting
support.

## Not sure?

Try the [sample diagnosis](/demo/diagnosis): one real-shaped bug from report to
fix prompt, nothing to install. Or see [everything else it does](/what-it-does).
