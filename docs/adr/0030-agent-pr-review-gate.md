# 0030. An independent Opus review gates merging a cloud agent's pull request

Status: Proposed Date: 2026-10-21

Related: migration `20261021090000_agent_pr_review.sql`, `_shared/fix-review.ts`,
`_shared/fix-review-db.ts`, `agent-pr-review/`, `POST /v1/admin/fixes/:id/merge`,
`POST /v1/admin/fixes/:id/review`, MCP `merge_fix` / `get_fix_timeline`, CLI
`mushi fixes merge --override` / `mushi fixes review`,
`apps/admin/src/components/fixes/MergeFixPreflight.tsx`; builds on
[0013](0013-cloud-coding-agents-run-through-edge-adapters.md) and
[0028](0028-spend-down-expiring-agent-credits.md).

## Context

Spend-down (ADR 0028) sends dozens of reports a day to Cursor Cloud, running
Grok 4.7 xhigh, and every run opens a pull request. Nothing graded those
patches: `judge-batch` grades triage classification, not code. On 2026-10-20
a human-run Claude review of about 45 of the Grok PRs found roughly 65–70%
mergeable as-is. The rest included a blank page caused by a chunk-miss reload
guard, a PR that removed a "resume lesson" feature and ignored the learner's
level, use of React private hooks, dead code and design-guardrail CI failures,
an app-wide image rewrite with no screenshots, a product decision taken
unilaterally, and four PRs with red CI. The owner asked for "a proper eval
with Opus 5.5". The merge button in the console, `merge_fix` and
`mushi fixes merge` would merge any of them.

## Decision

- **What gets reviewed.** Every pull request a cloud agent (`cursor_cloud`,
  `github_cloud_agent`) opens is queued for review when
  `applyCloudAgentOutcome` accepts it as a fix. That function is the one path
  shared by `cursor-webhook`, `agent-status-poll` and the GitHub indexer, so
  each PR is queued once. A PR that only adds notes, or a run that ends
  without a PR, is not queued. Mushi's own in-edge fix agent is not reviewed
  automatically; any PR can be reviewed on request
  (`POST /v1/admin/fixes/:id/review`, `mushi fixes review`, the console's
  "Review with Opus").
- **Who reviews it.** Claude Opus 5.5 (`ANTHROPIC_OPUS_LATEST`), at effort
  `high`, with structured output, through `claude-messages.ts`. It runs on the
  project's own Anthropic key, or its organization's shared one (ADR 0023),
  never the platform key: an unbilled Opus call per agent PR is not a cost
  Mushi absorbs. With no such key the review is skipped and the reason
  stored. The monthly AI budget applies.
- **What it reads.** The report (summary, description, repro steps, Mushi's
  diagnosis), the PR title and description, CI on the head commit as Mushi
  last saw it, and the diff. The diff budget is about 100,000 characters.
  Over budget, every file stays in the list and the largest source changes are
  shown first, each cut at 24,000 characters. The prompt says what was left
  out. Lock files and build output are listed by name only.
- **Untrusted input.** The report and the PR are data, wrapped in tagged
  blocks whose closing tags are fenced. Report text goes through
  `sanitizeForLLM`. The diff does not: rewriting code would hide what a
  reviewer must see. Invisible and bidi code points in the diff are shown as
  `[U+XXXX]`, and the prompt tells the model that an instruction found
  inside the diff is a security finding.
- **The verdict.** The verdict is `merge`, `fix_first` or `hold`, with
  `fixes_report`, `risk`, `findings[]` (blocker / major / minor),
  `scope_creep`, `removes_behavior[]`, `needs_human_decision` and `summary`.
  Fixed rules can only raise the model's verdict, so it cannot contradict its
  own fields:
  - **hold** when the diff does not fix the report, a finding is a blocker,
    or a decision needs the owner;
  - **at least fix first** when CI failed, the diff removes behaviour, strays
    from the report, has a major finding or high risk, or was cut to fit.
- **Where it goes.** The review is stored in `fix_reviews` (one row per
  attempt) with model, tokens, cost and timestamps. Project members can read
  it and only the service role writes it. It adds a `reviewed` event to the
  fix timeline, posts one PR comment that a re-review edits in place, and is
  returned by the fix timeline (`get_fix_timeline`).
- **The merge gate.** `POST /v1/admin/fixes/:id/merge`, which the console,
  `merge_fix` and `mushi fixes merge` all call, refuses a `hold` with 409
  `REVIEW_HOLD` unless the caller sends `override: true`. An override is
  written to the audit log with an optional reason. `fix_first` merges after
  the console shows its findings. A PR with no review, or one whose review is
  queued, skipped or failed, merges as today and says "Not reviewed". A
  re-run clears the old verdict, so a stale hold stops gating new commits.
  Spend-down and auto-fix never merge, so they are unchanged.
- **The switch.** `project_settings.agent_pr_review_enabled` is on by default
  and only an owner or admin can change it.

## Rejected

- **Gating on the model alone, without fixed rules.** In the human review, the
  costly misses were self-contradicting answers ("looks good" next to a removed
  feature). The rules make the stored verdict agree with its own findings and
  cost nothing.
- **Blocking `fix_first` too.** Most fix-first PRs are mergeable after a
  look, and a gate people override by habit protects nothing. Only hold
  blocks.
- **Falling back to the platform Anthropic key, or to OpenAI.** The platform
  key would bill the owner for every tenant's agent PRs. A cross-vendor
  fallback would weaken the independent second opinion the gate exists for.
  A skipped review is visible and honest.
- **Reviewing inside `agent-status-poll` or `cursor-webhook`.** An Opus review
  of a large diff takes minutes, so it would hold up polling and run past the
  webhook's response window. A queue drained by its own function, three
  reviews per tick, keeps both fast.
- **Running the diff through `sanitizeForLLM`.** It collapses whitespace,
  decodes base64 and deletes HTML comments, which corrupts code and hides
  hidden-instruction attacks from the reviewer.
- **A per-project review model setting.** Opus 5.5 is the point of the gate.
  The setting is deferred (BL-095) until someone asks.

## Consequences

- An Opus 5.5 review costs about $0.05–0.40 on the project's key: about
  5k–30k input tokens at $4/MTok and 3k–15k output tokens, thinking included,
  at $20/MTok. Prices are from the Claude API model table, cached 2026-10-06.
  The review of the 45 spend-down PRs would cost about $5–15.
- A held PR can still be merged on GitHub directly. The gate stops Mushi's own
  merge paths, which are the ones spend-down users press.
- New commits on a reviewed PR do not trigger a re-review yet. Someone presses
  "Re-run review" (BL-094).
