# 0065. Code-audit findings: one report per root cause, a capped backlog, an honest lifecycle

Status: Accepted 2026-11-21 by team-lead (Claude). The owner approved the plan on 2026-11-21. Date: 2026-11-21

Supersedes parts of ADR [0050](0050-code-read-audit.md): the "up to 3 findings per
screen" prompt, the polish pass, the dedupe key as the only identity, and "a fixed
finding may be filed again as a new report".

Related: ADR [0048](0048-local-workers.md) (local workers),
`packages/cli/src/worker/audit.ts`, `packages/cli/src/worker/audit-patterns.ts`,
`packages/cli/src/commands/work-recheck.ts`, `_shared/audit-taxonomy.ts`,
`_shared/work-modes.ts`, `_shared/duplicate-merge.ts`, `_shared/fix-loop-status.ts`,
`_shared/report-sources.ts`, `api/routes/work-audit.ts`, `api/routes/work.ts`,
migration `20261121120000_code_audit_patterns.sql`.

## Context

On 2026-11-21 three apps had 550 open `code_audit` reports: 346 in glot.it, 153 in
Solo Boss and 51 in tsumagoi. The status set counted was new, queued, pending,
submitted, classified, triaged, grouped, reopened, fixing and in_progress. All of
them came from one sweep between 2026-10-29 and 2026-11-04. The owner said: "most
are already fixed or duplicated or bad log … there cannot be 556 right".

What made the count:

- **A quota, not a threshold.** The prompt asked every screen for "up to 3"
  findings. After the first pass, a "polish pass" asked for rough edges. Every
  screen had 1 to 3 findings.
- **No root-cause identity.** The key was file + the model's free-text rule slug +
  a hash of one line. There were 550 open reports and 521 different slugs. One
  missing loading announcement was filed once per screen.
