# Plan 022 — CI runners you can see: infra vs code, runner map, speed advisor, one-command runner setup

Status: `IN PROGRESS` (2026-10-21). Decision record: [ADR 0033](../adr/0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md).

## Why

On 2026-10-21 the NUC runner for glot.it was OOM-killed mid-build. GitHub
cancelled the job; Mushi showed "CI failed", the Opus review read
`failed (cancelled)` and held merges, a follow-up agent spent a turn
explaining that the failure needed no code change, and 20 auto-merge PRs sat
behind a queue nobody could see. Mushi already fetches job-level data
(`runner_name`, timestamps) for CI-minute estimates and throws it away
(`_shared/connectors/github.ts:105-110`, `_shared/ci-minutes.ts`).

A solo builder needs three answers in plain words, in this order:

1. **Is my fix broken, or is the test machine?** (fix loop, can lead)
2. **Where do my tests run, and why is it slow?** (CI view, Bucket B "why your fix is slow to land", ADR 0016)
3. **Can my own machine run them?** (`mushi runner add`, operator surface)

## Facts this plan relies on (read 2026-10-21)

- Jobs API `GET /repos/{o}/{r}/actions/runs/{run_id}/jobs`: `status`,
  `conclusion`, `created_at`, `started_at`, `completed_at`, `runner_id`,
  `runner_name`, `runner_group_name`, `labels`, `steps[]` with timings. Needs
  **Actions: read**. https://docs.github.com/en/rest/actions/workflow-jobs
- Repo runner list `GET /repos/{o}/{r}/actions/runners` (status
  online/offline, busy, labels, ephemeral) needs **Administration: read**.
  https://docs.github.com/en/rest/actions/self-hosted-runners
- `workflow_job` webhook (queued, in_progress, completed, waiting) needs
  Actions: read. https://docs.github.com/en/webhooks/webhook-events-and-payloads
- No job field says why a job was cancelled. The check-run annotation says
  "The self-hosted runner: X lost communication with the server…"
  (`GET /repos/{o}/{r}/check-runs/{id}/annotations`). A job queued 24 h with
  no runner is cancelled. https://docs.github.com/en/actions/reference/limits
- GitHub exposes no runner CPU/memory. Products that show it run an agent on
  the host (Datadog, WarpBuild) or own the VM (Depot, Blacksmith). Runner job
  hooks `ACTIONS_RUNNER_HOOK_JOB_STARTED` / `_COMPLETED` run a script per job.
  https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts
- `@xyflow/react` 12.x; dagre for left-to-right trees (~40 KB), not elkjs.
  https://reactflow.dev/learn/layouting/layouting

## Contracts (all phases build against these)

### Infra classification — `_shared/ci-infra.ts` (pure)

```ts
type CiJobKind =
  | 'passed' | 'skipped' | 'running'
  | 'queued'               // queued under the wait threshold
  | 'waiting_for_runner'   // queued ≥ 10 min (self-hosted labels) or ≥ 30 min
  | 'runner_lost'          // cancelled/failed after start + annotation "lost communication"/"shutdown signal", or runner_name null after start
  | 'queue_expired'        // cancelled, never started (no runner picked it up)
  | 'cancelled'            // cancelled for another reason (superseded, by a person)
  | 'code_failure'         // failure / timed_out on a live runner
interface CiJobVerdict { kind: CiJobKind; infra: boolean; runner: string | null; queuedSeconds: number | null; durationSeconds: number | null; detail: string | null }
classifyCiJob(job, { annotations?: string[], now: Date }): CiJobVerdict
summarizeCiJobs(verdicts): { kind: CiRunKind; infra: boolean; jobs: … }  // code_failure wins over infra; infra wins over cancelled
```

`infra: true` for `waiting_for_runner`, `runner_lost`, `queue_expired`.

### Tables (migration `ci_runner_visibility`)

