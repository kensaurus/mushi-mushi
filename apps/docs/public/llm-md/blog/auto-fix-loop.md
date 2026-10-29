# From "this is broken" to a draft PR: building Mushi Mushi

Source: https://kensaur.us/mushi-mushi/docs/blog/auto-fix-loop

---
title: 'From "this is broken" to a draft PR: building Mushi Mushi'
description: How Mushi Mushi turns a one-sentence user complaint into a classified, deduped, AI-judged draft PR, and why the human stays in the loop the whole way.
---

# From "this is broken" to a draft PR: building Mushi Mushi

*Kenji Sakuramoto*

---

  **Correction, 2026-10-29.** This post first promised "60 seconds" from report
  to draft PR. We never measured that, so the number is gone. What we do
  measure is on the [proof page](/proof): where the owner's bugs came from
  (almost all from the owner's own checks, very few from users), fixes merged,
  and the median time from bug found to fix merged. The pipeline details below are corrected to match the code, and
  an unsourced judge-accuracy figure was removed. Since this post, Mushi Mushi
  added an [AI review of every agent PR](/concepts/agent-pr-review) and is
  building verified merge ([roadmap](/roadmap)): an agent PR merging without a
  click, only when you switch it on (off by default) and the PR passes a
  fail-then-pass test and two AI reviews.

> Sentry sees what your code throws. Mushi sees what your users *feel*.

This is the post I would have wanted to read a year ago, when I was staring at a Sentry dashboard that was perfectly green while three people in a row told me the login button on iPad Safari "did nothing." No exception. No 5xx. No console error. Just a user, frustrated.

That gap — between **errors that throw** and **bugs that users feel** — is what [Mushi Mushi (虫虫)](https://github.com/kensaurus/mushi-mushi) tries to close.

This post walks through the loop end-to-end, what each stage actually does, and why we kept a human in the loop for the parts that should not be automated.

## The loop

A user opens our SDK widget on the site they're frustrated with. They type one sentence: *"login button does nothing on my iPad."* They hit send.

What happens next, in order, every time:

1. **Plan** — the report lands in Mushi's `reports` table with the user's text, the page URL, the viewport, the browser, the console + network tail, and, if the app turned replay on, a short session-replay snippet. We attach a screenshot if the user opted in.
2. **Plan, classified** — a fast Haiku model filters the report for spam. Real reports get a Sonnet classification (the model is a setting; the default is Sonnet 5.5 today): category, severity, component path, summary, and a confidence score. The component path is grounded against the project's repo embeddings so it points at *real* files (`apps/web/src/login/SignInButton.tsx:42`), not invented ones.
3. **Plan, deduped** — every classified report is embedded and similarity-searched against existing reports. A close enough match joins the existing cluster instead of creating noise. The cluster grows a `blast_radius` counter so triage prioritises bugs hitting the most users first.
4. **Do** — the operator clicks **Dispatch fix**. A worker spins up an agent against the repo, gets the classified report + the embeddings of the relevant files as context, drafts a change, and opens a draft PR. We log every LLM call to Langfuse so you can see exactly what the agent thought.
5. **Check** — an LLM-as-Judge re-scores the original classification on four dimensions (category accuracy, severity, component, repro steps) and records whether it agrees overall. The scores are stored on the report and feed prompt tuning; a low score is a signal for the operator, not an automatic status change.
6. **Act** — the operator merges the PR (or doesn't). Mushi notes the merge, links the original report to the merge commit, and the report's PDCA receipt closes its final stamp. The user who reported the bug gets a one-line "we fixed this" note if they opted in.

## Why we kept the human in the loop

The full PDCA loop *could* be fully autonomous. The agent has the context, the judge has the receipts, and a draft PR is technically reversible.

We chose not to do that, for two reasons.

### 1. The judge is good. The judge is not infallible.

Our LLM-as-Judge mostly agrees with the classifier. Mostly is not "auto-merge" good. The disagreements include the exact cases that an autonomous loop would silently ship wrong fixes for: ambiguous severity, mis-routed component paths, and duplicate-fix attempts that mask the real bug.

Keeping the operator as the merge gate means the loop *gets faster* (one click instead of three) without removing the safety net.

### 2. The user's trust is the moat.

A user who reports a bug and watches the team respond — even with a one-line "we shipped this" — develops a kind of operational trust that tells them "this app is alive." That trust survives outages and slow weeks. It does not survive an automated reply that ships the wrong fix and silently breaks something else.

So the human stays in the loop. The loop just gets shorter.

## What's actually open source

The admin console and every SDK (web, React, Vue, Svelte, Angular, React Native, Capacitor and Node on npm, all MIT; iOS, Android and Flutter as previews in the repo) are on [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi). The backend (Supabase Edge Functions + Postgres + pgvector for the embeddings) is AGPLv3 — true OSI open source: self-host it free, fork it, modify it for your own org. Offer a modified server as a hosted service and you publish your changes (§13) or take a commercial license.

It's open-core: the core is open source (AGPLv3), and the only paid boundary is a small source-available enterprise edition (SSO, audit export, retention policies, region pinning) that a solo builder never needs.

## Try it

If you'd rather see than read:

- **Sample diagnosis** (no signup): [kensaur.us/mushi-mushi/docs/demo/diagnosis](https://kensaur.us/mushi-mushi/docs/demo/diagnosis)
- **One-command install** (any web framework):
  ```bash
  npx mushi-mushi
  ```
- **Source + self-host docs**: [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi)

If Mushi's voice — slightly Japanese, slightly bug-themed, *very* opinionated about the difference between an error and a bug — clicks for you, the easiest way to support the project is to [star the repo](https://github.com/kensaurus/mushi-mushi/stargazers). The next dev who needs this finds it that way.

---

*The draft lives in [`docs/marketing/posts/01-auto-fix-loop.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/marketing/posts/01-auto-fix-loop.md); this page is the canonical copy.*
