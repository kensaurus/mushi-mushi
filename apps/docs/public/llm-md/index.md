# Mushi Mushi — know why your AI-built app broke, with the fix ready

Source: https://kensaur.us/mushi-mushi/docs

---
title: Mushi Mushi — know why your AI-built app broke, with the fix ready
description: "Your AI shipped it. Mushi tells you why it broke: a plain-English diagnosis and a ready fix in your editor. Open source, Sentry optional."
---

Your AI wrote it. Mushi tells you why it broke.</>}
  lead={LANDING_HERO.lead}
/>

## The problem it solves

AI coding assistants let one person build and ship an app in days. Then a real
user hits something broken: a button that does nothing, a page in the wrong
language, a score that shows 0. Often nothing crashed, so error monitoring
(services such as Sentry that record when code fails) never notices. The user
gives up or sends a vague message, and the builder loses an afternoon trying to
understand code they did not write themselves.

Mushi closes that gap. The user's report becomes a clear explanation and a fix
your AI assistant can start from.

## A real example from our own sites

This happened on the websites run by Kensaurus, the company behind Mushi.
Mushi's site audit, an automatic weekly check of every page, found two problems
that no error alert had caught:

- an "Edit this page" link that led nowhere, and
- Japanese text showing up on English pages.

Nothing had crashed, so ordinary monitoring stayed quiet. Mushi filed each
problem as a bug report. Within the hour, an AI coding agent in Cursor had
written the fixes and opened them as pull requests: proposed code changes that
wait for approval. A second AI, Claude Opus, reviewed each change and approved
it before it was merged.

## What this is (and is not)

Mushi Mushi is the bug mediator for AI-built apps, an open-source tool that gives every bug your users report a plain-English diagnosis + a ready fix, in your editor.

**Who it is for.** {LANDING_WHAT_THIS_IS.who} {LANDING_WHAT_THIS_IS.boundary}

A few words you will see on this page:

- **SDK**: the small piece of code you add to your app. It shows the report button and sends reports to Mushi.
- **Diagnosis**: Mushi's written explanation of one bug, with how serious it is, the likely cause and a suggested fix.
- **MCP**: the standard way AI code editors such as Cursor and Claude Code connect to outside tools. It is how your editor reads Mushi's reports.
- **Pull request (PR)**: a proposed change to your code that waits for you to approve and merge it.
- **Self-host**: run Mushi on your own server instead of using the hosted service.

## Where it stands today

Mushi Mushi is live and free to try. The hosted service runs at
kensaur.us/mushi-mushi, the libraries are published on npm, and the source code
is public on GitHub. It is built by Kensaurus 合同会社, a small company in Japan,
and runs on the company's own apps and sites. The native iOS, Android and
Flutter libraries are still previews.

## This is what a diagnosis looks like

A user writes one or two sentences about what went wrong. Mushi reads them
together with the screenshot and the technical log from their browser, and
writes back a plain-English title, how serious it is, the likely cause and a
suggested fix. Below is a real one.

  

## See it in action

  

## Get started

## Install it in your app

## Works with Sentry, or without it

Sentry is a popular service that records errors when an app's code crashes.
Many developers already use it, and Mushi does not ask you to give it up.

Sentry is built around what the code threw, with a User Feedback widget and
replay alongside. Mushi starts from what the user reported, ingests Sentry's
errors too, explains each one in plain English, and hands your agent a fix
prompt to start from. With or without Sentry.

Sentry is one way in among several. Bugs come in from your users, your
monitoring tools and even your voice; fixes and status updates go out to your
editor, your AI coding agents, your task tracker and your team chat. Nothing has
to be ripped out.

  

For the technical detail, see **[Concepts &rarr; Architecture](/concepts/architecture)**:
the full sequence diagram and a component-by-component spec.
