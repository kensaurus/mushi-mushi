# Plan 024 — Verified fixes: agent PRs merge on proof

Status: `IN PROGRESS` (2026-10-21). Decision record: [ADR 0035](../adr/0035-verified-fixes-merge-on-proof-not-on-a-verdict.md).

## Why

Spend-down and follow-ups produce more agent PRs than one person can read.
On 2026-10-21, 18 glot.it agent PRs had GitHub auto-merge switched on, so
they merged on green CI alone. 12 of the 21 sampled merged PRs only edited
existing tests, and one deleted 11 test lines. Research (ADR 0035) says
three things:

- a passing test suite does not prove a fix;
- agents weaken tests when they can;
- an LLM judge works as a filter, not as an approver.

This plan builds the proof: a test that fails without the fix and passes
with it, rules that stop tests being weakened, a diff budget, a review by a
second model family that can veto, and a regression watch after merge.

## Contracts (all tracks build against these)

### Database (migration `<version>_verified_fixes.sql`)

`project_settings` gets these new columns:

| Column | Type | Default |
|---|---|---|
| `verified_auto_merge` | boolean | false |
| `verified_auto_merge_daily_limit` | int | 5 (CHECK 1..50) |
| `verify_runs_on` | text[] | `{ubuntu-latest}` (each label `^[A-Za-z0-9._-]{1,64}$`, at most 8) |
| `verify_test_command` | text | null (≤ 300 chars; must contain `{files}`) |
| `verify_max_files` | int | 3 (CHECK 1..20) |
| `verify_max_lines` | int | 150 (CHECK 10..1000) |
| `verify_protected_globs` | text[] | `{}` (at most 30, each ≤ 200 chars) |
| `verify_second_judge` | text | `'auto'` CHECK in (`auto`, `openai`, `openrouter`, `off`) |
| `verify_second_judge_model` | text | null |
| `auto_revert` | text | `'pr'` CHECK in (`off`, `pr`) |

`fix_verifications` has one row per (fix attempt, head SHA):

```
id uuid pk, fix_attempt_id uuid fk fix_attempts on delete cascade,
project_id uuid fk projects on delete cascade, report_id uuid null,
repo text (lowercase owner/name), pr_number int, head_sha text not null,
base_sha text null,
gates jsonb not null   -- VerifyGate[] (below)
passed boolean not null default false,   -- every gate status = 'pass'
second_judge jsonb null -- {provider, model, verdict, findings[], summary, input_tokens, output_tokens, cost_usd, at}
auto_merge_state text not null default 'none'
  check in ('none','eligible','merged','skipped','failed')
auto_merge_detail text null,
merged_at timestamptz null, merge_sha text null,
evaluated_at timestamptz not null default now(),
created_at, updated_at,
unique (fix_attempt_id, head_sha)
```

`fix_regressions` has one row per signal after a Mushi merge:

```
id uuid pk, fix_attempt_id uuid fk, project_id uuid fk,
merge_sha text not null,
signal text check in ('ci_failed_on_merge','report_reopened','new_report_in_changed_file'),
detail text, evidence jsonb,
revert_state text not null default 'none'
  check in ('none','pr_opened','not_safe','off','failed'),
revert_pr_url text null, created_at,
unique (fix_attempt_id, signal)
```

`fix_attempts.regressed_at timestamptz null` is set by the first
`ci_failed_on_merge` or `report_reopened` signal.

RLS on both new tables follows `fix_reviews`: members select, service role
writes, nothing else. Add `verified` / `auto_merged` / `regressed` /
`revert_opened` to the `fix_events.kind` check, in the same
drop-and-recreate pattern used by `20261021063310_review_followups.sql`
(NOT VALID then VALIDATE).

### Gate shape (`_shared/fix-verify.ts`, pure)

```ts
type VerifyGateId = 'review' | 'second_review' | 'ci' | 'fail_to_pass' | 'protected' | 'budget'
type VerifyGateStatus = 'pass' | 'fail' | 'pending' | 'unavailable' | 'not_set_up'
interface VerifyGate { id: VerifyGateId; status: VerifyGateStatus; label: string; detail: string; evidence?: Record<string, unknown> }
```

`label` is plain words, for example "Opus review: merge", "Test proves the
fix", "No tests weakened", "Small change (2 files, 48 lines)". `detail` is
one sentence that says what to do when the gate is not `pass`.

`evaluateVerification(input)` returns the gates in this order: review, ci,
fail_to_pass, protected, budget, second_review. `second_review` is
`pending` until the other five pass. Pure functions with unit tests:

