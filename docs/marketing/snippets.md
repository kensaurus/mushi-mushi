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
> Those are user-felt bugs. Unless a user tells you, error monitoring rarely flags them.
>
> I built Mushi Mushi for those. Open source: MIT SDKs, AGPLv3 server. 🐛
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
> Try it — read a real diagnosis in the read-only demo, no signup: kensaur.us/mushi-mushi/docs/connect
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

One shot, on release R1 "Proof" (see [launch-week.md](./launch-week.md)).
Post on a Tuesday between 12:00 and 17:00 UTC and stay at the keyboard for
the next six hours. The URL is the no-signup demo (`/connect`), never the
repo; if the demo gate has not passed, the URL is the repo and line one of
the README must be `npx mushi-mushi`.

HN removes posts that read as AI-written and downvotes ones that read as
marketing. So: first person, sober, specific, no mascot, no emoji, no
"Mushi-chan". Positioning is ADR 0004 (the bug mediator for AI-built apps),
not v1 ("user-friction layer that complements Sentry").

### Title options (under 80 characters; pick one)

- `Show HN: Mushi Mushi – Open-source bug reports that explain why AI-written code broke`
- `Show HN: I built a bug reporter that gives a plain-English diagnosis for apps Cursor wrote`

### Body (paste as the first comment, not the post body — HN etiquette)

Replace the bracketed numbers with the live ones from
[`scorecard.md`](./scorecard.md) on the day. Never round.

```
Hi HN, I'm Kenji, solo on this.

What it is: a bug-report widget for your app (web, React Native, Capacitor).
A user clicks it or shakes the phone and writes one
sentence. Mushi attaches the screenshot, the console and network tail, the
route and what they did before, then writes a plain-English diagnosis of what
broke and why, scoped to the files involved. The fix prompt lands in Cursor or
Claude Code over MCP; the MCP server needs no LLM key of its own.

Why: I ship apps that Cursor wrote most of. When a user DMs "it's broken", I
lose an afternoon on code I didn't write. I wanted the report to arrive
already explained.

What's open: SDKs are MIT, the server is AGPLv3, self-hosting is one command.
The hosted free tier is 50 diagnoses a month, no card.

How it differs from what you already use, as far as I can tell:
- Sentry starts from what the code threw (it also has a User Feedback widget and
  replay); Seer, its AI debugging agent, is an add-on to the Team, Business
  or Enterprise plan at $40 per active contributor per month, and isn't in
  Sentry self-hosted. Mushi's diagnosis is on every plan, and a Sentry
  issue-alert webhook feeds Mushi if you want both.
- PostHog gives you replay plus error tracking, a "Fix with AI" prompt on
  each error, and a beta that opens draft PRs for recurring errors (3 a month
  free, then $15 each). That starts from the exceptions it captured. Mushi
  starts from what a user reported, with their screenshot, and pulls the fix
  context into Cursor or Claude Code over MCP.
- Jam.dev is a human recording a bug in Chrome for a team. Mushi is the end
  user reporting from inside the app, plus the diagnosis.

Honest state: [9] signups in five months, [0] external projects that have
sent a report. Every diagnosis in the database is from my own apps. What I'd
like tested is diagnosis quality on a repo I've never seen: install it,
file a report against something you know is broken, tell me where the
diagnosis was wrong.

Demo, no signup: https://kensaur.us/mushi-mushi/docs/connect
Install: npx mushi-mushi
Repo: https://github.com/kensaurus/mushi-mushi
Two-minute video: [link]

Known limits: docs are English only; file references need the repo indexed
first; the free tier caps diagnoses, not reports; the hosted LLM is mine
unless you bring your own key; the native iOS, Android and Flutter SDKs are a
preview that installs from the repo, not from their package registries yet.
```

### Responding in comments

- Reply to every comment within 10 minutes for the first two hours, then
  within the hour. Presence is most of what HN rewards.