- **A weak `absent` check.** "No `aria-live` near line 14 of `app/pricing/loading.tsx`"
  still held after the shared `RouteLoadingShell` that wraps line 12 gained its
  live region (glot, 2026-10-30, and #935 on 2026-11-12). Each per-page finding
  stayed open.
- **Grouping that only labels.** Similar reports got a `report_group_id`, and every
  one of them stayed open.
- **A lifecycle that recycles.** A fix PR closed without a merge sent the report
  back to `classified` or `new`, so the fix lane claimed it again. 208 of the open
  reports had a fix PR: 0 merged, 120 closed unmerged, 88 open.
- **One number for two things.** Open counts mixed the bugs people reported with
  Mushi's own findings.

Two references show the intended shape:

- **GitHub code scanning** (read 2026-11-21,
  docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support):
  code scanning "uses fingerprints to match results across various runs so they
  only appear once", and `partialFingerprints` are "used to track the unique
  identity of the result … across commits and branches". It is an identity that
  survives edits, not one per line.
- **Sentry issue states** (read 2026-11-21,
  docs.sentry.io/product/issues/states-triage): Resolved is "an issue that's been
  marked as fixed". "A plain Resolve treats any later event as a regression", and
  Regressed is "a resolved issue that's come up again". It is the same issue
  coming back, not a new one.

## Decision

1. **No quota.** The audit asks for 0 to 3 findings and says "return none when
   nothing on this screen would matter to a real user". There is no polish pass:
   every pass asks the same thing. Each finding must carry:
   - concrete evidence (file:line and the code there);
   - what the user sees, at least 10 characters;
   - a severity from the rubric in the prompt (high, medium or low; anything else
     is dropped, never turned into medium);
   - a confidence from 0 to 1.

   The worker drops findings below 0.6, and the server refuses them
   (`AUDIT_MIN_CONFIDENCE`). The cap of 3 stays as an upper bound.
2. **A root-cause identity.**
   - `pattern_key` is the category plus the root.
   - The category comes from a fixed taxonomy of 15 categories plus `other`
     (`AUDIT_TAXONOMY`). It is matched against the rule, the title and the user
     impact together. The worker and the server hold the same table, and a
     parity test keeps them equal.
   - The root is where one fix would land (`patternRoot`). In order:
     - the shared component that the evidence line's own JSX tag renders, with
       imports resolved through `@/`, `~/`, relative paths and one barrel file;
     - every route file of that kind (`app/**/loading.tsx`) for a Next.js or Expo
       Router convention file;
     - the file itself.
   - An `other` finding keeps its rule in the key.
   - Each app has one open report per pattern key. A partial unique index
     (`reports_code_audit_open_pattern_uniq`) enforces it.
   - A new screen with the same key is added to the parent's `affected_screens`
     and counted in `custom_metadata.occurrences`. No new report is filed, and it
     does not count toward the hourly cap (`code_audit_keys.merged`).
   - The old file + rule + evidence-hash key stays, so an exact replay is still a
     duplicate.
3. **An `absent` check follows the wrappers.** The worker resolves the imported
   components whose element encloses the cited line. If one of their files has the
   missing pattern, the finding is not filed. A recheck closes it for the same
   reason (`absentHeldByWrapper`).
4. **Grouping that merges.**
   - An automated report that matches an open report of the same app becomes its
     duplicate child: `dismissed`, `closed_reason = 'duplicate'`,
     `parent_report_id`. It leaves the open count, and the parent counts it
     (`duplicate_count`, `duplicate_ids`).
   - The match needs a similarity of at least 0.9 (`AUTO_MERGE_MIN_SIMILARITY`),
     or the app's threshold if that is higher. Code-audit descriptions share a
     template, so 0.82 is too loose to close a report on.
   - A person's report is never closed this way. It only joins the group.
   - Stage 1 and stage 2 classification no longer set `status` back to
     `classified` on a dismissed report.
5. **An honest lifecycle.**
   - **A fix PR closed without a merge never sends a report to `new`.**
     - A finding Mushi filed itself moves to `triaged` with
       `custom_metadata.fix_rejected {count, pr_url, at}`. The local fix lane only
       claims `classified` and `reopened`, so the report leaves the auto-queue.
     - A person's report goes back to `classified`.
   - **The daily recheck.** Each day the audit lane's claim asks for it
     (`work_lanes.audit_rechecked_at`, every 20 h). The worker reads every open
     code_audit report of its app
     (`GET /v1/worker/claims/:id/recheck`), then runs each one's own check on the
     default branch, wrappers included. It posts the verdicts with the commit sha
     (`POST …/recheck`).
     - A finding that no longer reproduces is closed as `fixed`, with
       `custom_metadata.resolution {kind, sha, base}` and a team note (Sentry's
       Resolved). The kind is `recheck_not_reproduced`, or
       `recheck_wrapper_has_pattern` when only a wrapper has what the check
       wanted.
     - The recheck is recorded as done when the claim is handed out, so a worker
       that never posts one cannot get a pass on every claim.
     - A rejected fix that still reproduces goes back to `classified` once. After
       `FIX_REJECTED_REQUEUE_LIMIT` (2) rejections it stays with a person.
   - **A regression.** When a pattern comes back after its parent was fixed, the
     parent reopens (`reopened`, `custom_metadata.regressed`). No new report is
     filed (Sentry's Regressed).
   - **A dismissal holds.** When a person has dismissed a pattern, its next
     occurrences are duplicates.
   - **No new status.** These states reuse `dismissed`, `duplicate`, `fixed`,
     `reopened` and `triaged`, so `reports_status_check` and every console status
     map stay as they are.
6. **A capped backlog.**
   - Each app may have at most `project_settings.code_audit_open_cap` open
     code-audit pattern parents (default 25).
   - Past the cap, a reproduced finding waits in `code_audit_deferred`, one row
     per pattern ranked by severity × confidence. It is not a report, so it is
     outside every open count.
   - A full backlog stops proposing: the claim says `propose: false`, and the
     pass only rechecks once a day.
   - The recheck hands back the best deferred findings that fit the free slots.
     The worker checks them again on the default branch and files the ones that
     still reproduce.
7. **Separate counts.** Open counts show reports from people and production
   separately from Mushi's own checks (`AUTOMATED_REPORT_SOURCES`, which is the
   console's `check` and `task` source kinds). This applies to:
   - the daily operator digest ("3 open from people, 40 automated");
   - `/mushi status` in Slack ("🐞 3 open bugs (+40 automated)");
   - the console's Reports badge ("untriaged" counts people only;
     `untriagedAutomated` is its own number).

## Dry run, 2026-11-21

`mushi work --recheck --dry-run --json` now prints the pattern plan. The same
functions ran read-only over the 550 open reports, on each repository's
`origin/main`:

- 46 would close as fixed. 29 of those close only because a wrapper around the
  line has the attribute (27 glot loading screens). See Consequences: that live
  region is empty while loading.
- 118 are `present` checks whose code moved away from the cited line but is still
  in the file. 3 more point at files no longer on main. The agent decides on all
  of these.
- The rest collapse into 420 pattern parents. 44 patterns hold more than one
  report, and 84 reports would join a parent.

The full numbers and ids are in the PR, not in this ADR. The collapse is modest:
most of the 312 "repeated" findings sit in per-page files that share no
component. They are the same kind of problem, but not one fix. With a cap of 25
per app, 75 would stay open and 345 would wait as deferred findings.

## Consequences

- An app's open code-audit count is bounded (25 by default) and means distinct
  root causes, not screens. The hourly cap (12) still bounds the rate.
- A finding needs a confidence. A worker older than this ADR sends none, and its
  finding still files: the score counts it as 0.7, and the floor does not apply.
- The per-screen detail moves into `affected_screens`. A fix for a pattern parent
  must cover every screen listed there.
- The taxonomy is a regex table. A category it misreads only changes which parent
  a finding joins, never whether it is filed. The table and its tests are the
  place to correct it.
- **The wrapper rule is only as good as the check's regex, and this is an open owner decision.**
  - A wrapper that has the attribute counts as having the behaviour. glot's
    `RouteLoadingShell` has `aria-live`, but its live region stays empty until a
    10 s timeout. A screen reader still hears nothing while the page loads.
  - The worker drops a new finding like that before filing it, so the problem
    cannot come back as a regression either.
  - Closes made this way carry their own resolution kind,
    `recheck_wrapper_has_pattern`. One query finds them, and reopening them
    reverses the rule.
  - The fix for the shell itself (announce while loading, not only on timeout)
    is a code change in the app, not in the audit.
- **An older worker against this server.**
  - It never posts the recheck, so the claim records the recheck as handed out.
    An app at its cap then gets at most one pass per 20 h, not one per claim.
  - Its findings land in `code_audit_deferred`.
  - Upgrade the daemon soon after the deploy.

## Rejected

- **A server-side scheduled recheck over the GitHub contents API.** It would need a
  Deno port of the evaluator, import resolution over the API and a token per
  project. The audit lane already has the clone, the evaluator and a lease, so the
  dry run and production run the same code.
- **New report statuses** (`fix_rejected`, `deferred`, `regressed`). Each one would
  touch the status CHECK, the console's status maps and three mirrored open-status
  lists. The existing statuses plus metadata say the same thing.
- **Auto-closing a person's report as a duplicate.** At a 0.82 match, a widget
  report would close under a bot's finding, and its reporter would be told so.
- **One parent per category per app.** That would give 120 parents instead of 420,
  but it would merge unrelated bugs that need different fixes. A category is not a
  root cause.