- `analyzeDiff(files: PrFile[], opts)`: counts the source and test files
  and lines, test files deleted, assertions removed and added per test file,
  forbidden markers added (`.skip(`, `.only(`, `xit(`, `xdescribe(`,
  `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `istanbul ignore`,
  `# pragma: no cover`, `@pytest.mark.skip`), CI config touched, lockfiles
  touched, snapshot lines and protected globs touched. `PrFile` follows
  GitHub's `GET /pulls/:n/files` (`filename`, `status`, `additions`,
  `deletions`, `patch`). A missing `patch` means the file is binary or too
  large and counts as unreadable: if it is a test file, protected fails.
- `isTestPath(path)`: `__tests__/`, `*.test.*`, `*.spec.*`, `test/`,
  `tests/`, `e2e/`, `*_test.go`, `test_*.py`, `*_test.py`, `*Test.java`,
  `*Tests.swift`.
- `readVerifyCheck(checkRun)`: parses the **Mushi verify** check run's
  `output.text` (JSON, schema below). Unknown or garbage input gives `fail`
  with "could not read result".
- `ciGate(checks)` reuses the infra classification from `_shared/ci-infra.ts`.
  The **Mushi verify** check is excluded from the CI gate.

### Verify check-run JSON (written by the action, read by the worker)

```json
{ "schema": 1, "head_sha": "…", "base_sha": "…",
  "tests": ["src/foo.test.ts"],
  "head": "pass" | "fail" | "error",
  "base": "fail" | "pass" | "error" | "skipped",
  "verdict": "fail_to_pass" | "no_test" | "passes_without_fix" | "fails_with_fix" | "error",
  "command": "pnpm vitest run {files}", "runner": "alienware-glot-1",
  "duration_s": 42, "log_tail": "… ≤ 4000 chars …" }
```

The `fail_to_pass` gate passes only when `verdict = "fail_to_pass"` and
`head_sha` matches the PR head. When no check run exists for the head and
the repo has no `.github/workflows/mushi-verify.yml`, the gate is
`not_set_up`. When the workflow exists, the gate is `pending`.

### Worker `fix-verifier` (cron `4-54/10`, `requireServiceRoleAuth`, `run_id` claim)

1. Pick cloud-agent fix attempts with an open PR whose latest completed
   review has `head_sha` equal to the PR head and no `fix_verifications` row
   for that head yet, or one older than 10 minutes whose gates are not
   final. At most 10 per run, at most 3 per project.
2. Read the PR, its files (paginate, at most 300 files) and the check runs
   for the head. Compute the gates and upsert the row.
3. If gates 1 and 3 to 6 pass, run the second review. Reuse
   `buildReviewPrompt` and `normalizeReview` from `_shared/fix-review.ts`
   with an OpenAI-compatible call, using the resolver order in ADR
   0023/0031:
   - `auto`: `openai`, then `openrouter`;
   - the model is `verify_second_judge_model`, or `gpt-5.4` (OpenAI) /
     `openai/gpt-5.4` (OpenRouter);
   - a project with no key gets `unavailable`;
   - the platform environment key is never used.
4. When everything passes, `verified_auto_merge` is on, today's
   auto-merges for the project are under the limit, and the report is not
   already fixed: call `gatedMergePullRequest` with
   `{ caller: 'service', reason: 'verified_auto_merge', expectedHeadSha }`,
   squash. Then write the outcome to `auto_merge_state` and a fix event.
5. Regression watch: for fix attempts merged through Mushi in the last 72
   hours, read the check runs for `merge_sha` on the default branch. Then
   check two things: has the report been reopened since the merge, and has
   a new report on the project arrived since the merge whose stack frames
   name a changed file?
   - Insert `fix_regressions`.
   - On `ci_failed_on_merge` (non-infra) or `report_reopened`, with
     `auto_revert = 'pr'`: open a revert PR only if no commit after
     `merge_sha` touched any of the PR's files. Otherwise set
     `revert_state = 'not_safe'`.
   - Build the revert from the merge commit's parent tree for those files.
   - Name the branch `mushi/revert-<short>`, and give the PR a body that
     names the signal.
6. The stop-loss (ADR 0028) also counts `fix_attempts.regressed_at` in the
   window as a hold.

Any merge made through `gated-merge` must record which head it merged, so
the regression watch can find `merge_sha`. Use the existing
`finalizeFixMerge` path.

### API (in `api-ext`, which already serves the CI routes)