- Lead with agreement whenever you can ("You're right that X — here's what I chose…")
- Never use "we". It is one person.
- If someone compares to Sentry — agree, then give the canonical answer: "Sentry is built around what the code threw, with a User Feedback widget and replay alongside. Mushi starts from what the user reported, ingests Sentry's errors too, explains each one in plain English, and hands your agent a fix prompt to start from. One queue, with or without Sentry." Never say "not a replacement" — instead-of or alongside is their call.
- If someone asks about LLM cost — show the real `/health` page numbers.
- If someone asks about users — give the scorecard number, not a feeling.
- Stay for six hours at minimum. Do not resubmit if it falls off.

---

## Reddit — opener per subreddit

Reddit is not a launch channel for us; it is value threads in the two weeks
after the Show HN (release R1) and around Product Hunt (R2). The rules that
matter more than the copy:

- **Thread first, link in the comments.** The post is the useful thing; the
  link is a reply to whoever asks. A link post from a new account is removed
  in most of these subs.
- **One angle per subreddit, never the same text twice.** Check each sub's
  self-promotion rule the week you post; r/lovable and r/boltnewbuilders in
  particular change theirs.
- **No mascot, no emoji, first person.** Same standard as HN.
- **Reply to every comment for 48 hours.** Then leave the thread alone.

### r/cursor — "how I handle 'it's broken' DMs"

```
Title: How I handle "it's broken" DMs for apps Cursor wrote — a report → fix-prompt loop over MCP

Most of my apps are 70-90% Cursor-written. The part nobody warned me about
is what happens after launch: a user DMs "the save button doesn't work", and
I'm now debugging code I've read once, on a device I don't have, from a
one-line description.

What I do now, in order:

1. The app has a bug-report widget. The user writes one sentence; the report
   carries the screenshot, the console/network tail, the route, and the last
   few actions. That alone removes the "can you reproduce it?" round-trip.
2. The report gets a plain-English diagnosis: what broke, why, which files.
   Not a stack trace. For code I didn't write, this is the step that saves
   the afternoon.
3. In Cursor, an MCP server exposes the open reports. I ask "what's broken in
   prod?", it pulls the diagnosis and a fix prompt scoped to the files, and I
   apply it in the same session. No second LLM key for the MCP server.
4. Each merged fix becomes a lesson the agent reads on the next PR, so the
   same bug doesn't come back with the next feature.

Happy to share the MCP config and the diagnosis prompt if useful. What do
other people do with those DMs?

(Disclosure: I built the widget and MCP server in steps 1-4; it's open source. Link in a comment if anyone asks.)
```

### r/ClaudeAI — "a subagent for user bug reports"

```
Title: A subagent that pulls a user's bug report + fix context into Claude Code

I wanted Claude Code to start from the answer instead of the question when a
user reports a bug. So I wrote a subagent that, given a report id, pulls the
user's sentence, the screenshot description, the console/network tail, the
plain-English diagnosis, the fix context (files + why) and any past lessons
for that component, over MCP, and then proposes the smallest change plus a
test.

Here's the agent definition (paste from plugins/mushi-debugger/agents/mushi-debugger.md):

<paste the file verbatim>

Things I got wrong on the way: giving it the whole repo instead of the fix
context (worse diffs, slower), and letting it refactor. The "smallest change
plus a failing test" instruction did more than any model choice.

Curious how others scope subagents for debugging. Disclosure: I built the MCP
server this agent calls; it's open source. Link in a comment if wanted.
```

### r/lovable and r/boltnewbuilders — "it broke for a real user" (check rules first)

```
Title: Your Lovable app broke for a real user: a debug checklist when you didn't write the code

Sharing the checklist I use when an app I mostly generated breaks for
someone else. None of it needs a tool.

1. Get their exact words and the page. "It's broken" isn't a bug report.
2. Reproduce logged out, in a private window, on their device type. Most
   "works for me" bugs are auth state, a cached build, or an env var that
   only exists locally.
3. Read the FIRST red line in the console, not the last. Copy the file:line.
4. Find that file and ask the agent what the function assumes about its
   inputs. Generated code assumes the happy path it was generated against.
5. Ask for the smallest fix and a failing test. Refuse the refactor.
6. Ship, reproduce again, reply to the user with what changed.
7. Write the cause where the agent will read it next time (a rule file, a
   comment, a lessons file).

The expensive steps are 1-3, and the user can't do them for you. That's the
only place I use a tool: an in-app bug reporter I built (open source) that
attaches the screenshot and console and writes the diagnosis. Link in a
comment if anyone wants it.

What's on your list that isn't on mine?
```

