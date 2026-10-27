# 0050. Code-read audit: a model proposes, a deterministic check files

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation. Date: 2026-10-27

Related: ADR [0048](0048-local-workers.md) (local workers), ADR
[0046](0046-explore-mode-model-drives-code-judges.md) (explore mode: the model
drives, code judges), ADR [0040](0040-site-audit-deterministic-live-site-checks.md)
(site audit: deterministic rules), ADR [0039](0039-better-models-make-mushi-better.md)
(the model is a setting), ADR [0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) (second failure before filing),
`_shared/work-modes.ts`, `api/routes/work-audit.ts`, `api/routes/work.ts`,
`packages/cli/src/worker/audit.ts`, migration `20261027180000_worker_modes.sql`.

## Context

On 2026-10-26 a script on the owner's machine (`audit-loop.mjs`) audited one
app screen by screen. Grok read a screen in ask mode and proposed bugs with
file:line evidence. Opus checked each one, and what Opus confirmed was filed
into the app's lane queue. Two lessons:

- One model call hung for 51 minutes until the call was wrapped in
  `timeout -k 30 900`: the agent's child process kept the output pipe open.
- A model reviewing a model over-reported. Grok's self-review confirmed
  findings that were not real, and Opus confirming them did not make them
  reproducible. A report a person cannot reproduce costs a fix agent run and
  a review.

## Decision

- **A lane mode `audit`** (`work_lanes.mode`). An audit claim
  (`kind = 'audit'`) holds no report. A lane runs one pass at a time,
  whatever its concurrency: the pass owns the lane's worktree and its list
  of screens done.
- **A cheap model proposes.** The lane's model, in read-only ask mode, reads
  one screen (or, in an app without page folders, one UI file) and the
  files it imports. It proposes up to 3 findings. Each must:
  - cite `file:line` and quote the code on that line;
  - name a check from a closed set:
    - `pattern`: a regex of at most 200 characters, with no backreference
      and no repeated quantified group, matched on one file within 3 lines
      of the cited line, `present` or `absent`;
    - `script`: one of the repo's own package scripts (`lint`, `typecheck`,
      `test`, `check`), which must fail and print the file's path and the
      expected text.

  The model never writes a command.
- **The worker reproduces, with no model.** The quote must be on the cited
  line (±2) of the default branch. The check must reproduce: at most one
  script run per pass. A finding that fails either is dropped.
- **A second model may only veto.** The lane's `review_model` (optional; set
  on the Workers tab, sent in the claim, never a heartbeat verb) reads a
  reproduced finding. Only an explicit `"veto": false` lets it through; no
  answer counts as a veto. It can never confirm a finding the check did not
  reproduce.
- **Filing** (`POST /v1/worker/claims/:id/findings`, the claim's own worker
  key):
  1. The finding is parsed field by field (repo-relative paths only, no
     `..`).
  2. It is screened like a review finding before it can reach a fix agent:
     no instruction to a model, nothing about CI or secrets, nothing to
     run, no foreign URL.
  3. It is deduped by file + rule + the first 16 hex of sha256 of the
     evidence line, whitespace-normalized and computed by the server
     (`code_audit_keys`, unique per app). An open or dismissed report blocks
     a refile; a fixed one may be filed again when the same evidence is
     still there.
  4. It is capped: `AUDIT_FINDINGS_PER_HOUR` (12) per app, under the shared
     `FILED_REPORTS_PER_HOUR` (30) so people can still file, then the plan
     quota.
  5. The report is stored with `source = 'code_audit'`, status `new`, and
     goes through triage like any report. The report says which check
     reproduced it.
  6. When a `fix` lane for the same app runs on the same machine, the report
     goes into that lane's queue.
- **No hang:** every model call has a 15-minute deadline. The CLI's
  `runProc` answers 30 s after the process exits even when a child it
  started keeps the output pipes open.

## Consequences

- An audit's report is one a person can reproduce from its text: the line,
  the code there, and the check.
- An audit costs the lane's model credits, on the owner's machine; the
  hourly cap and the lane's stop date bound it, and a cap reached stops the
  claims before a model runs. Findings the cap held back wait in the lane's
  cache and are filed first next time.
- Pattern checks can be weak (a missing `aria-label` near a line is a real
  signal, a missing word is not); the veto and the dedupe limit the cost of
  a weak one, and the fix agent and the Opus review still stand between a
  report and a merge.

## Rejected

- **A model confirming a model** (`audit-loop.mjs`'s Opus check as the
  gate). It over-reported; a confirmation is not a reproduction.
- **Running a command the model writes.** A repository is untrusted input to
  the model; a command it writes could do anything on the owner's machine.
  The checks are a closed set the worker implements.
- **Filing every proposal and letting triage sort it.** Triage costs a
  diagnosis per report and the fix lane would spend runs on noise.
