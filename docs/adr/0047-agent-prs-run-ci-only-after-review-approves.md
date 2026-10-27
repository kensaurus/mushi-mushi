# 0047. Mushi's own PRs run the host's CI only after the review approves them

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation ("decide for me please"). Date: 2026-10-27

Related: ADR [0030](0030-agent-pr-review-gate.md) (Opus PR review gate), ADR
[0044](0044-release-trains-batch-approved-fixes.md) (release trains; its
2026-10-26 amendment readies approved drafts), ADR
[0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md) (the
`mushi-verify` workflow), `fix-worker/`, `agent-pr-review/`,
`_shared/verify-workflow.ts`, `docs/templates/mushi-verify.yml`.

## Context

Every pull request a host repo runs CI on costs Actions minutes, and most
host repos are private, so the owner pays per minute. In October 2026,
glot.it opened 388 PRs (343 by agents), merged 54 and closed 189 without
merging. Each of those 189 still paid for a full CI run.

The local fix lanes were already cheap. `mushi work` opens drafts, the host
repos skip CI on drafts, and the merge queue readies an approved draft once
per repo per tick (ADR 0044 amendment). Cloud-agent PRs are readied by
`agent-pr-review` after its verdict.

Two Mushi paths still paid for CI before anyone had approved the change:

- **fix-worker** opened its PR and readied it at once whenever the model's own
  self-check passed (`markReady: fixReviewPassed(fix)`). CI ran before any
  independent review. Nothing queued an Opus review for these PRs at all; only
  cloud-agent PRs were reviewed automatically.
- **The `mushi-verify` workflow** Mushi hands to host repos triggered on
  `opened`, `synchronize` and `reopened`. That included drafts, release-train
  branches (`mushi/train/*`), whose members were each proven on their own PR,
  and revert PRs (`mushi/revert-*`), which put back code that was already on
  the default branch. glot.it ran it 339 times in October.

## Decision

- **fix-worker always opens a draft PR** and queues the Opus review
  (`enqueueFixReview`) as soon as the attempt is recorded.
- **`agent-pr-review` readies a fix-worker PR** (agents `claude_code`,
  `rest_fix_worker`, `llm`) only when all of these hold:
  - the verdict is `merge`;
  - the model's own check passed (`fix_attempts.review_passed` is not
    false), so a flagged fix stays a draft for a person, as before;
  - the reviewed commit is still the PR's head. The worker reads the PR
    again just before readying it. A push during the review re-queued it,
    and the next review decides about the new head.

  It records the fix event "Marked ready after review; CI runs now". A
  `fix_first` or `hold` verdict leaves the PR a draft.
- **No review possible.** When the review is skipped because review is off,
  the project has no Anthropic key of its own, or its AI budget is used up,
  and the PR has no verdict on record yet, the model's self-check alone
  decides, as it did before this ADR. The event reads "Marked ready without
  an Opus review; CI runs now". A PR is never stranded as a draft because a
  project cannot pay for a review, and a recorded `hold` is never undone.
- **Cloud-agent PRs follow the same rule.** Before this ADR they were also
  readied on `fix_first`; now only `merge` readies them, with the same
  current-head check.
  - A `fix_first` head is about to be replaced: its review follow-up (ADR
    0032) pushes a new commit, which is reviewed again.
  - Nothing reads CI on a `fix_first` head. The findings follow-up sends the
    review's findings, not CI results. The CI-repair follow-up (ADR 0032
    amendment) starts only from a `merge` review whose head is red. The
    `fix-verifier` gates start from a `merge` review too. The merge queue
    readies an approved draft itself (ADR 0044 amendment).
- **The `mushi-verify` template:**
  - adds `ready_for_review` to its triggers;
  - runs its job only when `github.event.pull_request.draft == false`;
  - skips head branches starting with `mushi/train/` or `mushi/revert-`.

  The template and its generator (`_shared/verify-workflow.ts`) stay byte
  for byte equal.
- **Workflow fixes Mushi proposes** (the CI cost "Open fix PR",
  `_shared/ci-cost-fix.ts`) are also opened as drafts for a person to
  review, and refuse in plain words where the edit could do harm:
  - **skip_drafts** never skips a job that produces a required status check:
    a skipped check reads as passing and would let a draft merge untested.
    That job keeps running and fails at a first step named exactly "Draft
    PRs run no CI" (the host repos' pattern, which `review-followup.ts` and
    `merge-queue.ts` recognise). It refuses when the required checks cannot
    be read, when such a job calls another workflow, and when it waits on
    jobs without running anyway (`always()`).
  - **ignore_docs_paths** refuses on a workflow that produces a required
    check or has a job that looks like one, when the required checks cannot
    be read, and when an event already lists `paths` (GitHub rejects
    `paths` with `paths-ignore`). The path list is one exported constant,
    `DOCS_PATHS_IGNORE`.
  - **add_concurrency** refuses on a workflow that deploys or releases (its
    name, file, jobs, steps or deploy commands). Elsewhere only pull request
    runs share a group and cancel; every other run gets its own group, so a
    push to the default branch is never cancelled or dropped from the queue.
  - **weekly_cron** refuses on a workflow that deploys or releases (some
    daily schedules drive staged rollouts), and the PR says what the
    schedule was.

## Consequences

- An agent PR nobody approves runs no host CI. The first CI run is on a
  commit Opus already said to merge.
- Projects with an Anthropic key now pay for one Opus review per fix-worker
  PR (worst case about $0.30 a try, ADR 0030). That is spent on a review the
  merge gate needs anyway before any Mushi merge.
- A fix-worker PR shows as a draft on GitHub for the length of one review
  tick (every 10 minutes) before it is readied.