### r/opensource — "the open-core rationale"

```
Title: I MIT'd the SDKs and AGPLv3'd the server (open-core) — here's why

TL;DR: people shouldn't need a license lawyer to embed my widget in their app,
and self-hosters shouldn't fear a future bait-and-switch. So it's MIT on
everything a user installs and AGPLv3 on the server (copyleft; commercial
license available): run it, fork it, build on it, and if you offer a modified
server to others over a network, publish your changes. The only commercial
boundary is a small source-available enterprise edition (SSO, audit export,
region pinning) that a solo builder never needs. Open core like Langfuse and
Supabase, except they chose permissive licenses for the server and I chose
AGPL. Happy to get told I'm wrong.

The tool: an in-app bug reporter for AI-written apps — the user's report
arrives with a plain-English diagnosis and a fix prompt for Cursor / Claude
Code. Repo and demo in a comment.
```

### r/mcp — "receipts, not hype"

```
Title: MCP server that turns a user bug report into a paste-ready fix prompt in your editor — no second LLM key

Been building this in the open for a while, posting the boring parts too.

The MCP server (@mushi-mushi/mcp) exposes report / fix / inventory / setup
tools against your own project's reports. It doesn't bundle an LLM; it calls
the Mushi API with a project MCP key (MUSHI_API_KEY), so no LLM key lives in
the MCP process. Model usage is your project's hosted or BYOK configuration.

End to end: a user clicks the widget or shakes the phone, the report is
classified (severity, component, root cause) and deduped, then you ask your
agent "what's broken in prod?" and it pulls the plain-English diagnosis plus a
ready-to-paste fix over MCP. Optional: dispatch a sandboxed agent to open a
draft PR.

Config schema and smithery.yaml are in the repo so you can see exactly which
env vars it needs before installing anything. Repo + Smithery link in a
comment.

Genuinely curious which MCP server design choices people here have regretted.
Scope creep in tool count is the one I keep fighting.
```

### r/webdev and r/reactjs — journey post #2 only

Do not post product openers here. When journey post #2 ("Show HN, by the
numbers") is live, post it as a text thread with the numbers inline and the
link in a comment. The angle is the data, not the tool.

### Backlog angles (not scheduled; earlier drafts kept in git history)

- r/selfhosted — the one-command self-host story, BYOK, your object store.
- r/javascript — the 60-second video of report → diagnosis → PR.
- r/programming — the architecture write-up (two-stage classification, pgvector dedupe, the weekly judge).
- r/reactnative — shake-to-report with an offline queue for RN / Expo.

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
> Read-only demo (seeded, no signup): kensaur.us/mushi-mushi/docs/connect
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

Sentry is excellent at what your code throws. But nothing throws when a button
looks clickable and does nothing, when the checkout confuses every new user, or
when the layout breaks on one Android. No error, no alert, unless you go
watching replays.

Those are user-felt bugs. Nothing throws, so no error alert fires. Users just leave.

So: Mushi Mushi (虫虫). A 14 KB shake-to-report SDK, a 2-stage LLM pipeline
(Haiku fast-filter → Sonnet with vision + RAG) that classifies and dedupes, and
an optional agentic auto-fix that opens draft GitHub PRs for review. Works with
or without Sentry — errors route into the same queue as user reports.

OSS, MIT on the SDKs, AGPLv3 on the server (open-core, with a small commercial enterprise edition).
Read-only demo with seeded bugs — no signup, one click:

https://kensaur.us/mushi-mushi/docs/connect

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

Read-only demo (seeded, no signup): https://kensaur.us/mushi-mushi/docs/connect
Quick start: `npx mushi-mushi`
Repo: https://github.com/kensaurus/mushi-mushi

If the idea is useful, a star helps the next developer find it. 🐛

