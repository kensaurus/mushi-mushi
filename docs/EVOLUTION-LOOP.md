# The Evolution Loop

> *"Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI."*

---

## The thesis

Software today follows a random walk.

A PM writes a spec. A developer implements it. A QA team tests the happy path. It ships. A user hits a dead button on an Android device no one tested. They close the app. The bug lingers for two sprints because nobody filed a ticket.

The vibe-coding era made this worse, not better. AI agents can now build and ship in hours. But the **choke point moved**: building is easy, observing is hard. Users are reluctant to file bugs. Product managers get in the way of the feedback signal. QA costs money and slows the loop.

The fix is not more process. The fix is **selection with memory**.

Biological evolution solved this problem 3.5 billion years ago: every organism that fails to survive passes that failure forward as selection pressure. The genome encodes what worked and what didn't. Each generation starts from a fitter baseline.

Mushi does the same thing for software:

1. **Capture** — users report friction directly from inside your app (shake to report, no redirect, no Jira). The report includes intent, screenshot, console logs, and network context.
2. **Classify** — AI triages severity, category, and blast radius in under two seconds.
3. **Fix** — an AI agent opens a draft PR against your repo. You merge or ignore. No pager. No shouting.
4. **Verify** — Playwright-based QA stories confirm the fix worked before you merge.
5. **Remember** — the judge scores the fix quality. High-scoring fixes promote a lesson rule into `.mushi/lessons.json`. The next agent inherits the rule and doesn't repeat the mistake.

This is **cumulative selection** applied to software. Each iteration starts from a fitter baseline than the last. The loop is self-reinforcing — not because of magic, but because the failure is recorded, named, and inherited.

---

## The proof

The loop is not aspirational. It runs today, in production, as five Supabase edge functions:

| Stage | Function | What it does |
|-------|----------|--------------|
| Capture + Stage-1 filter | `fast-filter` | WASM-based spam pre-filter; emits structured `stage1Extraction` |
| Classify | `classify-report` | Claude Sonnet 4.6 structured output; severity, category, component, blast radius |
| Fix | `fix-worker` | RAG-grounded diff + draft PR via GitHub REST |
| Verify | `qa-story-runner` | Playwright / Browserbase / Firecrawl story execution |
| Remember | `judge-batch` + `prompt-auto-tune` | Judge scores fixes; disagreement clusters promote candidate prompts |

The lesson library (`packages/mcp/src/catalog.ts` tool `lessons.query`) gives every connected AI agent access to every named failure pattern before it touches a line of code.

---

## The promise

- **BYOK, not black-box.** You provide your Anthropic or OpenAI key. Your prompts run against your account. Mushi never trains on your bug reports.
- **RLS per project.** Every table is row-level-security isolated. Your reports cannot cross project boundaries. Your team's data stays in your org.
- **Your code stays in your repo.** The fix agent reads your codebase via RAG index and writes a draft PR. It does not send your source files to a third party.
- **No Jira required.** No PM bottleneck. No forced testing. Users report, AI fixes, humans merge. The loop is frictionless by design.

---

## Extending the loop with paid testers (Mushi Bounties)

The weakest stage in the loop is capture: your own users are reluctant to
report bugs. Mushi Bounties solves this by adding a motivated human in the
capture stage — a public tester who earns **mushi-points** for every accepted
bug report. Testers browse the marketplace, join an app, submit bugs through
the same pipeline, and redeem points for Mushi Pro credit or gift cards.

The rest of the loop is unchanged: the submission goes through `classify-report`,
a draft PR lands via `fix-worker`, QA stories verify it, `judge-batch` scores
the fix, and the lesson is promoted to `.mushi/lessons.json`. The only new piece
is the human at the front.

See the full concept: [Mushi Bounties — crowd-testing marketplace](../apps/docs/content/concepts/bounty-marketplace.mdx).

---

## Further reading

- [The closed-loop thesis](../apps/docs/content/concepts/closed-loop.mdx) — Black Box Thinking · Antifragile · Cumulative selection
- [Architecture](../apps/docs/content/concepts/architecture.mdx) — how the five edge functions connect
- [Mushi Bounties](../apps/docs/content/concepts/bounty-marketplace.mdx) — crowd-testing marketplace + rewards
- [Security & privacy](../apps/docs/content/security/) — BYOK, RLS, data residency, no-leakage claim
- [Quick start](../apps/docs/content/quickstart/) — running the loop in your app in 60 seconds
