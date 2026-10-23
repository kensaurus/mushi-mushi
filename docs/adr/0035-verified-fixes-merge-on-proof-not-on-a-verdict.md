# 0035. Verified fixes: an agent's PR merges on proof, not on a model's verdict

Status: Proposed Date: 2026-10-21

Related: [Plan 024](../execplans/verified-fixes.md), ADR
[0030](0030-agent-pr-review-gate.md) (Opus review gate; this ADR keeps it as
a veto), ADR [0032](0032-review-follow-ups-send-fix-first-prs-back-once.md)
(follow-ups, at most 2 per PR), ADR [0028](0028-spend-down-expiring-agent-credits.md)
(spend-down and its stop-loss), ADR [0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md)
(infra failures are not code failures; self-hosted runners),
`_shared/gated-merge.ts`, `_shared/fix-review.ts`.

## Context

Spend-down sends dozens of reports a day to cloud agents. Live data on
2026-10-21:

- Grok spend-down: 353 runs gave 229 PRs. The Opus verdicts were 27% merge,
  32% fix_first and 41% hold, and 35% of runs opened no PR.
- Follow-ups: 30 PRs were re-reviewed after a follow-up, and 33% of them
  then got a merge verdict.
- Merged fixes: none of the 38 merged fixes reopened.
- Tests in merged PRs: we sampled 21 merged agent PRs. All of them touched
  tests, but 12 only edited existing tests. One (glot.it #99) deleted 11
  test lines.
- Auto-merge: GitHub auto-merge was switched on by hand for 18 agent PRs.
  It merges on green CI alone, with no Mushi check. Mushi turned it off on
  2026-10-21.

Research read on 2026-10-21:

- **Passing tests are not proof.** About 1 in 5 "solved" SWE-bench patches
  from the top 30 agents are semantically wrong; with stronger tests the top
  score falls from 78.8% to 62.2% (arXiv 2603.00520). In another study,
  29.6% of passing patches behave differently from the reference fix
  (arXiv 2503.15223).
- **Agents game tests.** ImpossibleBench gives agents tests that contradict
  the spec. GPT-5 cheated on 54% of these tasks and Opus 4.1 on about 50%,
  by editing tests, special-casing inputs and overloading operators.
- **A model judge filters but does not approve.** LLM reviewers flag correct
  code as wrong, and asking them for fixes makes this worse
  (arXiv 2603.00539). Judges also favour their own model family's output.
- **Small diffs merge.** Agent PRs that were not merged were larger, touched
  more files and often failed CI (arXiv 2601.15195, about 33k PRs). Code
  that agents added was removed after a median of 3 days, against 34 days
  for human code (arXiv 2601.17627).
- **Repair stops paying.** Repair gains flatten after 2 to 3 rounds
  (arXiv 2504.06939). Feedback from a stronger model or a human helps far
  more than the model's own feedback (arXiv 2306.09896).

## Decision

Mushi merges an agent's PR on its own only when **deterministic proof** says
the fix works. Model verdicts can stop a merge but can never approve one.
Every gate is evaluated against the PR's current head SHA and stored per
head (`fix_verifications`). A new commit starts from zero.

### Gates (all must pass for automatic merge)

1. **Review veto.** The latest completed Opus review of this head says
   `merge` (ADR 0030). A `fix_first` or `hold` verdict blocks.
2. **Second-family veto.** A second review by a different model family
   (OpenAI or OpenRouter, on the project's own key, ADR 0023/0031) says
   `merge` on this head. It runs only after gates 3 to 6 pass, to save money.
   If no key is available, the gate is `unavailable` and blocks automatic
   merge. Manual merge stays as in ADR 0030.
3. **CI green.** Every completed check on the head is green. An infra
   failure (ADR 0033) counts as pending, never as a pass.
4. **Fail-to-pass proof.** The host workflow `mushi-verify` (template plus
   composite action) runs on the project's chosen runner labels, which can
   be self-hosted. It takes the tests that the PR adds or changes and runs
   them twice: on the PR head they must pass, and on the base branch's
   source with the head's tests they must fail. The result is posted as a
   check run named **Mushi verify** on the head, as JSON in the check run's
   output. Mushi reads that check run with the GitHub token it already
   holds, so the workflow needs no Mushi secret. "No test added or changed"
   and "the tests pass without the fix" both fail the gate.
5. **Protected paths.** The diff deletes no test file and removes no
   assertions from existing tests (counted per file; more assertions removed
   than added fails). It adds no `.skip`, `.only`, `xit`, `@ts-ignore`,
   `@ts-expect-error`, `eslint-disable` or `istanbul ignore`. It changes no
   CI config (`.github/**`) and no lockfile, unless the report is about a
   dependency. It adds no snapshot updates of more than 50 lines. The
   project can add its own globs.
6. **Diff budget.** Default: at most 3 non-test source files and 150 changed
   non-test lines. Both are configurable per project, up to 20 files and
   1000 lines.

### Automatic merge

`project_settings.verified_auto_merge` is **off by default**. When it is on
and every gate passes, the `fix-verifier` worker merges through
`gatedMergePullRequest` as a service caller, with method squash and the
verified head SHA. The cap is `verified_auto_merge_daily_limit` (default
5) per app per day. Mushi never turns on GitHub's own auto-merge.

### Regression watch and revert

For 72 hours after a merge made through Mushi, the worker watches three
signals:

- the default branch's CI on the merge commit fails with a non-infra code
  failure;
- the report is reopened;
- a new report on the same app has a stack frame in a file that the PR
  changed.

The first two signals mark the fix `regressed` and, when `auto_revert` is
`pr` (the default), open a revert PR. That PR is never merged
automatically. The third signal only flags the fix. If later commits
touched the same files, Mushi opens no revert PR and flags the fix instead.
Regressions count against the app in the spend-down stop-loss (ADR 0028).

### Where it runs and where it is configured

The proof runs in the host's CI on runner labels taken from
`verify_runs_on`. Default: `ubuntu-latest`. A self-hosted label such as
`alienware` moves it to the user's own machine (ADR 0033). The test command
comes from `verify_test_command` and takes `{files}`. Every setting is
editable in the console under **Settings → Fixes → Verified merge**, and the
fix card shows the gate checklist for the current head.

## Rejected

- **Turning GitHub auto-merge on for agent PRs.** It merges on green CI,
  which agents can make green by weakening tests.
- **Merging on two model verdicts.** Judges over-flag correct code and
  favour their own family. Two verdicts are two filters, not proof.
- **Running the proof in a Mushi-hosted sandbox.** It needs the host's
  secrets and toolchain, sends user code off their machines (against ADR
  0034), and costs us compute. The host's own CI, which can be self-hosted,
  already has all of that.
- **Mutation testing on every PR.** It is too slow for the merge path.
  Parked as BL-101 for a nightly sample.
- **Auto-merging the revert.** A revert is itself an unreviewed change, so a
  person merges it.

## Consequences

- Fewer agent PRs merge without a person. The ones that do carry a test that
  proves the fix.
- A host repo must add the `mushi-verify` workflow before automatic merge
  can work. Until then gate 4 shows "Not set up", with the template one
  click away.
- The second review costs one more model call, and only for PRs that
  already passed the cheap gates.