- `ci_jobs` — one row per GitHub job attempt: `project_id`, `repo`
  (`owner/name`), `run_id`, `run_attempt`, `job_id` (unique with
  `run_attempt`), `workflow_name`, `job_name`, `event`, `head_branch`,
  `head_sha`, `pr_number`, `status`, `conclusion`, `gh_created_at`,
  `started_at`, `completed_at`, `queue_seconds`, `duration_seconds`,
  `runner_name`, `runner_group_name`, `runner_labels text[]`, `runner_kind`
  (`self_hosted|github_hosted|unknown`), `ci_kind` (CiJobKind), `infra bool`,
  `infra_detail`, `steps jsonb` (`[{name, conclusion, seconds}]`, ≤40),
  `html_url`, `source` (`poll|webhook`), timestamps. Kept 30 days.
- `ci_runners` — per project + repo + runner name: `runner_id`, `os`,
  `status` (`online|offline|unknown`), `busy`, `labels`, `ephemeral`,
  `source` (`github_api|jobs`), `last_seen_at`, `last_job_at`.
- `ci_runner_hosts` — per organization + `host_id` (sha256 of machine id,
  never the raw id): `hostname`, `platform` (`linux|wsl2|macos|windows`),
  `cpu_count`, `mem_total_mb`, `last_heartbeat_at`, `metrics jsonb` (`load1`,
  `mem_used_mb`, `swap_used_mb`, `swap_total_mb`, `disk_free_gb`),
  `runners jsonb` (`[{name, repo, service, active, restarts, mem_current_mb,
  mem_max_mb, oom_kills}]`), `mushi_version`.
- `ci_runner_job_samples` — from job hooks: `organization_id`, `host_id`,
  `runner_name`, `repo`, `run_id`, `run_attempt`, `job_key`, `phase`
  (`started|completed`), `at`, `mem_peak_mb`, `mem_max_mb`, `oom_kills`,
  `swap_used_mb`, `load1`. Kept 30 days.
- `fix_attempts.ci_infra jsonb` — the latest infra verdict for the attempt's
  PR head (`{kind, infra, job, runner, queuedSeconds, detail, runId, at}`).

RLS: members of the project (`private.is_project_member`) or organization
read; writes are service role only.

### HTTP

- `POST /v1/ingest/runner` (`apiKeyAuth`, project key; 60/min) — body
  `{ kind: 'heartbeat', host: {...}, runners: [...] }` or
  `{ kind: 'job', host_id, runner_name, repo, run_id, run_attempt, job_key, phase, at, mem_peak_mb?, mem_max_mb?, oom_kills?, swap_used_mb?, load1? }`.
  Zod-strict; host ids hashed client-side; hostnames ≤ 80 chars.
- `GET /v1/admin/ci/overview?project_id=&days=7` (`adminOrApiKey(mcp:read)`) —
  `{ hosts, runners, repos, jobs (latest 200), stats: { queueP50, queueP95,
  durationP50, durationP95, passRate, infraFailures, codeFailures, byRunner,
  byWorkflow }, advice: [{ id, severity, title, detail, evidence, fix }] }`.
  Without `project_id` and with an org/account key: every project the caller
  can read (portfolio map).
- `POST /v1/admin/fixes/:id/ci/rerun` (`adminOrApiKey(mcp:write)`) — reruns
  the failed/cancelled jobs of the PR head's latest run
  (`POST /actions/runs/{id}/rerun-failed-jobs`); 409 when it is still running.

### Fix loop

- `ci-sync` and the `workflow_job` webhook upsert `ci_jobs` for the PR head
  and write `fix_attempts.ci_infra`.
- `fix-loop-status.ts`: an infra verdict maps to the bucket `ci_infra`
  ("The test machine stopped — your fix was not tested"), not `ci_failed`.
- `fix-review.ts` `describeCi`: infra verdicts read `did not finish
  (runner lost on <name>)` with `failed: false`, so a review never holds a
  merge for a runner problem; the Opus prompt says the tests did not run.
- `review-followup`: findings that only restate an infra CI state are
  dropped.
- Console `FixCiFeedback`: infra states in plain words, "Re-run tests"
  button, link to the CI view.

### CLI / MCP

- `mushi runner status` — overview in the terminal.
- `mushi runner heartbeat [--once]` — reads `/proc`, systemd and cgroups for
  local runner services, pushes a heartbeat (cron/systemd timer every 2 min).