— Mushi-chan
```

---

## Product Hunt copy

Product Hunt is release R2 "Found", not launch week. It runs after the Show
HN has been measured, and it carries the HN numbers. Submit at 12:01 am PT on
a weekday; pin the maker comment immediately. No mascot on PH either: the
listing is a credibility artifact, and the reader is deciding whether this is
real.

- **Tagline (≤ 60 chars):** `Bug reports that explain why your AI-built app broke`
- **Topics:** Developer Tools, Open Source, AI
- **Gallery:** the hero GIF from `scripts/marketing/record-readme-gif.mjs`
  first, then three stills from `scripts/marketing/capture-admin-screenshots.mjs`
  (report detail with the diagnosis, the fix prompt in Cursor, the queue).

### Description (items 1, 3 and 4 of the Show HN comment)

```
A bug-report widget for the app your AI editor wrote.

A user clicks the widget or shakes the phone and writes one sentence. Mushi
attaches the screenshot, the console and network tail, the route and what
they did before, then writes a plain-English diagnosis of what broke and
why, scoped to the files involved. The fix prompt lands in Cursor or Claude
Code over MCP, with no second LLM key.

Open source: MIT SDKs, AGPLv3 server, self-host in one command. Hosted free
tier: 50 diagnoses a month, no card.

How it differs:
• Sentry starts from what the code threw (it also has a user-feedback widget); its AI agent (Seer) is a paid add-on
  ($40 per active contributor per month) and is not in Sentry self-hosted.
  Mushi's diagnosis is on every plan, and a Sentry webhook feeds Mushi if
  you run both.
• PostHog gives you replay and error tracking, with AI fix prompts and beta
  draft PRs that start from the exceptions it captured. Mushi starts from
  what the user reported.
• Jam is a teammate recording a bug in Chrome. Mushi is the end user
  reporting from inside the app, plus the diagnosis.

Demo, no signup: kensaur.us/mushi-mushi/docs/connect
Repo: github.com/kensaurus/mushi-mushi
```

### First comment from the maker (item 5 of the Show HN comment, with the HN numbers)

```
Hi, I'm Kenji. One person, no team.

This went on Show HN [N] weeks ago: [N] visitors, [N] signups, [N] projects
that sent a first report. Those are the real numbers, and the next post on
the blog will have the next ones.

What I'd like from PH is the same thing I asked HN for: install it on a repo
I've never seen, report something you know is broken, and tell me where the
diagnosis was wrong. That's the part I can't test on my own apps.

Happy to answer licensing, cost and architecture questions all day.
```

---

## YouTube short script (90s)

Record once. Post as YouTube Short + Bluesky video + X video + LinkedIn native.
Voice-over runs under the same screen-record as the README GIF, longer cut.

> **[0:00]** Sentry catches what your code throws.
>
> **[0:03]** But *this* never throws. *(cuts to a button click that does nothing)*
>
> **[0:06]** Or this. *(cut to a 12-second loading spinner)*
>
> **[0:09]** Those are user-felt bugs. Nothing throws, so no error alert fires. Users just leave.
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
> **[1:15]** OSS, MIT on the SDKs. Read-only demo at kensaur.us/mushi-mushi/docs/connect — no signup.
>
> **[1:22]** Star the repo if Mushi-chan helped. 🐛

---

## Newsletter pitch email

Target: Bytes.dev, Node Weekly, React Status, JavaScript Weekly, TLDR Web Dev,
Console.dev, This Week in Rust (for the `launcher`), The Overflow, Hacker Newsletter.
Personalise the greeting; keep the rest.

```
Subject: Might fit the tools section — one bug queue for user-felt bugs + Sentry errors

Hi {{name}},

Long-time reader. One pitch, then I'll get out of the way.

I just launched Mushi Mushi — a small OSS bug-reporting tool for the bugs
that never throw an error (dead buttons, 12-second loads, confusing checkouts). 14 KB
gzipped on the client, 2-stage LLM pipeline on the server, optionally opens
fix PRs on your GitHub repo.

It might fit your "tools" / "new library" section. No budget, not asking for
sponsorship — just a line if you think it's interesting.

The short version, pickable:
> **Mushi Mushi** — shake-to-report widget + LLM classifier + optional auto-fix
> PR. OSS, MIT on the SDKs. Works with or without Sentry — alerts route into the same queue.
> Read-only demo: https://kensaur.us/mushi-mushi/docs/connect — Repo: https://github.com/kensaurus/mushi-mushi

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
