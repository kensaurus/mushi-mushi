# Sentry alternative for AI-built apps

Source: https://kensaur.us/mushi-mushi/docs/use-cases/sentry-alternative

---
title: Sentry alternative for AI-built apps
description: An open-source Sentry alternative for AI-built apps — plain-English bug diagnoses and ready fixes instead of raw stack traces. Works with or without Sentry.
---

# An open-source Sentry alternative built for AI-written code

Sentry answers "what did the code throw?" Mushi Mushi answers "what did the
user hit, why did it happen, and what's the fix?" If your app was largely
written by Cursor, Claude Code, or another agent, the second question is the
one you actually need answered — you didn't write the code, so a raw stack
trace costs you an afternoon of archaeology.

Mushi is open source (MIT SDKs, AGPLv3 server), works standalone, and turns a
user's bug report into a plain-English diagnosis with a fix you can paste into
your editor.

## When Mushi replaces Sentry — and when it doesn't

You can run Mushi **instead of** Sentry if what you care about is
user-reported friction: broken buttons, dead flows, confusing states. You
should run Mushi **alongside** Sentry if you also want crash-level telemetry —
an optional bridge links Sentry stack traces to Mushi reports so each side
keeps its job.

## Side by side

## What "diagnosis" means here

When a report lands, Mushi reads the report, the screenshot, and your repo,
then writes what broke and why in the language you'd use to explain it to a
teammate — plus a fix prompt scoped to the files involved. Twenty reports
about the same broken checkout button collapse into one row, and past fixes
become lessons your editor sees on the next PR.

## Try it on your app

One command detects your framework, installs the SDK, and writes your env
vars:

```bash
npx mushi-mushi
```

The free tier includes 50 diagnoses a month with no card, and you can
[self-host the whole stack](/self-hosting) with one command if you'd rather
keep everything on your own infrastructure.

**Next:** [Run the incident-loop quickstart](/quickstart/incident-loop) or
[connect your editor over MCP](/quickstart/mcp).