- `mushi runner hooks install --dir <runner dir>` — writes job hook scripts
  and `.env` lines; the hooks push `kind: 'job'` samples (cgroup
  `memory.peak`, `memory.events oom_kill`).
- `mushi runner add --repo owner/name` — one-command setup (Phase 5).
- MCP `get_ci_overview` (read).

## Phases

- [ ] **Phase 1 — fix-loop truth.** `ci-infra.ts` + tests; `ci_infra`
  column; `ci-sync` reads jobs + annotations for non-green heads;
  `fix-loop-status`, `fix-timeline`, `fix-review.describeCi`,
  `review-followup` screen; console `FixCiFeedback`, `fixReportTruth`,
  `FixProgressStream`; rerun route.
- [ ] **Phase 2 — collect.** `ci_jobs`, `ci_runners` tables; `ci-jobs-collector`
  cron (every 10 min, runs updated in the last 2 h on every branch, budgeted
  per tick); `workflow_job` webhook in `webhooks-github-indexer`; runner list
  when Administration: read is granted (403 is recorded, not retried hourly).
- [ ] **Phase 3 — host telemetry.** `ci_runner_hosts`,
  `ci_runner_job_samples`; `POST /v1/ingest/runner`; CLI `runner heartbeat`
  and `runner hooks install`.
- [ ] **Phase 4 — see and speed up.** `GET /v1/admin/ci/overview`;
  `_shared/ci-advisor.ts` rules (queue p95, infra share, memory near the cap,
  OOM kills, swap pressure, no `cancel-in-progress`, drafts not skipped, no
  dependency cache, slowest steps, one runner for a busy repo); console
  `/ci` page: dagre left-to-right map (hosts → runners → repos → live jobs),
  stats, slow jobs, advice; Portfolio card; MCP `get_ci_overview`; CLI
  `runner status`.
- [ ] **Phase 5 — one-command runner setup.** `mushi runner add`:
  ephemeral/JIT-safe defaults, private repos by default, isolation checks,
  hooks + heartbeat installed; console "Add a machine" guide; docs.
- [ ] **Phase 6 — tell people.** Docs pages; landing second-screen line in
  Bucket B ("your fixes land faster: see where your tests run and why they
  wait"); README depth section. The hero stays the diagnosis (VISION §2.1,
  ADR 0016) unless the owner supersedes ADR 0016.

- [ ] **Phase 7 — cost and speed, then placement (ADR 0037).**
  - 7a (read-only): hosted vs self-hosted from `runner_group_name`; dated
    rate table in `ci-minutes.ts`; repo visibility in `ci_collector_state`;
    WSL2 heartbeats carry a hashed VM id; `ci_cost_settings` and
    `ci_runner_comparison` (migration `20261022050303_ci_cost_compare`);
    `_shared/ci-runs-on.ts`, `ci-cost.ts`, `ci-compare.ts`; cost rules in
    `ci-advisor.ts`; `GET /v1/admin/ci/compare`, `GET/PUT
    /v1/admin/ci/cost-settings`; console "Cost and speed" on `/ci` and
    Settings → CI cost; MCP `get_ci_costs`; CLI `mushi runner compare`.
  - 7b (control): `ci_runner_policies`; workflow parsing and the dry-run
    preview (`ci-placement.ts`); `set_actions_variable` /
    `delete_actions_variable` connector actions for allowlisted names only,
    request → approve → execute with compare-and-set; post-change watch and
    revert; MCP `request_ci_placement_change`; CLI `mushi runner placement`
    (migration `20261022130000_ci_placement`). The verify workflow generator
    reads the repo's lockfile, local setup action and runner variable.

## Verification

- Unit: classifier on real job shapes (OOM-cancelled glot job 2026-10-21,
  24 h queue expiry, superseded cancel, failing test), advisor rules,
  ingest schema, CLI parsers.
- Live: migration applied on `dxptnwrhwsqckaftyymj` and RLS checked as
  anon/authenticated; collector run for glot.it; heartbeat from the NUC and
  the Alienware distros; `/ci` page in the console with real data; a
  cancelled glot job shows "test machine stopped" on its fix.
