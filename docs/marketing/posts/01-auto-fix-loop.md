---
title: 'From "this is broken" to a draft PR: building Mushi Mushi'
tags: [opensource, ai, devtools, productivity]
description: How Mushi Mushi turns a one-sentence user complaint into a diagnosis and a draft PR, and who decides whether that PR merges.
canonical_url: https://kensaur.us/mushi-mushi/docs/blog/auto-fix-loop
cover_image: https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/docs/social-preview/og-card.png
---

> **Correction, 2026-10-29.** This post first promised "60 seconds" from report to draft PR. We never measured that, so the number is gone. What we do measure is on the [proof page](https://kensaur.us/mushi-mushi/docs/proof): where the owner's bugs came from (almost all from the owner's own checks, very few from users), fixes merged, and the median time from bug found to fix merged. The pipeline details below are corrected to match the code, and an unsourced judge-accuracy figure was removed. Since this post, Mushi Mushi added an [AI review of agent PRs](https://kensaur.us/mushi-mushi/docs/concepts/agent-pr-review), which runs on the app's own AI key, and is building verified merge ([roadmap](https://kensaur.us/mushi-mushi/docs/roadmap)): an agent PR merging without a click, only when you switch it on (off by default) and the PR passes a fail-then-pass test and two AI reviews.
>
> **Correction, 2026-11-03.** Checked against the code again. The default models, the fix steps and the review step below now match it, and the merge gate has moved since this was written: see the update at the end of "Why we kept the human in the loop".

> Sentry sees what your code throws. Mushi Mushi sees what your users *feel*.

This is the post I would have wanted to read a year ago, when I was staring at a Sentry dashboard that was perfectly green while three people in a row told me the login button on iPad Safari "did nothing." No exception. No 5xx. No console error. Just a user, frustrated.

That gap — between **errors that throw** and **bugs that users feel** — is what [Mushi Mushi (虫虫)](https://github.com/kensaurus/mushi-mushi) tries to close.

This post walks through the loop end-to-end, what each stage actually does, and why we kept a human in the loop for the parts that should not be automated.

## The loop

A user opens our SDK widget on the site they're frustrated with. They type one sentence: *"login button does nothing on my iPad."* They hit send.

What happens next, in order:

1. **Capture.** The report lands in Mushi Mushi's `reports` table with the user's text, the page URL, the viewport, the browser, and the last console and network events. If the app captures screenshots, one comes along, and the reporter sees it and can remove it before sending. If the app turned session replay on, up to the last 30 seconds of it come too.
2. **Filter.** Claude Haiku 4.5 makes a cheap first pass and drops spam and noise. GPT-6 Luna is its fallback.
3. **Group.** Right after that first pass, the report is embedded and compared with earlier ones by cosine similarity in pgvector. Above 0.82 (the default; each project can change it in Settings), it joins the existing group instead of becoming a new row. Once the group has a diagnosis, a new report in it reuses that diagnosis, so it costs no new model call and does not count toward the monthly diagnosis allowance. The report list shows each group's blast radius: how many reports, distinct reporters and sessions it has. Until October 2026 the per-project threshold was saved but never read, so every project got 0.82.
4. **Diagnose.** Reports that pass go to a second model: Claude Sonnet 5.5 by default, with GPT-6.1 Sol as the fallback when there is no usable Claude key, or Claude refuses or returns unusable output. It writes a category, a severity, the likely component, a plain-English summary and a confidence score. If the repo is indexed, it reads code retrieved from it while it does this, so it is more likely to name a file it actually saw than to guess one. An organization can also switch its AI to OpenAI only. Mine has run that way since 31 October 2026, when my Claude credits ran low, so my own reports are diagnosed by GPT-6.1 Sol.
5. **Fix.** Auto-fix is off for each app until someone turns it on. Then **Dispatch fix** on the report starts the fix worker. It reads whole files from the repo at the commit the PR will branch from, and asks the model (Sonnet 5.5 by default, GPT-6.1 Sol as the fallback) for find-and-replace edits through a typed schema. The model gets no tools and no shell. If the edits don't apply, the worker retries once with the exact error, then stops. If any one file's diff would pass 200 changed lines (a per-project setting), the run aborts. Otherwise it opens a **draft** PR. The model calls are traced in Langfuse. Instead of the built-in worker, the fix can also go to a cloud coding agent (Cursor's, or GitHub's), which opens the PR itself.
6. **Review.** If the app has an AI key of its own, a second model reviews the PR: Claude Opus 5.5 on a Claude key, otherwise GPT-6.1 Sol on an OpenAI key. It never runs on Mushi Mushi's platform key; without the app's own key the review is skipped. The verdict is merge, fix first or hold. On merge or fix first the draft is marked ready, so a repo that skips CI on drafts runs its checks then. A hold stays a draft.
7. **Merge.** A person merges from the console, or adds the PR to the merge queue, which updates the branch and waits for CI. By default the queue batches an app's approved PRs into a release train and merges them together; an app can switch to one PR at a time. On merge, the report is marked fixed, a linked Sentry issue is resolved when the report came from Sentry, and the person who reported the bug gets a "fixed" notice when their report can receive one.

Separately, an LLM-as-Judge job re-reads classified reports in batches. It scores category accuracy, severity calibration, component tagging and repro quality from 0 to 1, and records whether it agrees overall. The scores are stored on the report and decide which candidate classifier prompt gets promoted. They never change a report's status.

## Why we kept the human in the loop

The full PDCA loop *could* be fully autonomous. The agent has the context, the judge has the receipts, and a draft PR is technically reversible.

We chose not to do that, for two reasons.

### 1. The judge is good. The judge is not infallible.

Our LLM-as-Judge mostly agrees with the classifier. Mostly is not "auto-merge" good. The disagreements include the exact cases that an autonomous loop would silently ship wrong fixes for: ambiguous severity, mis-routed component paths, and duplicate-fix attempts that mask the real bug.

Keeping the operator as the merge gate let the rest of the loop get faster without removing the safety net.

### 2. The user's trust is the moat.

A user who reports a bug and watches the team respond — even with a one-line "we shipped this" — develops a kind of operational trust that tells them "this app is alive." That trust survives outages and slow weeks. It does not survive an automated reply that ships the wrong fix and silently breaks something else.

So the human stays in the loop. The loop just gets shorter.

**Update (2026-11-03).** The gate moved. On 30 October my eight apps had 607 open agent fix PRs for 584 reports. About 250 had a "merge" verdict from the review, and none of them was in the queue, because the queue waited for a person to add each one. That person was me, and I didn't. So each app now has a **Decide for me** switch, off by default. When it is on, Mushi Mushi queues the PRs the review approved and closes the ones it will not merge. The release train still requires the "merge" verdict on the exact commit and green CI before anything merges. A hold can only be overridden by a person in the console, with a reason that goes in the audit log. Verified merge, where an agent PR merges only with a test that fails without the fix and passes with it, is still in progress ([roadmap](https://kensaur.us/mushi-mushi/docs/roadmap)).

## What's actually open source

Every SDK is MIT: web, React, Vue, Svelte, Angular, React Native, Capacitor and Node on npm, plus the CLI and the MCP server. iOS, Android and Flutter SDKs are previews in the repo. It is all on [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi). The backend (Supabase Edge Functions + Postgres + pgvector for the embeddings) and the admin console are AGPLv3, which is OSI open source: self-host it free, fork it, modify it for your own org. Offer a modified server as a hosted service and you publish your changes (§13) or take a commercial license.

It's open-core: the core is open source (AGPLv3). What costs money is the hosted service beyond its free plan, and a small source-available enterprise edition (SSO, audit export, retention policies, region pinning) that a solo builder never needs. The hosted Free plan covers one app and 100 diagnoses a month; Builder is $29 a month and Studio $79 ([pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

## Try it

If you'd rather see than read:

- **Sample diagnosis** (no signup): [kensaur.us/mushi-mushi/docs/demo/diagnosis](https://kensaur.us/mushi-mushi/docs/demo/diagnosis)
- **One-command install** (any web framework):
  ```bash
  npx mushi-mushi
  ```
- **Source + self-host docs**: [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi)

If Mushi Mushi's voice (slightly Japanese, slightly bug-themed, *very* opinionated about the difference between an error and a bug) clicks for you, the easiest way to support the project is to [star the repo](https://github.com/kensaurus/mushi-mushi/stargazers). The next dev who needs this finds it that way.
