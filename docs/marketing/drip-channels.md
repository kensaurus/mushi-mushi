# drip-channels.md — the slow, permanent floor-raisers

Launch week is a spike. These channels don't spike — they permanently raise
the floor. None of them individually moves the needle. All of them together,
compounded across six months, is more stars than the launch.

Every research source says the same thing: **open-source projects that keep
getting mentioned in ambient developer places beat the ones that only have a
launch moment** (AFFiNE, PostHog, Supabase growth retros).

Do one line from this file every weekday. Not more. Not fewer.

---

## Awesome-lists PRs

Awesome-lists are curated GitHub READMEs that developers genuinely browse.
Getting included is a permanent trickle of qualified stars.

**Process (one list per day):**

1. Open an **issue** first, not a PR. Research (the PostHog team's approach)
   says signaling respect gets PRs accepted 2–3× more often. Title:
   *"Would a Mushi Mushi entry fit here?"*. Body: the one-line description,
   the category you think it fits, a link to the live demo, and *"happy to
   open the PR if this is welcome"*.
2. Wait 2–3 days for maintainer reply.
3. If yes, open the PR in alphabetical order within the category, following
   the list's existing formatting exactly.
4. If silence, gentle bump after 5 business days, then move on. Don't nag.
5. Never open parallel PRs on multiple lists in the same week — it looks
   like a campaign, which it is, but it shouldn't look that way.

**The entry**, reuse across all lists:

> - [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) — User-friction
>   intelligence layer that complements Sentry. Shake-to-report widget (14 KB),
>   LLM-native classifier, optional auto-fix PRs. MIT SDK / AGPLv3 server (open-core).

### Target list, with order and notes

| Order | List | Category to target | Why |
| --- | --- | --- | --- |
| 1 | [awesome-observability](https://github.com/adriannovegil/awesome-observability) | Feedback / user-experience | Largest fit; observability readers are the primary ICP. |
| 2 | [awesome-self-hosted](https://github.com/awesome-selfhosted/awesome-selfhosted) | Analytics / Error-tracking | Self-host story is strong; AGPLv3 server qualifies for the main (free/OSS) list, no `non-free` tag needed. |
| 3 | [awesome-devtools](https://github.com/Alan-FGR/awesome-devtools) | Monitoring / Debugging | Clear fit. |
| 4 | [awesome-react](https://github.com/enaqx/awesome-react) | Performance / Debugging tools | Our React SDK is the polished flagship. |
| 5 | [awesome-vue](https://github.com/vuejs/awesome-vue) | Dev-tools | We have `@mushi-mushi/vue` + composable support. |
| 6 | [awesome-svelte](https://github.com/TheComputerM/awesome-svelte) | Utilities / Debugging | We have the SvelteKit hook integration. |
| 7 | [awesome-llm-ops](https://github.com/tensorchord/Awesome-LLMOps) | Monitoring / Observability | The Judge + Langfuse angle. |
| 8 | [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Developer Tools | `@mushi-mushi/mcp` is a real MCP server. |
| 9 | [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Integrations | The auto-fix workflow pairs with Claude Code. |
| 10 | [awesome-supabase](https://github.com/lyqht/awesome-supabase) | Apps built on Supabase | We're entirely Supabase-backed. |
| 11 | [awesome-react-native](https://github.com/jondot/awesome-react-native) | Debug / Analytics | Our RN SDK is MIT and well-maintained. |

**Pin it to a contributor-friendly issue** on your repo titled
*"Good first issue: Submit Mushi to an awesome-\* list"*. Community members
love closing these and it distributes the load.

---

## Newsletter submissions

Free for devtools. 100% of these accept unpaid submissions for genuinely
interesting tools — you just have to ask, politely and succinctly. Use the
newsletter template from [snippets.md](./snippets.md).

**Target list, with submission URL / email:**

| # | Newsletter | Submit via | Audience | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Bytes** (bytes.dev) | [bytes.dev/submissions](https://bytes.dev/submissions) | JS / TS devs, ~200k | Casual tone — matches Mushi-chan perfectly. Highest-value JS newsletter. |
| 2 | **Node Weekly** | [cooperpress.com/publications/](https://cooperpress.com/publications/) contact | Node devs, ~70k | Clean, editorial. Pitch the `@mushi-mushi/node` middleware. |
| 3 | **React Status** | same cooperpress contact | React devs, ~70k | Pitch the React SDK + the `@mushi-mushi/mcp` for Cursor crowd. |
| 4 | **JavaScript Weekly** | same cooperpress contact | Broad JS, ~150k | The biggest. Pitch after traction on smaller ones. |
| 5 | **TLDR Web Dev** | [tldr.tech/webdev/submit](https://tldr.tech/webdev/submit) | Short-form readers, ~100k | One-line + link format fits us. |
| 6 | **Console.dev** | [console.dev/submit](https://console.dev/submit) | OSS devtool readers | Exact-fit audience. |
| 7 | **Hacker Newsletter** | [hackernewsletter.com](https://hackernewsletter.com) (@kalenkazu) | HN curators | Mentions re-surface the Show HN. |
| 8 | **The Overflow** (Stack Overflow) | editor contact | Broad, ~500k | Harder to land; try after 500 stars. |
| 9 | **Pragmatic Engineer** (Gergely) | [pragmaticengineer.com](https://pragmaticengineer.com) contact | Senior eng, ~500k | Paid newsletter; mention is rare but durable. |

**Pitch priority:** submit the first 6 in the week *after* launch (while the
numbers are fresh), hold 7–9 for post-500-star traction.

---

## Community home: GitHub Discussions (the Monday ritual)

Decided 2026-09-20 (`docs/plan-gtm.md`, Workstream C §6): the community
lives in [GitHub Discussions](https://github.com/kensaurus/mushi-mushi/discussions),
not Discord. Discussions are indexed by Google and by the answer engines
that developers now ask first, they work asynchronously for a solo
JP-based maintainer, and Langfuse grew a 1,400-thread community the same
way. The Discord server stays as an unpromoted link; nothing is scheduled
there.

**Every Monday, 20 minutes:**

1. **Answer everything.** No thread older than a week without a reply from
   the maintainer. A short "looking at this" is a reply.
2. **Turn the week's support into Q&A.** Each support email or DM that had
   a reusable answer becomes a Q&A thread, with the sender's permission and
   their name removed. The answer is written once and linked forever.
3. **Post "This week in Mushi" in Announcements.** Five lines: what shipped,
   the activated-projects number from [`scorecard.md`](./scorecard.md), one
   thing that broke, one thing coming, one thread worth reading.
4. **Keep "Show and tell: your first report" pinned.** Ask new projects to
   post a screenshot of their first diagnosis. That thread is the proof page
   the landing does not have yet.

**Links that point here:** README → Community, `CONTRIBUTING.md` → Questions,
`.github/ISSUE_TEMPLATE/config.yml` contact link, the docs roadmap page.
Issues stay for bugs; the SLA is a first reply within 24 hours on weekdays.

**Other people's Discords** (MCP, Claude Code, Supabase, Cursor, Svelte, Vue,
Langfuse): the drop templates in [snippets.md](./snippets.md) still exist,
but nothing is scheduled. If you use one: once per server per 90 days, in
the `#showcase` channel, start with the bug you were solving, and stay a
week to answer other people's questions.

---

## GitHub Issues — the ambient marketing channel

Adjacent repos regularly have issues like *"how do I capture user
reports?"* or *"any alternative to [tool]?"*. A thoughtful one-liner there
is better than any paid ad, but it has to be genuinely useful — not a plug.

**Search queries to save as GitHub bookmarks:**

- `is:issue is:open "user feedback" label:question`
- `is:issue is:open "shake to report" language:typescript`
- `is:issue is:open "bug report widget"`
- `is:issue is:open repo:getsentry/sentry-javascript "user feedback"`
- `is:issue is:open "how to capture user reports"`

**Template for a helpful reply:**

```
Not a Sentry thing (and you probably know that), but Mushi Mushi was designed
for exactly this — shake-to-report widget + LLM classification, drops into
React with:

    import { MushiProvider } from '@mushi-mushi/react'

    <MushiProvider config={{ projectId, apiKey }}>
      <YourApp />
    </MushiProvider>

MIT on the SDK, live demo at https://kensaur.us/mushi-mushi if you want to
see it running. Happy to help you get it wired in if you try it and hit a
snag.
```

**Rules:**

- Only comment if the answer is genuinely on-topic. Never drive-by.
- Never comment twice in the same thread unless asked.
- Don't comment on an issue in a direct competitor's repo. That's cheap.

Daily budget: **one** of these, thoughtfully. Five per week compounds.

---

## GitHub Issue hygiene on *our* repo

The fastest way to lose a potential user is an unanswered issue from six
months ago. Even a simple *"looking at this 🐛"* within 24h is enough.

**SLA we commit to (put this in CONTRIBUTING.md):**

- First response within **24 hours** on weekdays, **48 hours** weekends.
- Weekly triage sweep (Sunday evening, 15 minutes) — label everything
  un-labeled, close stale `needs info` that haven't replied in 14 days
  (with apology + offer to re-open).
- **"Looking at this 🐛"** is enough. It signals the repo is alive. Full
  investigation follows when you have time.
- Never close without explanation. Even *"this is out of scope right now,
  putting on backlog"* is better than silence.

**Issue templates** to have in `.github/ISSUE_TEMPLATE/`:

- `bug_report.yml` — with a `projectId` field (optional) so we can look at
  the submitter's real reports if they say yes.
- `feature_request.yml` — with a "what user problem does this solve?" field.
- `classification_feedback.yml` — special template for "the classifier got
  this wrong" which feeds the Judge prompt's A/B dataset.

---

## The once-a-week ritual

Friday, 4pm, 30 minutes:

1. Open all five `awesome-*` list tabs you've submitted to. Bump any open
   PR that hasn't been reviewed in 7+ days (polite, one line).
2. Check the repo's Issues tab. Make sure nothing is older than 24h without
   a reply.
3. Run one search from the GitHub-Issues section above. Leave **one** helpful
   comment.
4. Open [dev.to dashboard](https://dev.to/dashboard) — check which posts
   are still trickling views. If one is over-indexing, queue a follow-up.
5. Check [newsletter subscriptions](https://dev.to/dashboard/following) you've
   pitched to — if they published about you, send a thank-you reply (genuine).

30 minutes. Every week. Compounds.
