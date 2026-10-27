# Mushi Mushi — know why your AI-built app broke, with the fix ready

Source: https://kensaur.us/mushi-mushi/docs

---
title: Mushi Mushi — know why your AI-built app broke, with the fix ready
description: "Your AI shipped it. Mushi tells you why it broke: a plain-English diagnosis and a ready fix in your editor. Open source, Sentry optional."
---

Your AI wrote it. Mushi tells you why it broke.</>}
  lead={LANDING_HERO.lead}
/>

## What happens to a bug

Every bug moves through six steps: reported, triaged, fix PR, reviewed and CI,
merged and deployed, and the person who reported it is told.

## The problem it solves

- A user hits a broken button. Nothing crashed, so error monitoring (such as Sentry) stays quiet.
- They give up, or write "it's broken" with no detail.
- You lose an afternoon reading code your AI wrote, not you.

Mushi turns that report into a plain-English cause and a fix your AI can start from.

## A real example from our own sites

Mushi's weekly site audit found two bugs on our own websites that no error alert had caught:

- an "Edit this page" link that led nowhere;
- Japanese text on English pages.

Within the hour, an AI agent in Cursor opened a fix for each, and a second AI (Claude Opus) reviewed them before merge.

## What this is (and is not)

Mushi Mushi is the bug mediator for AI-built apps, an open-source tool that gives every bug your users report a plain-English diagnosis + a ready fix, in your editor.

**Who it is for.** {LANDING_WHAT_THIS_IS.who} {LANDING_WHAT_THIS_IS.boundary}

**Where it stands.** Live and free to try: hosted service, npm packages and public source. Built by Kensaurus 合同会社 in Japan. Native iOS, Android and Flutter libraries are previews.

Words you will see on this page

- **SDK**: the small piece of code you add to your app. It shows the report button and sends reports to Mushi.
- **Diagnosis**: Mushi's written explanation of one bug, with how serious it is, the likely cause and a suggested fix.
- **MCP**: the standard way AI code editors such as Cursor and Claude Code connect to outside tools. It is how your editor reads Mushi's reports.
- **Pull request (PR)**: a proposed change to your code that waits for you to approve and merge it.
- **CI**: the automatic tests that run on every pull request.
- **Self-host**: run Mushi on your own server instead of using the hosted service.

## This is what a diagnosis looks like

A user writes a sentence or two. Mushi reads it with the screenshot and the browser log, and writes back a title, severity, likely cause and fix. This one is real:

  

## See it in action

  

## Spend less on CI

AI agents open a lot of pull requests, and every one runs your tests on GitHub Actions. Mushi keeps that bill small:

- **See what you really pay.** Your GitHub Actions bill per repo and per day, with public repos and free minutes shown as $0.
- **Find the waste.** Tests that run on drafts, schedules that run every hour, docs-only changes that run every test.
- **Fix it in one pull request.** Mushi opens a small workflow change for you to review, then shows the minutes saved after it merges.

Mushi's own fix pull requests run your tests only after a review says they are worth merging. [How the CI page works →](/admin/ci)

## Get started

## Install it in your app

## Works with Sentry, or without it

You don't need Sentry. If you already use it, keep it: its errors land in the same list as user reports, each explained in plain English.

Bugs come in from users, monitoring tools and even your voice. Fixes and updates go out to your editor, coding agents, tracker and team chat.

  

For the technical detail, see **[Concepts &rarr; Architecture](/concepts/architecture)**:
the full sequence diagram and a component-by-component spec.
