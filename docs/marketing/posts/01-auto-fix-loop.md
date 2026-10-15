---
title: "From \"this is broken\" to a fix PR I merge by hand"
tags: [opensource, ai, devtools, productivity]
description: How Mushi Mushi turns a one-sentence bug report into a diagnosis and a fix PR, and why I still click merge myself.
canonical_url: https://kensaur.us/mushi-mushi/docs/blog/auto-fix-loop
cover_image: https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png
---

<!-- Published on DEV 2026-10-15: https://dev.to/kenji_sakuramoto_d72920b2/from-this-is-broken-to-a-fix-pr-i-merge-by-hand-cbh
     (without canonical_url, because the docs copy still had the old claims). Fact table: every claim checked
     against origin/master@395c23ae; see the kensaur.us docs/posts ledger. -->
> Sentry starts from what the code threw. Mushi starts from what the user felt.

This is the post I wanted to read before I built Mushi. My Sentry dashboard was green while three people in a row told me the login button on iPad Safari "did nothing." Nothing threw, and the console was clean. The users were still stuck.

[Mushi Mushi (虫虫)](https://github.com/kensaurus/mushi-mushi) is my attempt to close the gap between errors that throw and bugs that users feel. Below is what happens to one report, stage by stage, and why the two steps that touch my repo still wait for me.

## What happens to one report

A user taps the widget in my app and types one sentence: *"login button does nothing on my iPad."*

1. **Capture.** The report arrives with their note, the route, the browser and viewport, and the last console and network events. A screenshot is attached, and the reporter can remove it before sending. If session replay is on for that session, the last 30 seconds come along too.
2. **Filter.** Claude Haiku 4.5 makes a cheap first pass and drops spam and noise.
3. **Diagnose.** Reports that pass go to a second model (Claude Sonnet 5.5 by default, GPT-5.4 as the fallback). It writes a category, a severity, the likely component, a plain-English summary and a confidence score. It reads code retrieved from my repo while it does this, so it can name a file it actually saw instead of guessing. On the hosted service this takes about 10 seconds.
4. **Group.** Each report is embedded and compared with earlier ones by cosine similarity in pgvector. Above 0.82 (the default; each project can change it), the new report joins the existing group instead of opening a new row. Grouped duplicates don't count toward the monthly diagnosis quota. Until early October the per-project threshold was saved but never read, so every project got 0.82. It is read now.
5. **Fix.** Auto-fix stays off until I enable it for a project. Then I click **Dispatch fix** on the report. The fix worker loads whole files from the repo at a pinned commit and asks the model for find-and-replace edits through a typed schema. The model gets no tools and no shell. If the edits don't apply, the worker retries once with the exact error, then stops. If any single file's diff would pass 200 changed lines (a per-project setting), the run aborts. Otherwise it opens the PR as a draft and marks it ready for review so CI runs. Every LLM call is traced in Langfuse.
6. **Check.** The fix's PDCA receipt in the console shows CI on that PR as pending, passed or failed.
7. **Act.** I merge it, or I don't. On merge, Mushi marks the report fixed, resolves the linked Sentry issue if the Sentry plugin is on, and sends the person who reported it a "fixed" notice when their report can receive one.

## Why I still click merge

The loop could run without me: CI already runs on every fix PR. I kept the merge manual anyway.

### The grades are useful, not final

A separate background job, the judge, re-reads classified reports in batches. It scores accuracy, severity calibration, component tagging and repro quality from 0 to 1, and says whether it agrees with the overall call. Those scores feed an A/B test between classifier prompts, so a better prompt can win. They don't change a report's status, and they aren't a reason to merge a fix unread. A severity that is off, or a fix aimed at the wrong component, is exactly what a loop with nobody watching would ship.

### A wrong fix costs more than a slow one

When someone reports a bug and later sees it marked fixed, they learn that the app is looked after. An automatic fix that changes the wrong thing and breaks something else teaches them the opposite. The fix worker's header comment states the rule: "human still confirms merge — nothing auto-merges." I made the path from report to reviewable PR fast and left the merge to me.

## What's open source

The SDKs are MIT: `@mushi-mushi/web` for any site, plus React, Vue, Svelte, Angular, React Native, Capacitor and Node. The CLI and the MCP server are MIT too. iOS, Android and Flutter SDKs are in preview. The server (Supabase Edge Functions, Postgres and pgvector) is AGPLv3. You can self-host it for your own product for free, with your own LLM key and no diagnosis cap. If you run a modified server as a service for other people, AGPL §13 asks you to publish your changes, or you can take a commercial license.

The paid parts are the hosted service and an enterprise edition. Mushi Cloud has a free tier with 50 diagnoses a month and no card, then Indie at $15/month and Pro at $49/month. The enterprise edition (SSO, audit export, region pinning) is source-available and needs a license for production use.

## Try it

- **Product page and docs:** [kensaur.us/mushi-mushi](https://kensaur.us/mushi-mushi/)
- **Read-only demo, no signup:** [connect your editor](https://kensaur.us/mushi-mushi/docs/connect) to a seeded Mushi project over MCP.
- **Add the widget** (detects your framework, installs the SDK, writes env vars):
  ```bash
  npx mushi-mushi
  ```
- **Let your editor read diagnoses** over MCP. The agent calls `get_fix_context` and gets the diagnosis, the repro steps and the relevant code as one prompt:
  ```bash
  npx mushi-mushi setup --ide cursor   # or --ide claude
  ```
- **Source and self-host guide:** [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi)

If you've dealt with user-reported bugs that never threw anything, I'd like to hear how you caught them. Tell me in the comments.
