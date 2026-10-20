# 0030. An independent Opus review gates merging a cloud agent's pull request

Status: Proposed Date: 2026-10-21

Related: migration `20261021090000_agent_pr_review.sql`, `_shared/fix-review.ts`,
`_shared/fix-review-db.ts`, `agent-pr-review/`, `POST /v1/admin/fixes/:id/merge`,
`POST /v1/admin/fixes/:id/review`, MCP `merge_fix` / `get_fix_timeline`, CLI
`mushi fixes merge` / `mushi fixes review`, `webhooks-github-indexer`
(`pull_request.synchronize`), `POST /v1/admin/projects/:pid/pull-requests/:owner/:repo/:number/merge`,
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
  without a PR, is not queued. A push to a reviewed PR
  (`pull_request.synchronize`) queues a review of the new head, 5 minutes
  later so a burst of pushes is reviewed once. Mushi's own in-edge fix agent
  is not reviewed automatically; any PR can be reviewed on request
  (`POST /v1/admin/fixes/:id/review`, `mushi fixes review`, the console's
  "Review with Opus"), by a non-viewer, at most 3 times an hour per fix, and
  not while a review is queued or running. Re-running a hold on the commit it
  reviewed needs a console session (an API key gets 403
  `RERUN_NEEDS_CONSOLE`), so a key cannot re-roll a hold until it flips.
- **Who reviews it.** Claude Opus 5.5 (`ANTHROPIC_OPUS_LATEST`), at effort
  `medium` (the model's default), with structured output, through
  `claude-messages.ts`, inside the 150 s edge wall clock the repo assumes:
  each call aborts at 100 s with an 8k-token cap (thinking included), and its
  usage is recorded as soon as it returns. It runs on the
  project's own Anthropic key, or its organization's shared one (ADR 0023),
  never the platform key: an unbilled Opus call per agent PR is not a cost
  Mushi absorbs. With no such key the review is skipped and the reason
  stored. The monthly AI budget applies.
- **What it reads.** The report (summary, description, repro steps, Mushi's
  diagnosis), the PR title and description, CI on the head commit as Mushi
  last saw it, and the diff. The diff budget is about 100,000 characters.
  Over budget, every file stays in the list and patches fill the budget
  smallest first, so a one-line change to an auth check is never crowded out
  by a large rewrite; the first patch that no longer fits is cut. The prompt
  says what was left out. Lock files (by exact name) are the only changes
  skipped outright. Build output directories at the repository root
  (`dist/`, `build/`, `vendor/`, …) are listed by name only, but an unshown
  source-like file there (`.go`, `.php`, `.js`, …) still holds the review;
  a `build/` or `vendor/` folder deeper in the tree is reviewed like any
  source. `.mdx` counts as source.
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
    a decision needs the owner, a source file's change was not shown in
    full (left out for size, cut, or sent by GitHub with no patch), or
    GitHub listed only part of the changed files;
  - **at least fix first** when CI failed, the diff removes behaviour, strays
    from the report, has a major finding or high risk, or any other part
    (an image, a cut file list) was not shown.
- **Where it goes.** The review is stored in `fix_reviews` (one row per
  attempt) with the reviewed head SHA, model, tokens, cost and timestamps.
  Project members can read it and only the service role writes it. Each run
  claims the row with a fresh `run_id` and every later write of that run is
  guarded on it, so a run a push or a re-run superseded stores nothing. The
  review adds a `reviewed` event to the fix timeline, posts one PR comment
  that a re-review edits in place (verdict and findings, never the summary or
  report text: a PR can be public, the report is not, so the comment links to
  the report in the console), and is returned by the fix timeline
  (`get_fix_timeline`) with its model-written fields marked untrusted.
- **The merge gate.** Every merge Mushi makes on request goes through one
  helper, `_shared/gated-merge.ts` `gatedMergePullRequest`: the fix merge
  (`POST /v1/admin/fixes/:id/merge`: the console's merge dialog, `merge_fix`,
  `mushi fixes merge`), the console's generic PR merge and the UX-run merge
  (whose PR URL comes from an API-key snapshot). A test fails if any other
  file calls GitHub's merge; the one exception is the SDK upgrade merge,
  whose PR URL the worker writes for its own bump PR. The helper finds every
  review linked to the PR, through any fix attempt whose `pr_url` names it
  and through `fix_reviews.pr_url` (written only by the service role), so a
  caller cannot unlink a held fix; `PATCH /v1/admin/fixes/:id` also refuses
  to change `pr_url`, or a set `commit_sha`, once a PR is attached. It reads
  the latest COMPLETED verdict of each and the PR's head now:
  - a `hold` is a 409 `REVIEW_HOLD`, also while a re-review is queued or
    running, after a re-run was skipped or failed, and when the PR has new
    commits since (a stale hold blocks until a review of the new head
    completes). A re-run never clears a verdict;
  - only a person overrides: `override: true` with an `overrideReason`, from a
    signed-in console session (`authMethod: jwt`) of a non-viewer. An API key
    (the CLI, MCP, CI) gets 403 `OVERRIDE_NEEDS_CONSOLE`; MCP `merge_fix` has
    no override parameter at all. The override and its reason go to the audit
    log. The 409 message never quotes the review;
  - while a fix's first review is still queued or running, an API key gets
    409 `REVIEW_PENDING`; a console user merges after confirming
    (`confirmPendingReview`, audited);
  - `fix_first` and `merge` pass; a verdict about an older commit is "stale"
    and counts as not reviewed; a PR with no review, or one skipped (no key,
    turned off) or failed, merges as today;
  - GitHub is asked to merge only the head SHA the gate saw (`sha`), so new
    commits between the check and the merge are a 409 `HEAD_MOVED`;
  - a review read that fails is a 503 (never merge on an unknown verdict),
    except before the migration, when the table does not exist (42P01 /
    PGRST205) and the PR merges as not reviewed.
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
- **Clearing the verdict on a re-run.** It let anyone who could press
  "Re-run review" turn a hold into "not reviewed" and merge in the same
  minute. The verdict now changes only when a new review completes.
- **Overrides from an API key, the CLI or MCP.** An override is a person
  accepting a risk the reviewer named; an agent holding an `mcp:write` key
  must not be able to take it. Overrides need a console session and a reason.
- **Effort `high` with a 32k-token cap.** It does not finish inside the edge
  wall clock on a large diff, so most of the extra thinking would be cut off
  and billed (about $0.76 a try at the cap). `medium` with an 8k cap fits.

## Consequences

- Cost on the project's key, at Opus 5.5's $4 / $20 per MTok (Claude API model
  table, cached 2026-10-06), thinking counted as output: a typical review
  (5k–15k input, 2k–6k output) is about $0.05–0.18. The worst case per try is
  about $0.30 (the 100k-character diff cap is ~35k input tokens = $0.14, plus
  the 8k output cap = $0.16), and a review can take 3 tries, so about $0.90 at
  worst. A push re-reviews the PR, so an agent that pushes many times costs a
  review per settled push (pushes within 5 minutes collapse into one).
  Reviewing the 45 spend-down PRs would cost about $3–10.
- A held PR can still be merged on GitHub directly. The gate stops Mushi's own
  merge paths, which are the ones spend-down users press.
- A hold on a PR that then gets new commits keeps blocking until the review
  of the new head completes (about 10–20 minutes): a deliberate delay, so an
  agent cannot push its way past a hold.
