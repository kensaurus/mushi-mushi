# 0037. CI cost and speed are measured, and Mushi changes where CI runs only through allowlisted repo variables, with approval

Status: Proposed Date: 2026-10-22

Related: [Plan 022](../execplans/ci-runners.md) Phase 7, ADR
[0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md)
(CI runners are visible; this adds cost and the one write), ADR
[0016](0016-mushi-as-the-app-recipe-control-plane.md) (CI is a recipe
element; CI minutes never lead), `_shared/ci-compare.ts`, `_shared/ci-cost.ts`,
`_shared/ci-runs-on.ts`, `_shared/ci-advisor.ts` (`adviseCiCost`),
`api/routes/ci.ts`, migration `20261022050303_ci_cost_compare`, the owner's CI
agreement (`~/actions-runners/CI-AGREEMENT.md`, 2026-10-22).

## Context

On 2026-10-22 seven private kensaurus repos had used about 23,000 GitHub-hosted
Linux minutes in 22 days, roughly ten times the Free plan's 2,000, while
self-hosted runners sat idle for parts of that time. Mushi already held every
job's timing and runner (ADR 0033) but stored 518 self-hosted jobs as
`unknown` (`runs-on: kensaurus-local` has no `self-hosted` label), priced
minutes with 2023 multipliers, did not know which repos are public, and had
no way to say what moving a workflow would save or cost.

Where a job runs is decided in the repo: most of these workflows read
`runs-on: ${{ (… && vars.LINUX_RUNNER) || 'ubuntu-latest' }}`, so one repo
variable moves them; jobs pinned with `runs-on: ubuntu-latest # reason` do not
move with it, and the `github.ref`/`github.actor` guards keep main and
Dependabot on GitHub. Runner registrations, labels and the Alienware
dispatcher belong to another session (sbc-visual) under the CI agreement:
private repos must not use paid GitHub-hosted minutes, and the NUC runners are
standby and never a target.

## Decision

1. **Cost and speed are shown, measured or estimated, never mixed up.** Wait,
   run time, pass rate (pull-request jobs only), raw minutes, busy time and
   speed factors are measured from `ci_jobs`. Billed minutes (each job rounded
   up), money, electricity, wear and monthly projections are estimated and
   labelled so on every surface (console `/ci` "Cost and speed", MCP
   `get_ci_costs`, `mushi runner compare`). GitHub prices come from a dated,
   sourced rate table; public repos cost $0 on standard runners; included
   minutes are per GitHub owner; self-hosted cost is the extra electricity
   while busy (the union of a physical machine's job intervals) plus the
   user's wear figure. A speed factor needs at least 5 passed runs on each
   side and always shows its sample size.
2. **Hosted vs self-hosted comes from the runner group** ("GitHub Actions" is
   hosted), so custom labels without `self-hosted` are classified right.
3. **The only write Mushi may make to a repository's CI placement is a repo
   Actions variable, from an allowlist of names, through an approval.** The
   names are `LINUX_RUNNER` and `RUNNER_<WORKFLOW>`; the actions are set and
   delete. Each change is requested (console, CLI or MCP), approved by an
   owner or admin in a console session within 1 hour, executed from the
   console with a payload hash and a compare-and-set on the variable's current
   value, checked against the organization's runner policy at request and at
   execution, watched for the next jobs, and revertible the same way.
   (Built in the follow-up change; this record decides the boundary.)
4. **Mushi never edits runner labels, registrations, runner groups or a
   dispatcher**, never writes a variable outside the allowlist, and never
   competes with an external controller: a controller the owner records (for
   example "sbc-visual's dispatcher") is shown read-only.
5. **A recorded no-spend policy wins over a request**: GitHub-hosted on a
   private repo is refused while it is on; standby runners are never a target.
6. **Positioning holds** (ADR 0016, 0033): this is a section of `/ci` below
   "Speed it up", framed as "where your tests run and what it costs"; it never
   leads a public surface.

## Consequences

- The collector spends one extra GitHub call per repo a day (Metadata: read)
  for visibility; the comparison is one SQL aggregate over 30 days of jobs
  (`ci_runner_comparison`, service role only), with a TypeScript fallback over
  the newest 10,000 jobs until it is applied.
- Writing a variable needs a token with Variables write (a fine-grained PAT
  with "Variables: Read and write", or `repo` on a classic token). The Mushi
  GitHub App has no Variables permission; adding it forces every installation
  to re-approve, so the stored-PAT path comes first and the route says plainly
  when the token cannot write.
- Variables write covers every variable in the repo; the allowlist, the
  compare-and-set and the approval are what keep it to runner placement.
- Electricity figures are the user's, shown as "your figures" (or "example
  figures" until saved), per organization in `ci_cost_settings`.

## Rejected

- **Changing runner labels or registrations from Mushi.** It needs
  Administration: write, fights the dispatcher that owns them, and a wrong
  label strands jobs for 24 hours.
- **Editing workflow files to move jobs.** Pinned jobs carry reasons (pixel
  baselines, perf budgets, signing keys); moving them stays a reviewed
  workflow pull request, never a toggle.
- **One-click toggles without approval.** A variable change moves every PR's
  jobs at once; it is a change to someone's CI and goes through the same
  request → approve → execute path as other connector actions.
- **Pricing with the old 1 / 2 / 10 multipliers** and **counting
  self-hosted or public-repo minutes as billed**: both overstated cost.

## Amendment 2026-10-30: CI_PROFILE, time-boxed GitHub-hosted moves, App token

The owner delegated these on 2026-10-30, after another session (SBC) asked
for CI cost and speed options in the console, with the cheaper option as
default. Nothing above is loosened; three things are added.

1. **`CI_PROFILE` joins the allowlist**, with the values `economy` and
   `thorough` only. Unset means economy. On economy, a repo's workflows may
   let Mushi fix pull requests skip slow, billed checks; those checks still
   run on the release train and on main before a deploy. Thorough runs
   everything on every pull request. The console offers the switch only for
   a repo whose workflow text reads `vars.CI_PROFILE`. It moves no `runs-on`,
   so only the external-controller rule applies to it, not the
   hosted-minutes rule. The request → approve → execute path,
   compare-and-set and audit are unchanged.
2. **A move to GitHub-hosted runners can carry `revertAfterHours`
   (1–168)** in its hashed payload, so approving the change approves its time
   box.
   - When it is due, the CI collector tick (every 10 minutes) files the
     ordinary revert, approves it in the original approver's name and runs it.
   - act() still checks the allowlist, the binding, the policy and the
     compare-and-set. If anyone changed the variable in between, the revert is
     refused (VARIABLE_MOVED), recorded as failed and never retried: a
     person's later choice wins.
   - A move without a time box says "No time limit" in its preview. On
     2026-10-30 a hand-set `ubuntu-latest` on tsumagoi was never switched
     back; those fallbacks were 79% of its hosted minutes.
3. **The token.** The project's or organization's stored token still comes
   first. Without one, the GitHub App installation bound to that repo is
   used; never the platform token.
   - The App's "Actions variables" permission moves from read to read and
     write. Each installation re-approves it.
   - Until it does, GitHub answers 403, and the change fails with
     `GITHUB_VARIABLES_PERMISSION` and the steps to approve.

Still rejected: any other variable name, toggles without approval,
time boxes on moves to self-hosted runners (they save money and need no
timer), and writes through the platform token.