- `GET /v1/admin/projects/:id/verify-settings` returns the settings above
  plus `workflowInstalled: boolean | null` (read from the primary repo) and
  `secondJudgeKey: { provider, label } | null`.
- `PUT /v1/admin/projects/:id/verify-settings` takes a partial body,
  validated by zod against the bounds above. Console only (jwtAuth,
  non-viewer). Every change is audited.
- `GET /v1/admin/fixes/:id/verification` returns
  `{ headSha, gates, passed, secondJudge, autoMerge: {state, detail}, regressions[] }`
  for the current head. It also rides on
  `GET /v1/admin/fixes/:id/timeline` as `data.verification`.
- `POST /v1/admin/fixes/:id/verify` re-evaluates now. Limit: 6 per hour per
  fix. Non-viewers only.
- `GET /v1/admin/projects/:id/verify-workflow` returns the workflow YAML
  filled in with this project's runs-on labels and test command, for copy or
  for a PR.
- `POST /v1/admin/projects/:id/verify-workflow/pr` opens a PR that adds
  `.github/workflows/mushi-verify.yml` to the primary repo. It uses
  `createPrFromFiles`. Console only.

Surface parity:

- MCP `get_fix_verification` (read) in the catalog and the hosted server.
- CLI `mushi fixes verify <fixId> [--rerun]` and `mushi verify workflow`
  (prints the YAML).
- `scripts/surface-parity.json` entries for both.

### Host side

- `.github/actions/fix-verify/action.yml` (composite) with inputs
  `test-command` (required), `test-globs` (optional) and `base-ref`. It
  works out the changed tests from `git diff --name-status base...head`,
  runs them on head, then restores the base's non-test changed files and
  runs them again. It creates the **Mushi verify** check run with
  `GITHUB_TOKEN` (`checks: write`), with conclusion `success` only for
  `fail_to_pass`. Bash and node only, no new dependencies.
- `docs/templates/mushi-verify.yml` triggers on `pull_request` for
  `cursor/**`, `mushi/**` and `copilot/**` branches. It sets `runs-on:`
  from the project's labels, `permissions: contents: read, checks: write`,
  a 20-minute timeout, and pins actions by SHA as the lockfile template
  does. It never uses `pull_request_target`. (2026-10-27, ADR 0047: it
  also runs on `ready_for_review` and skips drafts, `mushi/train/*` and
  `mushi/revert-*` heads.)

### Console

- **Settings → Fixes → Verified merge** card:
  - the automatic-merge toggle (off by default, with a sentence that says
    exactly when Mushi merges) and the daily limit;
  - runner labels as chips, suggested from the `/ci` runners
    (`GET /v1/admin/ci/overview`), so "alienware-glot-1" or its labels are
    one click away;
  - the test command;
  - file and line budgets;
  - extra protected globs;
  - the second-judge provider, model and key status;
  - the auto-revert setting;
  - workflow status, with "Copy workflow" and "Open a PR that adds it".
- Fix card / fix detail: a gate checklist for the current head (glyph,
  word and label for each gate; "Re-check" button). It shows the
  auto-merge state and any regression with its revert PR link.
- The `/ci` job drawer links a **Mushi verify** job to its fix.

## Phases

- [ ] **0. ADR 0035 + this plan.**
- [ ] **1. Server core.** Migration, `_shared/fix-verify.ts` with tests,
  the `fix-verifier` worker, routes, MCP, surface parity, the stop-loss
  change, and the cron migration.
- [ ] **2. Host side.** The composite action, the template, a CLI command,
  and docs (`apps/docs` page "Verified merge").
- [ ] **3. Console.** The settings card, the gate checklist and the `/ci`
  link.
- [ ] **4. Ship.** Apply the migration live and rename the file to its
  applied version. Deploy `fix-verifier`, `api` and `api-ext`. Add the
  workflow to glot.it on the Alienware labels. Watch one PR end to end.
  Leave `verified_auto_merge` off until one proof passes, then turn it on
  for glot.it.

## Verification

- Unit: diff analysis (deleted test, assertions removed, markers, lockfile,
  CI config, budget at the edges, missing patch), verify-check parsing
  (garbage, wrong SHA), gate order and the second review held to the end,
  the auto-merge daily cap, revert safety (a later commit touching the same
  file gives not_safe).
- Live: a glot.it agent PR shows the gates; a PR with a real
  fail-to-pass test passes gate 4 on the Alienware runner; a PR that only
  edits tests fails it.
