# 0033. CI runners are visible, and an infrastructure failure is not a code failure

Status: Proposed Date: 2026-10-21

Related: [Plan 022](../execplans/ci-runners.md), ADR
[0016](0016-mushi-as-the-app-recipe-control-plane.md) (CI is a recipe
element; CI minutes never lead), ADR [0030](0030-agent-pr-review-gate.md)
(review gate reads CI), ADR [0032](0032-review-follow-ups-send-fix-first-prs-back-once.md)
(follow-ups), `_shared/ci-infra.ts`, `_shared/ci-advisor.ts`, `ci-sync/`,
`ci-jobs-collector/`, `webhooks-github-indexer/` (`workflow_job`),
`api/routes/ci.ts`, `packages/cli/src/commands/runner.ts`.

## Context

On 2026-10-21 a self-hosted runner for glot.it was OOM-killed. GitHub
cancelled its job. Mushi treated `cancelled` as a hard CI failure everywhere
(`fix-loop-status.ts` `CI_HARD_FAIL`, `fix-review.ts` `describeCi`
"failed (cancelled)", `FixCiFeedback` danger tone), so the console said the
fix failed, the Opus review held merges, and a follow-up agent was sent to
"fix" CI that never ran. Twenty auto-merge PRs waited behind a queue that no
Mushi surface showed. Mushi already fetched each job's runner and timing to
estimate CI minutes and discarded it.

GitHub's API gives job timing and runner names (Actions: read) and the
runner list (Administration: read), but no reason for a cancel beyond a
check-run annotation ("lost communication with the server") and no host
CPU or memory. Products that show resource use run an agent on the host or
own the VM.

## Decision

1. **Infra is its own verdict.** A job is classified (`_shared/ci-infra.ts`)
   as passed, running, queued, waiting for a runner, runner lost, queue
   expired, cancelled, or code failure. Waiting for a runner, runner lost and
   queue expired are infrastructure: the fix loop says "your fix was not
   tested" with a Re-run, the review gate never holds a merge for them, and
   follow-ups never send an agent to fix them.
2. **Mushi keeps the job data it already reads** (`ci_jobs`, `ci_runners`,
   30 days), from a 10-minute collector over every branch and from
   `workflow_job` webhooks when the App or webhook delivers them.
3. **Host health comes from the host.** An optional `mushi runner heartbeat`
   and runner job hooks push memory, swap, load, OOM kills and runner
   service state (`POST /v1/ingest/runner`, project key). Host ids are
   hashed on the machine. Nothing is required: without them the map is
   built from GitHub data alone.
4. **One CI view** (`/ci` in the console, Portfolio card, MCP
   `get_ci_overview`, `mushi runner status`): hosts → runners → repos → live
   jobs, queue and run times, infra vs code failures, and rule-based advice
   with the evidence for each rule.
5. **`mushi runner add`** sets up a machine as a runner with safe defaults
   (Plan 022 Phase 5).
6. **Positioning holds.** The fix-loop verdict can lead ("your fix was not
   tested — the test machine stopped"). The CI view and runner setup are
   Bucket B, framed as "why your fix is slow to land" (ADR 0016); they do
   not take the hero. Leading with runner minutes would supersede ADR 0016
   and needs the owner's decision.

## Consequences

- Reading jobs needs Actions: read on the token Mushi already uses; the
  runner list needs Administration: read and degrades to runners seen in
  jobs when it is missing (recorded, not retried every tick).
- New tables and one collector add GitHub API calls: bounded per tick and
  per repo, and skipped for repos with no runs in the window.
- A host heartbeat is new data from the user's machine. It carries no file
  contents, environment values or raw machine ids, and is off until the
  user runs the command.

## Rejected

- **Treat cancelled as success.** A person or a concurrency group cancels
  too; only the infra kinds are excused.
- **elkjs for the map.** 1.4 MB for a tree dagre lays out in 40 KB.
- **Reading runner logs or `_diag` files.** They can contain secrets and
  need host access the API key path should not have.