- The merge queue still readies an approved draft itself (ADR 0044
  amendment), and the console merge still re-readies one
  (`mergeGithubPullRequest`). Either way, a draft that the review missed
  still reaches CI once someone queues or merges it.
- Hosts must update their copy of `mushi-verify.yml` to get the skips. The
  copy Mushi serves (`mushi verify workflow`, the console's PR button) has
  them.

## Rejected

- **Ready on the model's own check (the old behaviour).** The model grading
  its own fix is not independent, and CI ran on PRs that were then closed.
- **Ready on `fix_first`** (what cloud-agent PRs did before). Its findings
  mean the code will change, so CI on that head is spent on a commit nobody
  will merge.
- **Leave drafts stranded when no review can run.** That would make fix-worker
  unusable for projects without an Anthropic key, for a saving the project
  never asked for.
- **Path filters on the verify workflow instead of branch skips.** A release
  train carries real code changes, so a path filter would still run it.

## Amendment (2026-10-27): one draft PR per repo for "Apply to every app"

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's
delegation ("decide for me fully, stop asking").

### Context

The CI cost "Open fix PR" opens one draft PR per workflow edit. A repo with
four advised fixes got four pull requests. Each one ran the repo's CI once
when it was readied, and each needed its own review and merge. The owner pays
per Actions minute and asked for batched releases (one PR, one CI run). There
was also no way to act on the advice across every app at once.

### Decision

- **A bundle is one draft PR for several fixes in one repo.** It is the
  `ci_cost_fix_jobs` rows that share a new `bundle_id` column. There is no
  parent table. Each row is still one workflow file and one kind, and keeps
  its own status, summary, refusal and measurement. Every row that made it
  into the PR carries the same `pr_url`, so the single "Open fix PR" sees
  that edit's PR as open and does not open a second one.
- **`ci-cost-fix-worker` runs a bundle** with `{ bundleId }`
  (`_shared/ci-cost-fix-bundle.ts`):
  - it claims all queued rows of the bundle in one guarded update;
  - it reads the repo, token, default branch and required checks once;
  - it reads each workflow file once and applies its kinds in
    `CI_COST_FIX_KINDS` order, each on the previous output;
  - every refusal of `applyCiCostFix` still applies per item. A refused or
    already-applied item ends `refused` / `no_change` and is listed under
    "Not changed" in the PR body and in the result. It is never dropped;
  - when nothing changed, no PR is opened;
  - the PR has one `ci:` title, a section per workflow with each change's
    summary and reason, and the workflow's 14-day minutes;
  - the branch name comes from the bundle id. A run reclaimed after a lost
    finish pushes to the same branch and reuses its PR.

  A bundle row is never run on its own: the single-job claim skips rows with
  a `bundle_id`.
- **Measurement stays per workflow and is never doubled.** When two kinds
  change the same file in one PR, the first stores the workflow's baseline
  and measured minutes. The other stores none, and its summary says it is
  measured with the first. The bundle read fetches the PR from GitHub once
  for all its rows.
- **"Apply to every app"** (`api/routes/ci-cost-fix-bundle.ts`, in
  `api-ext`):
  - `GET /v1/admin/ci/cost-fix-rollout` previews every advice item that
    carries an `autofix`, for the apps the caller may change (viewers' apps
    are left out). Items are grouped per app and repo, with the estimated
    saving per item and per repo. An unpriced item stays null, never $0.
    An edit whose PR is open or in flight is marked so. The preview reads
    the advisor's own gating, so it only lists edits the worker is expected
    to make.
  - The preview carries `GITHUB_WORKFLOWS_WRITE_MISSING` per repo when Mushi
    already knows the token cannot edit workflows: from the setup check's
    probe (a cache-only read, never a new probe) or from the repo's last
    attempt. Mushi never writes to find out.
  - `POST` the same path opens one bundle per repo: at most 10 repos and 20
    items each. The server rebuilds the advice and queues only items it still
    advises; evidence and saving come from the server, never the client. It
    skips an edit whose PR is still open or that is in flight, and says why
    per item. Each bundle takes one token of the project's existing 10 CI fix
    PRs an hour, and the one-in-flight index still holds per item.
  - `GET /v1/admin/ci/cost-fix-bundles/:id` reads a bundle: its PR, each
    item's state, and the measured saving after the merge.
- **Surfaces.** The console CI page has "Apply to every app" next to the
  advice: a preview with checkboxes, one confirm, then each repo's PR or
  refusals. The CLI has `mushi runner fix --all` (preview), `--all --apply`
  and `mushi runner fix-status --bundle`. The MCP tools are
  `preview_ci_cost_fix_rollout`, `apply_ci_cost_fix_rollout` and
  `get_ci_cost_fix_bundle`. The single "Open fix PR" is unchanged.

### Consequences

- A repo with N advised fixes costs one CI run and one review, not N.
- One refusal no longer blocks a repo's other fixes, and it stays visible
  in the PR.
- A bundle PR is larger to review than a single fix. Each change has its
  own section, and a person can still untick fixes before opening.
- The migration (`bundle_id` + a partial index, additive) must be applied
  before `api-ext` and `ci-cost-fix-worker` are deployed: job reads now
  select the column.

### Rejected

- **A parent `ci_cost_fix_bundles` table.** It would duplicate the PR fields
  the rows already carry, and add a second status to keep in step. The
  bundle's state is derived from its rows.
- **One PR per app instead of per repo.** An app can span repos, and a PR
  lives in one repo.
- **Trusting the client's evidence and saving.** The preview could be stale
  or edited. The server rebuilds the advice and opens only what it still
  advises.
- **Probing the token's workflow permission before opening.** GitHub has no
  read for it, and Mushi never writes to check. The preview uses what the
  setup check or the last attempt already learned, and the PR attempt itself
  reports the rest in plain words.
