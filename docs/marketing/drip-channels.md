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
>   LLM-native classifier, optional auto-fix PRs. MIT SDK / BSL 1.1 server.

### Target list, with order and notes

| Order | List | Category to target | Why |
| --- | --- | --- | --- |
| 1 | [awesome-observability](https://github.com/adriannovegil/awesome-observability) | Feedback / user-experience | Largest fit; observability readers are the primary ICP. |
| 2 | [awesome-self-hosted](https://github.com/awesome-selfhosted/awesome-selfhosted) | Analytics / Error-tracking | Self-host story is strong; BSL server fits their `non-free` tag. |
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

## Community Discords / Slacks

One per week, in the right channel, on a topic the community genuinely cares
about. Never cold. Never spammy. Always the voice from [VOICE.md](./VOICE.md).

| # | Community | Channel | Drop text template |
| --- | --- | --- | --- |
| 1 | [MCP Discord](https://discord.gg/model-context-protocol) | `#showcase` | See [snippets.md](./snippets.md) → "MCP / Claude Code Discord". |
| 2 | [Claude Code Discord](https://www.anthropic.com/claude-code) | `#showcase` | Same template, tweak for Claude Code specifics. |
| 3 | [Supabase Discord](https://discord.supabase.com/) | `#showcase` | See [snippets.md](./snippets.md) → "Supabase Discord". |
| 4 | [Cursor Discord](https://discord.gg/cursor) | `#community-tools` | See [snippets.md](./snippets.md) → "Cursor". |
| 5 | [Reactiflux](https://www.reactiflux.com/) | `#need-help` (helping others) + `#jobs-talk` | Never drop as a post — help people with their React questions, mention the tool only if on-topic. |
| 6 | [Svelte Society Discord](https://discord.gg/svelte) | `#showcase` | Focus on the SvelteKit hook integration. |
| 7 | [Vue Land Discord](https://chat.vuejs.org/) | `#showcase` | Focus on the composable API. |
| 8 | [Langfuse Discord](https://discord.langfuse.com) | `#showcase` | The LLM-as-Judge story. |
| 9 | [r/webdev Discord](https://discord.gg/webdev) | `#showcase` | Light drop, once. |

**Never-spam rules:**

- One drop per server per 90 days, max.
- Always in the explicit `#showcase` / `#share-your-project` channel if it
  exists. If it doesn't, DM a mod and ask where it'd fit.
- After dropping, **stay in the server** for at least a week. Answer three
  questions from other members before you leave.
- Never start a drop with *"Hey everyone!"*. Start with the bug you were
  trying to solve.

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
