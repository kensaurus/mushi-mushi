---
title: 60 seconds from "this is broken" to a draft PR — building Mushi Mushi
tags: [opensource, ai, devtools, productivity]
description: A walkthrough of how Mushi Mushi turns a one-sentence user complaint into a classified, deduped, AI-judged draft PR — and why we kept the human in the loop the whole way.
canonical_url: https://github.com/kensaurus/mushi-mushi
cover_image: https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/docs/social-preview/og-card.png
---

> Sentry sees what your code throws. Mushi sees what your users *feel*.

This is the post I would have wanted to read a year ago, when I was staring at a Sentry dashboard that was perfectly green while three people in a row told me the login button on iPad Safari "did nothing." No exception. No 5xx. No console error. Just a user, frustrated.

That gap — between **errors that throw** and **bugs that users feel** — is what [Mushi Mushi (虫虫)](https://github.com/kensaurus/mushi-mushi) tries to close.

This post walks through the loop end-to-end, what each stage actually does, and why we kept a human in the loop for the parts that should not be automated.

## The 60-second loop

A user opens our SDK widget on the site they're frustrated with. They type one sentence: *"login button does nothing on my iPad."* They hit send.

What happens next, in order, every time:

1. **Plan** — the report lands in Mushi's `reports` table with the user's text, the page URL, the viewport, the browser, the console + network tail, and a 30-second session-replay snippet. We attach a screenshot if the user opted in.
2. **Plan, classified** — a fast Haiku model fast-filters the report for spam in ~500 ms. Real reports get a Sonnet 4.6 classification: category, severity, component path, summary, and a confidence score. The component path is grounded against the project's repo embeddings so it points at *real* files (`apps/web/src/login/SignInButton.tsx:42`), not invented ones.
3. **Plan, deduped** — every classified report is embedded and similarity-searched against existing reports. If we have a >0.92 cosine match, the new report joins the existing cluster instead of creating noise. The cluster grows a `blast_radius` counter so triage prioritises bugs hitting the most users first.
4. **Do** — the operator clicks **Dispatch fix**. A worker spins up an agent against the repo, gets the classified report + the embeddings of the relevant files as context, drafts a one-file change, and opens a draft PR. We log every LLM call to Langfuse so you can see exactly what the agent thought.
5. **Check** — an LLM-as-Judge re-evaluates the original classification on five dimensions (accuracy, severity, component, repro, summary). If the judge disagrees, the report flips back to *needs review* and goes back into the operator's queue. If the judge agrees, the receipt strip on the report stamps "✓ Check closed."
6. **Act** — the operator merges the PR (or doesn't). Mushi notes the merge, links the original report to the merge commit, and the report's PDCA receipt closes its final stamp. The user who reported the bug gets a one-line "we fixed this" note if they opted in.

## Why we kept the human in the loop

The full PDCA loop *could* be fully autonomous. The agent has the context, the judge has the receipts, and a draft PR is technically reversible.

We chose not to do that, for two reasons.

### 1. The judge is good. The judge is not infallible.

Our LLM-as-Judge agrees with the classifier ~92% of the time on our golden eval set. That's good. It is not "auto-merge" good. The remaining 8% includes the exact cases that an autonomous loop would silently shipping wrong fixes for: ambiguous severity, mis-routed component paths, and duplicate-fix attempts that mask the real bug.

Keeping the operator as the merge gate means the loop *gets faster* (one click instead of three) without removing the safety net.

### 2. The user's trust is the moat.

A user who reports a bug and watches the team respond — even with a one-line "we shipped this" — develops a kind of operational trust that tells them "this app is alive." That trust survives outages and slow weeks. It does not survive an automated reply that ships the wrong fix and silently breaks something else.

So the human stays in the loop. The loop just gets compressed from *days* to *minutes*.

## What's actually open source

Everything you see in the live admin demo, plus all 14 SDKs (web, React, Vue, Svelte, Angular, React Native, Capacitor, Node, MIT) is on [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi). The backend (Supabase Edge Functions + Postgres + pgvector for the embeddings) is BSL 1.1 — free for self-hosting up to ten million reports/month, paid only if you want to resell it as a hosted product.

We picked BSL specifically because we wanted self-hosting to be free in the cases that almost everyone is in (your team's dev tool), and we wanted the only restriction to be on the case nobody actually does (re-selling a managed Mushi).

## Try it

If you'd rather see than read:

- **Live admin demo** (read-only, dark by design): [kensaur.us/mushi-mushi/](https://kensaur.us/mushi-mushi/)
- **Five-line install** (any web framework):
  ```bash
  npx mushi-mushi
  ```
- **Source + self-host docs**: [github.com/kensaurus/mushi-mushi](https://github.com/kensaurus/mushi-mushi)

If Mushi's voice — slightly Japanese, slightly bug-themed, *very* opinionated about the difference between an error and a bug — clicks for you, the easiest way to support the project is to [⭐ the repo](https://github.com/kensaurus/mushi-mushi/stargazers). The next dev who needs a Sentry-companion finds it that way.

🐛
