# 0048. Local workers: registered machines, pull-only control, a lease every dispatcher reads

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation. Date: 2026-10-27

Related: ADR [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) (local
runs never get the user's session), ADR
[0028](0028-spend-down-expiring-agent-credits.md) (spend-down), ADR
[0032](0032-review-follow-ups-send-fix-first-prs-back-once.md) (review
follow-ups and their local route), ADR
[0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md)
(infra failures are not code failures), ADR
[0039](0039-better-models-make-mushi-better.md) (the model is a setting),
`api/routes/work.ts`, `_shared/work-lanes.ts`, `_shared/work-claims.ts`,
`packages/cli/src/worker/`, migration `20261027150000_local_workers.sql`,
operator guide [`docs/operators/local-workers.md`](../operators/local-workers.md).

## Context

On 2026-10-26 the local fix lanes ran as hand-made systemd services on one
WSL machine. A shell script per lane (`lane-v4.sh`) called `mushi work` in a
loop, read its model and mode from a text file (`lanes.conf`), took report ids
from another text file per lane, and wrote its status to a JSON file that
`lanectl status` printed. It worked, but:

- the console could not see the lanes, their queues or their runs, and could
  not pause one, change its model or put a report first;
- every guard (free memory, the GitHub API quota, the Cursor sign-in, an agent
  cap, a stop date) lived in shell, and each one was added after it had cost
  a lane;
- only the CLI checked whether a report already had a run (`hasLiveAttempt`,
  `work.ts`). Spend-down, `fix-worker` and skill runs did not, so a cloud
  agent and a local lane could take the same report at the same time.

## Decision

### Registration

- `mushi work --daemon` is one process per machine. Each heartbeat registers
  the machine in `work_hosts` with the same on-machine sha256 as
  `ci_runner_hosts.host_id` (Windows hashes MachineGuid), so /ci and the
  Workers tab name the same machine.
- Lanes register by name and app (`work_lanes`, unique per host and name). A
  lane's clone stays in the machine's own file (`~/.config/mushi/worker.json`).
  Mushi never stores or sends a path.
- `mushi worker install` writes that file (it imports `lanes.conf`), stores
  the key and writes the service: a systemd user unit on Linux and WSL2, a
  scheduled task on Windows. It prints all of it and asks before writing.

### Pull-only control from a closed set

- The daemon opens no port. Every 60 s it asks; the server never reaches the
  machine.
- The answer holds, per lane, exactly `paused`, `concurrency` (1–4), `model`,
  `mode` (`fix` or `followups`), `stop_at`, `drain` and `prune_own`; per host,
  the guards `max_agents`, `min_free_mem_gb` and `gh_floor`. Each is a value,
  never a command or a path.
- Both sides parse this closed set and refuse anything else: the server's
  `parseLaneVerbs` / `parseHostGuards` for console writes, the CLI's
  `worker/protocol.ts` for the answer. A lane whose settings fail the parser
  stays idle.
- The guards run on the machine with the server's numbers: free memory, the
  GitHub API floor, the Cursor sign-in (a status call that times out counts
  as signed in for 2 hours after the last confirmation), one agent cap for
  the whole host, and each lane's stop date. `prune_own` is stored and sent
  now; the daemon acts on it in a later phase.

### The `worker:run` scope

A new key scope. mcp:write does not imply it, as with `runner:write`. It
reaches only:

- `/v1/worker/*`: heartbeat, claim, renew, done, and revoking its own key.
  These routes take nothing else: a console session or an mcp key is refused.
- The local follow-up routes (`/v1/admin/projects/:id/local-followups`,
  `/v1/admin/fixes/:id/local-followup` and `…/done`).
- Filing a report (`POST /v1/admin/projects/:id/reports`), with an optional
  `queue: { laneId }` that may name only its own lanes.
- `POST /v1/admin/fixes`, `PATCH /v1/admin/fixes/:id` and
  `POST /v1/admin/fixes/:id/review`, and only on a report one of its own
  hosts holds an active claim on (`workerClaimDenial`).

It never reaches merge, settings or keys. `POST /v1/admin/work/key` mints one
as an account key ([ADR 0026](0026-one-mcp-connection-reaches-all-or-selected-projects.md)) limited to the apps it names, and only apps the
caller already reaches as a non-viewer: a key bound to one app can mint a
worker key for that app only. The key lives in the OS keychain (or a 0600
file where there is none). The agent never gets it: `agentEnv` is unchanged.
A key revoked in the console stops the daemon at its next heartbeat.

### The lease every dispatcher reads

- `POST /v1/worker/claim` takes the lane's queue in order first (a person's
  order: the 7-day local cooldown does not apply, as `--report` never did),
  then classified and reopened reports ranked as `pickReports` ranks them.
  Never a report with an active claim or an in-flight cloud dispatch; a
  ranked one also never with a live run, an open PR or a local cooldown.
