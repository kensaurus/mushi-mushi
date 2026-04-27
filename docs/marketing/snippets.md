# snippets.md — drafts you can paste

Never start from a blank page. Everything here is already in Mushi-chan's voice
(see [VOICE.md](./VOICE.md)) and can be used as-is or lightly edited for the
moment. Read through once end-to-end before the launch so nothing feels
unfamiliar.

---

## Table of contents

- [One-liners](#one-liners)
- [Tweet / Bluesky hooks](#tweet--bluesky-hooks)
- [Show HN — title + body](#show-hn--title--body)
- [Reddit — opener per subreddit](#reddit--opener-per-subreddit)
- [Bluesky / X launch thread](#bluesky--x-launch-thread)
- [LinkedIn post](#linkedin-post)
- [dev.to article template](#devto-article-template)
- [Product Hunt copy](#product-hunt-copy)
- [YouTube short script (90s)](#youtube-short-script-90s)
- [Newsletter pitch email](#newsletter-pitch-email)
- [Discord / Slack community drop](#discord--slack-community-drop)

---

## One-liners

Use these anywhere — tweets, bios, press bios, Slack descriptions, Discord about.

- Sentry sees what your code throws. Mushi sees what your users feel.
- Bug reports that fix themselves.
- Shake. Classified. Fixed. (In that order.)
- A small Japanese bug who lives in your app.
- The friendly user-friction layer that complements Sentry.
- `npx mushi-mushi` — 60 seconds to a shake-to-report widget.

---

## Tweet / Bluesky hooks

Under 280 chars. Each one is the **first post** of a thread; add replies with
the GIF, a screenshot, or the install command.

### Hook A — the category contrast

> Sentry catches what your *code* throws.
>
> But a button that silently does nothing? A checkout that confuses every new user? A 12-second page that never errors?
>
> Those are user-felt bugs. Your monitoring can't see them.
>
> I built Mushi Mushi for those. OSS, MIT. 🐛
>
> 👇

### Hook B — the mascot intro

> Mushi mushi. I'm Mushi-chan.
>
> I live in the corner of your app. When a user wiggles their phone because something feels off, I write it down, screenshot it, classify it with an LLM, and — if you ask — open the fix PR on your repo.
>
> No pager. No shouting. 🐛
>
> 👇

### Hook B — the number hook

> 14 KB gzipped on the client. 2-stage LLM pipeline on the server. 60 seconds to install.
>
> Mushi Mushi: user-felt bug reports → classified → deduped → auto-fix PR.
>
> The loop runs on a tiny Japanese bug named Mushi-chan. 🐛
>
> 👇

### Hook C — the demo dare

> Every "user feedback" tool I've tried dumps raw text into a spreadsheet and calls it a day.
>
> So I built one that classifies, dedupes, and opens the fix PR.
>
> Try it — click any tile in the live demo, no signup: kensaur.us/mushi-mushi
>
> 🐛 I'm Mushi-chan and I'm listening.
>
> 👇

### Hook D — the quiet flex

> v0.5: Mushi-chan learned a new trick.
>
> When a user-felt bug lands, I now try to fix it. On your GitHub repo. With a draft PR. And I leave the Langfuse trace so you can see exactly what I thought.
>
> 🐛
>
> 👇

---

## Show HN — title + body

Post 9am PT Tuesday. Be at your desk for the next 6 hours.

### Title options (pick whichever feels less salesy *to you*)

- `Show HN: Mushi Mushi – The user-friction layer that complements Sentry`
- `Show HN: Mushi Mushi – A small Japanese bug who classifies user-felt bugs and opens fix PRs`
- `Show HN: I built the bug-reporting tool I wanted Sentry to be`

### Body (paste in the first comment, not the post body — HN etiquette)

```
Hi HN,

I'm Ken. For the last ~8 months I've been building Mushi Mushi — the user-friction
intelligence layer I kept wanting next to Sentry.

Sentry is excellent at showing me what my code *threw*. It can't see:
- A button that looks clickable but does nothing
- A checkout flow that confuses every new user
- A page that takes 12 seconds to load but never errors
- A layout that breaks on one specific Android phone

Those are user-felt bugs. Users just leave.

How it works: drop a 14 KB SDK into your app, users shake their phone (or click
the widget), and Mushi auto-captures screenshot + console + network + route +
intent. Then a two-stage LLM pipeline (Haiku fast-filter → Sonnet vision + RAG)
classifies, dedupes, and — if you opt in — opens a draft fix PR on your GitHub
repo via a sandboxed agent (e2b / modal / cloudflare; never runs in prod without
one).

Stack: React 19 + Tailwind 4 + Vite 8 (admin), Supabase Edge Functions + Postgres
+ pgvector (backend), Claude Sonnet + Haiku with OpenAI fallback, Playwright for
fix verification. MCP JSON-RPC server so Cursor / Claude Code / Codex can read
reports and dispatch fixes from inside the agent.

SDKs under MIT, server under BSL 1.1 (→ Apache 2.0 in 2029). BYOK, BYO storage,
region-pinned (US / EU / JP), SOC 2 evidence pack on the hosted tier.

Live demo with seeded bugs: https://kensaur.us/mushi-mushi/
Quick start: `npx mushi-mushi`
Repo: https://github.com/kensaurus/mushi-mushi

Happy to answer anything and take the inevitable hate for picking BSL on the
server. 🐛
```

### Responding in comments

- Lead with agreement whenever you can ("You're right that X — here's what I chose…")
- Never use "we" if you're solo. Just "I".
- If someone compares to Sentry — *agree*, clarify companion, don't argue.
- If someone asks about LLM cost — show the real `/health` page numbers.
- Stay for 6 hours at minimum. HN rewards presence.

---

## Reddit — opener per subreddit

Different angle per subreddit. Never cross-post the same text. Post one per day
across the launch window.

### r/webdev — "I built"

```
Title: I built a bug-reporting widget that classifies and opens fix PRs

I kept running into user feedback that my monitoring couldn't see — dead buttons,
slow screens, layouts that break on one Android. So I spent a few months building
the thing I wanted: a 14 KB shake-to-report widget + an LLM pipeline that
classifies, dedupes, and optionally opens a draft GitHub PR with a fix.

OSS, MIT-licensed SDKs for React / Vue / Svelte / Angular / React Native /
Capacitor / vanilla JS. Live demo at kensaur.us/mushi-mushi if you want to poke
around without installing anything.

Not a Sentry competitor — designed as a companion (it stream-links to Sentry
breadcrumbs). Repo: github.com/kensaurus/mushi-mushi. Happy to take hate.
```

### r/reactjs — "drop-in for React"

```
Title: Drop-in user-felt-bug reporting for React (with auto-fix PRs)

Four lines to add to any React / Next.js app:

    import { MushiProvider } from '@mushi-mushi/react'

    <MushiProvider config={{ projectId, apiKey }}>
      <YourApp />
    </MushiProvider>

Users get a quiet shake-to-report widget. Reports land classified by an LLM
within seconds. Dedupe is pgvector-backed. The cool part: if you wire a GitHub
token, it opens a draft fix PR via an agentic orchestrator (sandboxed, never
runs in prod without e2b/modal/cloudflare).

MIT on the SDK, 5 KB gzipped for the React bindings, 14 KB for the core widget.
Would love feedback from people actually running this pattern in prod.

Live demo (no signup): kensaur.us/mushi-mushi
npm: @mushi-mushi/react
Repo: github.com/kensaurus/mushi-mushi
```

### r/selfhosted — "here's the docker-compose"

```
Title: Self-hosted user-felt-bug tracker with LLM classification + auto-fix PRs

Been dogfooding this for months and finally got the self-host story clean. One
docker-compose up, BYOK for Anthropic/OpenAI, your Postgres, your object store
(S3 / R2 / GCS / Azure Blob), your region.

It catches the bugs your crash tracker can't — dead buttons, confusing flows,
slow pages that never error. 2-stage LLM pipeline classifies and dedupes them.
Optionally opens fix PRs on your GitHub via a sandboxed agent.

MIT SDKs, BSL 1.1 server (→ Apache 2.0 in 2029). Sentry + Langfuse + GitHub
integration health probe is on by default.

Repo: github.com/kensaurus/mushi-mushi
Self-host guide: SELF_HOSTED.md in the repo.

Anyone else running something like this self-hosted? Curious how you handle
LLM cost over volume.
```

### r/opensource — "the BSL 1.1 rationale"

```
Title: I MIT'd the SDKs and BSL'd the server — here's why

TL;DR: people shouldn't need a license lawyer to embed my widget in their app,
but I also don't want AWS to turn my classification pipeline into a managed
product next quarter. MIT on everything a user installs, BSL 1.1 with a 4-year
Apache-2.0 conversion on the server. Happy to get told I'm wrong.

The tool: github.com/kensaurus/mushi-mushi — user-felt bug reports (the ones
Sentry can't see) with an LLM classifier and optional auto-fix PRs.

Live demo: kensaur.us/mushi-mushi
```

### r/javascript — "the auto-fix demo"

```
Title: Watch an LLM classify a user bug report and open the fix PR (60s video)

Little weekend demo of the auto-fix loop: user shakes phone → 14 KB widget pops
up → types "login button does nothing on iPad Safari" → Haiku fast-filter tags
it 'actionable' → Sonnet classifies as High severity, Authentication component
→ agent drafts a fix, sandboxed in e2b → GitHub PR opened for review.

All OSS, MIT-licensed SDKs: github.com/kensaurus/mushi-mushi
Live demo: kensaur.us/mushi-mushi
```

### r/programming — "the architecture post"

```
Title: Architecture: turning user rage-shakes into GitHub PRs (with LLM judging itself weekly)

Wrote up the architecture of Mushi Mushi — the user-felt-bug tracker I've been
working on. Interesting bits:

- 2-stage LLM pipeline (Haiku fast-filter → Sonnet + vision + RAG) for classification
- Knowledge graph in Postgres + pgvector for dedup (bug ↔ component ↔ page ↔ version)
- LLM-as-Judge runs weekly, scores the classifier's own output, low scorers feed
  a prompt A/B queue that auto-promotes candidates when their judge score beats
  the baseline
- Fix orchestrator opens draft GitHub PRs via a sandboxed agent (e2b/modal/cloudflare)
  with MCP JSON-RPC so any compatible agent can plug in (Cursor, Claude Code, Codex)

Full architecture: \<link to apps/docs/content/concepts/architecture.mdx\>
Repo: github.com/kensaurus/mushi-mushi
```

### r/reactnative — "shake-to-report for mobile"

```
Title: Native shake-to-report for React Native / Expo (with bottom-sheet widget)

Built a bug-reporting widget for RN / Expo — users shake, bottom sheet pops up,
offline queue handles the airplane-mode case, reports classified server-side
by an LLM within seconds.

Drop-in:

    import { MushiProvider } from '@mushi-mushi/react-native'

    <MushiProvider projectId={…} apiKey={…}>
      <App />
    </MushiProvider>

OSS, MIT. Peer-deps are @react-native-async-storage/async-storage and
@react-navigation/native (both optional).

Live web demo: kensaur.us/mushi-mushi
npm: @mushi-mushi/react-native
Repo: github.com/kensaurus/mushi-mushi
```

---

## Bluesky / X launch thread

5 posts. First is the hook (GIF), then one per "room" in the admin tour.

**Post 1** — hook, attach the 30-second GIF

> Sentry sees what your code throws. Mushi sees what your users *feel*.
>
> Shake-to-report widget → LLM classifies → optional fix PR on your repo.
>
> I'm Mushi-chan. 🐛 Here's the 30-second tour:

**Post 2** — the widget, attach phone-shake screenshot or GIF

> This is the widget. 14 KB gzipped. Shadow-DOM, no CSS leak. Shake the phone or click the icon. One sentence from the user, I auto-capture the rest (screenshot, console, network, route, intent).

**Post 3** — the triage queue, attach `reports-dark.png`

> Report lands in the admin within ~2s. Severity coloured bar, dedup-aware blast radius, one "Dispatch fix" button per row. No 47-step workflow.

**Post 4** — the auto-fix pipeline, attach `fixes-dark.png`

> If you opt in, I open the PR. Sandboxed agent (e2b / modal / cloudflare, never runs in prod without one), validateResult gating, Langfuse trace on every run.

**Post 5** — the CTA

> All OSS, MIT on the SDKs. `npx mushi-mushi` to start.
>
> Live demo (seeded, no signup): kensaur.us/mushi-mushi
> Repo (⭐ helps next devs find me): github.com/kensaurus/mushi-mushi
>
> Be nice to Mushi-chan. 🐛

---

## LinkedIn post

Different audience — engineering leaders and founders. Same voice, slightly
less emoji. No hashtag spam.

```
I spent the last 8 months building the bug-reporting tool I kept wishing Sentry
had.

Sentry is excellent at one thing: what your code throws. It can't see the button
that looks clickable but does nothing. Or the checkout that confuses every new
user. Or the layout that breaks on one Android.

Those are user-felt bugs. Your monitoring can't see them. Users just leave.

So: Mushi Mushi (虫虫). A 14 KB shake-to-report SDK, a 2-stage LLM pipeline
(Haiku fast-filter → Sonnet with vision + RAG) that classifies and dedupes, and
an optional agentic auto-fix that opens draft GitHub PRs for review. Designed
as a companion to Sentry, not a replacement.

OSS, MIT on the SDKs, BSL 1.1 on the server (converts to Apache 2.0 in 2029).
Live demo with seeded bugs — no signup, one click:

https://kensaur.us/mushi-mushi

If it sounds useful, a GitHub star helps the next developer find it:
https://github.com/kensaurus/mushi-mushi

Happy to answer anything — including the architecture choices I'd already redo
in hindsight.

🐛
```

---

## dev.to article template

Cross-post to dev.to + Hashnode + personal blog on the Friday of launch week,
then re-use the structure for every future post. dev.to SEO compounds for
months — *this is the post that keeps earning stars after the launch dies*.

```
---
title: "I built the bug-reporting tool Sentry can't be (here's what I learned)"
published: true
tags: opensource, javascript, react, showdev
cover_image: https://kensaur.us/mushi-mushi/og-cover.png
---

*Four sentences above the fold. This is what dev.to shows in the feed.*

Eight months ago I started building the user-feedback tool I kept wishing Sentry
had. Last week I shipped v0.5 and crossed \<N\> stars. Here's what worked,
what broke, and the architecture I'd already redo in hindsight.

## The gap Sentry can't close

\[Short section — the 6-row table from the README.\]

## The 14 KB widget

\[How the SDK works. Shadow DOM, offline queue, `response_format` JSON. Code
snippets the reader can actually paste.\]

## The 2-stage LLM pipeline

\[Haiku fast-filter → Sonnet deep. Why two stages. Cost per report with real
numbers. Prompt-cached system instructions. Structured outputs.\]

## The auto-fix loop

\[Agentic orchestrator, sandbox abstraction, MCP JSON-RPC, GitHub PR. Link to
the 90-second video.\]

## What I'd redo

\[Be honest. One thing. Readers trust honesty.\]

## Try it

Live demo (seeded, no signup): https://kensaur.us/mushi-mushi
Quick start: `npx mushi-mushi`
Repo: https://github.com/kensaurus/mushi-mushi

If the idea is useful, a star helps the next developer find it. 🐛

— Mushi-chan
```

---

## Product Hunt copy

Launch on the Wednesday of launch week, 12:01am PT.

### Tagline (≤ 60 chars)

> Bug reports that fix themselves — Sentry's missing companion.

### Description

```
Sentry sees what your code throws. Mushi sees what your users feel.

Drop a 14 KB SDK in your app (React, Vue, Svelte, Angular, React Native,
Capacitor, or vanilla JS). Users shake to report. A 2-stage LLM pipeline
classifies, dedupes, and — if you opt in — opens a draft fix PR on your
GitHub repo.

• MIT-licensed SDKs, BSL 1.1 server (→ Apache 2.0 in 2029)
• Self-host with one docker-compose, or use the hosted tier
• Works alongside Sentry, Datadog, New Relic (not a replacement)
• MCP server so Cursor / Claude Code / Codex can triage from the agent

Live demo (no signup): kensaur.us/mushi-mushi
Repo: github.com/kensaurus/mushi-mushi

🐛 Be nice to Mushi-chan.
```

### First-comment from the maker

```
Hey PH! I'm Ken, solo maintainer of Mushi-chan (the bug).

I built this because my side projects kept getting user feedback Sentry couldn't
see — dead buttons, confusing flows, slow pages. I wanted the loop from "user
shakes phone" to "draft PR on my repo" to be under 60 seconds. It mostly is.

Happy to answer architecture / licensing / cost questions. And Mushi-chan is
listening if you break the live demo — she'll classify her own bug reports. 🐛
```

---

## YouTube short script (90s)

Record once. Post as YouTube Short + Bluesky video + X video + LinkedIn native.
Voice-over runs under the same screen-record as the README GIF, longer cut.

> **[0:00]** Sentry catches what your code throws.
>
> **[0:03]** But it can't see *this*. *(cuts to a button click that does nothing)*
>
> **[0:06]** Or this. *(cut to a 12-second loading spinner)*
>
> **[0:09]** Those are user-felt bugs. Your monitoring can't see them. Users just leave.
>
> **[0:12]** I'm Mushi-chan. I fix that.
>
> **[0:15]** Four lines of code. `npx mushi-mushi`. Pick your framework.
>
> **[0:22]** Now the widget's in your app. Users shake their phone — a quiet bottom sheet appears. They type one sentence. I grab the screenshot, console, network, route, and what they were trying to do.
>
> **[0:35]** Server-side, two LLMs. Haiku fast-filters the noise in 200ms. Sonnet classifies the rest — severity, category, component, confidence. All structured JSON. All deduped against the knowledge graph.
>
> **[0:50]** You see the report in the admin in about two seconds. Click Dispatch fix.
>
> **[0:57]** A sandboxed agent opens the PR on your GitHub repo. The Langfuse trace shows you exactly what it thought. You review. You merge.
>
> **[1:10]** Sentry handles the crashes. I handle the friction.
>
> **[1:15]** OSS, MIT on the SDKs. Live demo at kensaur.us/mushi-mushi — no signup.
>
> **[1:22]** Star the repo if Mushi-chan helped. 🐛

---

## Newsletter pitch email

Target: Bytes.dev, Node Weekly, React Status, JavaScript Weekly, TLDR Web Dev,
Console.dev, This Week in Rust (for the `launcher`), The Overflow, Hacker Newsletter.
Personalise the greeting; keep the rest.

```
Subject: Might fit the tools section — a Sentry companion for user-felt bugs

Hi {{name}},

Long-time reader. One pitch, then I'll get out of the way.

I just launched Mushi Mushi — a small OSS bug-reporting tool for the bugs
Sentry can't see (dead buttons, 12-second loads, confusing checkouts). 14 KB
gzipped on the client, 2-stage LLM pipeline on the server, optionally opens
fix PRs on your GitHub repo.

It might fit your "tools" / "new library" section. No budget, not asking for
sponsorship — just a line if you think it's interesting.

The short version, pickable:
> **Mushi Mushi** — shake-to-report widget + LLM classifier + optional auto-fix
> PR. OSS, MIT on the SDKs. Designed as a companion to Sentry, not a replacement.
> Live demo: https://kensaur.us/mushi-mushi — Repo: https://github.com/kensaurus/mushi-mushi

Thanks for reading. 🐛

Ken
```

---

## Discord / Slack community drop

Use for the MCP Discord, Claude Code Discord, Supabase Discord, Cursor Discord,
React Discord. Never spam — one per server, in the right channel, only if on-topic.

### MCP / Claude Code Discord

```
(#showcase or equivalent)

If you want your Claude Code / Cursor / Codex agent to triage and auto-fix real
user bug reports, I shipped an MCP server for exactly that: `@mushi-mushi/mcp`.

Tools exposed: list_reports, classify_report, dispatch_fix, run_nl_query,
summarize_intelligence. JSON-RPC 2.0, SEP-1686 Tasks compatible.

It's the glue between a real user's "this is broken" and an agent-opened PR.

OSS: github.com/kensaurus/mushi-mushi
npm: @mushi-mushi/mcp
```

### Supabase Discord

```
(#showcase)

Built a little thing on Supabase I'm proud of — Mushi Mushi, an OSS
user-bug-reporting tool. Stack is 10 Edge Functions (Deno + Hono), Postgres +
pgvector for dedup / knowledge graph, pg_cron for the self-healing pipeline,
Realtime for the live event stream on the /repo page.

Dogfood: we use it on ourselves. Nightly Playwright dogfood runs against the
prod Supabase stack and auto-opens a GitHub issue on regression.

Repo: github.com/kensaurus/mushi-mushi — happy to share any of the schema
decisions. 🐛
```

### Cursor / IDE communities

```
(#community-tools or equivalent)

Small thing I shipped that might be useful: Mushi-chan, an OSS bug-reporting
tool with an MCP server. Your users shake their phone → Cursor can pull the
report, classify it, and open the fix PR without leaving the IDE.

`npx mushi-mushi` to set up the SDK, then point your Cursor MCP config at
`@mushi-mushi/mcp`. 60-second demo: <link> — Repo: github.com/kensaurus/mushi-mushi
```
