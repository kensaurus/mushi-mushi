# For investors

Source: https://kensaur.us/mushi-mushi/docs/investors

---
title: For investors
description: Why Mushi Mushi exists, who it is for, how it makes money, and where it really stands today, with every number dated and sourced. Contact the founder.
# Not indexed while the "Owner to fill" callouts below are still on the page.
# Delete this block once every one of them is filled in.
robots:
  index: false
  follow: true
---

Shipping fast should not mean understanding slow.</>}
  lead="Mushi Mushi is the bug mediator for AI-built apps. This page says why it exists, who it is for, how it makes money, and where it actually stands. Every number on it is dated and has a source."
/>

## The one sentence

Your AI shipped it. Mushi tells you why it broke — in plain English, in your editor, with the fix ready to go — so a bug costs you five minutes instead of your whole afternoon.

## Why now

AI coding tools let one person build and ship what used to take a team.
Cursor, Claude Code, Lovable and Bolt write most of the code; the builder
reviews it and ships it to real users. When something breaks, that same person
is alone with a stack trace for code they did not really write.

The tools they would reach for were built for a different buyer. Error
monitoring assumes a team that can read a trace, and it starts from what the
code threw. Many of the bugs these builders hear about never throw at all: a
button that does nothing, a number that is wrong, a screen that confuses. They
arrive as a message from a user.

Two things changed that make a different shape possible. Language models can
now read a user's sentence, a screenshot and a console tail and say what
probably went wrong in plain English. And the
[Model Context Protocol](https://modelcontextprotocol.io) gave coding agents a
standard way to pull that context in, so the explanation and the fix prompt can
arrive inside the editor where the builder already works.

## Who it is for

| | |
|---|---|
| **Primary** | The solo or indie builder who ships AI-written apps to real users, does not run Sentry, and loses afternoons when something breaks. |
| **Secondary** | Small teams and agencies with the same problem at a slightly larger scale. |
| **Not who we lead with** | The enterprise SRE running a full monitoring stack. An Enterprise tier exists for them; it is never the front door. |

## The product today

Everything below ships now and links to its documentation.

- **Capture.** SDKs for React, Next.js, Vue, Nuxt, Svelte, Angular, React Native,
  Expo, Capacitor and Node, installed by one command (`npx mushi-mushi`). A user
  reports a bug from a widget or by shaking the phone; the report carries a
  screenshot and the console and network tail. [Quickstart](/quickstart)
- **The diagnosis.** Each report gets a plain-English title, severity, likely
  cause and suggested fix. Repeat reports of the same problem collapse into one.
  [See a real one on the landing page](/)
- **In the editor.** An MCP server lets Cursor, Claude Code and other agents read
  the diagnosis and pull a paste-ready fix prompt, with no second LLM key. It is
  listed in the official MCP registry, Glama, mcp.so, Smithery and
  cursor.directory. [MCP quickstart](/quickstart/mcp)
- **The mediator.** Sentry errors and other monitoring webhooks land in the same
  queue as user reports. Fixes and status go out to Linear, Jira, GitHub Issues,
  Slack, Discord, Teams and cloud coding agents, and merging a fix resolves the
  linked Sentry issue. [Plugins](/plugins)
- **Open source and self-hostable.** SDKs are MIT, the server is AGPLv3, and the
  whole stack self-hosts with one command on your own model keys.
  [Self-hosting](/self-hosting)

## What we think compounds

We would rather say what is not defensible first. Deduplication, MIT SDKs with a
self-host path, and an MCP server are table stakes: Sentry, PostHog and others
have versions of each.

What we think compounds:

1. **Starting from the user's report, not the thrown error.** The queue is built
   around what a person felt, with monitoring as an optional on-ramp. That is a
   different product shape, not a feature to bolt on.
2. **Lessons that persist.** Past fixes become rules the editor sees on the next
   change (`.mushi/lessons.json`), so each project gets better at its own bugs.
3. **Sitting between tools instead of replacing them.** Nobody has to rip out
   Sentry, Linear or Slack to start. Every integration added makes the queue
   more useful without asking the builder to migrate.
4. **Open source distribution.** The SDKs and the server are public, so
   developers can read what runs on their users' devices and self-host it.

## How it makes money

Open core, plus a hosted cloud metered per diagnosis. A diagnosis is one
completed plain-English classification; filtered noise and deduplicated reports
are not charged. Self-hosting is free forever on your own model keys, and a
commercial license covers the enterprise edition.

This quarter the plan is free-first: the goal is activated projects, and
pricing is revisited once there are enough of them to price against.

## Where it stands, honestly

The repository went public on 16 April 2026. These are the numbers, with their
dates and sources. Downloads are raw npm counts and include CI runs and our own
installs; they are not users.

| Signal | Number | As of | Source |
|---|---|---|---|
| Console signups, all time | 9 | 2026-09-20 | [Build-in-public post](/blog/nine-signups-what-the-data-said) |
| External projects that received a first report (activated) | 0 of 4 | 2026-09-20 | [Build-in-public post](/blog/nine-signups-what-the-data-said) |
| Paying customers | 0 | 2026-09-20 | [GTM scorecard](https://github.com/kensaurus/mushi-mushi/blob/master/docs/marketing/scorecard.md) |
| End-user sessions, all on our own apps | 26,000 | 2026-09-20 | [Build-in-public post](/blog/nine-signups-what-the-data-said) |
| Published npm packages | 30 | 2026-09-21 | [Build-in-public post](/blog/nine-signups-what-the-data-said) |
| npm downloads, September 2026: `@mushi-mushi/core` · `web` · `react-native` · `mcp` | 1,473 · 1,425 · 1,342 · 917 | 2026-10-02 | [npm downloads API](https://api.npmjs.org/downloads/point/last-month/@mushi-mushi/core) |
| GitHub stars | 3 | 2026-10-02 | [Repository](https://github.com/kensaurus/mushi-mushi) |
| Public launches (Show HN, Product Hunt) | none yet | 2026-10-02 | [Launch page](/launch-week) |

The product was built before the distribution was, and the launch has not run
yet. The one number we now steer by is **activated external projects per week**:
a project owned by someone who is not us receives its first real bug report and
its owner opens the diagnosis. We publish it after every launch.

  **Owner to fill:** replace this callout with the latest weekly row from
  the GTM scorecard (activated external projects, signups, paid) and its date,
  every time the page is updated. Do not add a number that is not already
  published.

## The founder

Mushi Mushi is built by **Kenji Sakuramoto** through Kensaurus 合同会社, a
Japanese company. Code: [github.com/kensaurus](https://github.com/kensaurus).
Posts: [Bluesky](https://bsky.app/profile/kensaurus.bsky.social) and the
[blog](/blog).

  **Owner to fill:** a short bio (background, what you built before, why you
  are the person to build this), a photo if you want one, and where you are
  based.

## What the next stage looks like

  **Owner to fill:** what you would do with outside capital, in categories
  only (for example: hiring, distribution, hosted infrastructure). Keep the
  amount, valuation and terms off this page and share them privately.

## Talk to the founder

If you invest in developer tools and want to follow along or talk, email
[kensaurus@gmail.com](mailto:kensaurus@gmail.com?subject=%5Bmushi-investors%5D)
with `[mushi-investors]` in the subject. The
[build-in-public posts](/blog) are the best way to see how the project is going
between conversations.

This page describes the company and its product. It is not an offer to sell,
or a solicitation of an offer to buy, any security. Any investment would be
discussed privately and made only under definitive documents.