- A claim is a `work_claims` row: 45 minutes, renewed by each heartbeat. A
  partial unique index (`report_id WHERE status = 'active'`) lets one of two
  racing claimers win; the other takes the next report.
- A claim counts while `status = 'active' AND lease_until > now()`, so a
  dead daemon blocks nobody once its lease runs out, even before anything
  marks it expired.
- Every dispatcher skips a claimed report: `dispatchFixForReport` (Slack,
  Linear, voice, design actions), `POST /v1/admin/fixes/dispatch`,
  spend-down's candidate list (which covers skill-run rounds), `fix-worker`
  just before it starts an agent, and `skill-runs`, which waits on a round
  whose report a lane holds.
- A failed lease read is not "free": a dispatcher skips the report (or the
  app, for spend-down) this tick. A missing table (42P01, migration not
  applied) means no claim can exist and is logged once.

### Outcomes: infra or code

- Each run ends with `POST /v1/worker/claims/:id/done`: the outcome
  (`pr_opened`, `no_change`, `verdict`, `timeout`, `skipped`, `stopped`,
  `failed`) and, for a failure, infra or code, as ADR 0033 splits CI. A
  failure before the agent started, or one that names the machine (a
  permission, the network, a lock, memory, a timeout), is infra.
- An infra failure closes the fix row with the prefix `mushi work infra:`,
  which the 7-day local cooldown skips, as it skips a stop or a reaped run. It
  never counts against the report.
- An infra failure, or a lease that ran out, puts the report back at the
  front of its lane on its own at most once per report in 7 days. That limit
  is read from the claim history (`work_claims.auto_requeued`), not from the
  queue row, which goes away when the report is claimed.
- After that a person decides: /pipeline shows these reports in a
  `local_infra` group with a **Requeue** action, which is not limited to once.

### The race that is left

The checks narrow the window; they do not close it. A cloud dispatch row can
be inserted after `dispatchFixForReport` checked the lease and before a lane
claims the report; `fix-worker` checks again just before it starts an agent,
but a claim taken after that check and before the agent starts can still
overlap. The claim also skips reports with a queued or running dispatch, so
both sides would have to land inside the same few seconds. When it happens,
two PRs are opened and the review gate decides as for any duplicate.

### ADR 0032

This amends ADR 0032's local follow-up decision only in who starts the
round: "`mushi work --followups` … commits, and pushes" now also covers the
daemon running a lane in `fix` or `followups` mode. The round is still
claimed through the same routes and rules, and the push still uses the
machine's own git and `gh`, never a Mushi credential.

## Consequences

- The console's /pipeline **Workers** tab replaces `lanectl status`: hosts,
  lanes, settings, the queue, recent runs, PRs, timeouts and errors.
  "Send to my local worker" on report detail and on pipeline groups replaces
  the queue text files. **Who opens fixes** reads registered lanes instead of
  guessing from runs, and /credits lists the lanes' models beside the keys.
- A lane's model is a setting held by Mushi (ADR 0039), changed in the
  console, not a shell argument.
- Four new tables, RLS service role only; the console reads them through
  `/v1/admin/work/*`.
- Lane writes (settings, queue) need a console session of a non-viewer;
  host guards and revoking a host need its owner.
- With `concurrency` above 1, runs share one clone; concurrent git commands
  in it can contend for a lock. Such a failure is infra and is requeued once.

## Rejected

- **Push control or an inbound port.** A machine behind a home router or WSL
  would need a tunnel, and a reachable port on a developer's machine is a
  new attack surface. Pull every 60 s is fast enough for pause and resume.
- **Server-sent commands or paths.** Anything that becomes a shell string on
  the machine turns a server compromise into code execution there. The
  closed verb set is the whole contract.
- **Putting the CLI's mcp:write key on the machine.** It can merge pull
  requests and change settings; a service file, a log or an agent could leak
  it. The daemon refuses the CLI key.
- **Keeping the duplicate check on the client only.** Only the CLI would ever
  see it; the cloud dispatchers would still take a report a lane is working on.
