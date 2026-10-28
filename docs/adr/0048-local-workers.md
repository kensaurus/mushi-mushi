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

## Amendment 2026-10-28: every worker problem is visible, flagged and answerable in the console

Status: Accepted 2026-10-28 by team-lead (Claude) under the owner's explicit
delegation ("these kind of wrong should be flagged and shown easily on mushi
console. you shouldnt hide or omit it or make it invisible").

On 2026-10-28 three lanes held a machine's four agent spaces for 4 to 6 hours
inside their repos' own git hooks (a type check, a lint in pre-push), six
lanes waited behind them, the Cursor account check timed out under load 37 on
16 cores, `gh` reported signed out for a while, and expiring Cursor credits
went unused. The lanes ran on a hand-made script, but the console-steered
worker would have hidden most of it too: its heartbeat carried counters and
one state word, so the console could not say which run was stuck, where, or
why.

### Decision

- **Telemetry, never control.** The heartbeat adds, per lane, each run in
  flight (`status.inflight`: claim, stage `prepare | agent | commit | push |
  pr | run`, seconds since the run and the stage began, model, the last 4 log
  lines of 160 characters) and, per host, load and cores, why it waits, the
  Cursor account check and the `gh` sign-in as they really answered with
  their age (`status.checks`), which lane holds each agent space
  (`status.slots`) and lanes that could not start. Times are ages measured on
  the machine, never clock values. Unknown keys are dropped and every list is
  capped (`_shared/work-telemetry.ts`).
- **Nothing private leaves the machine.** Each line is cleaned on the machine
  (`worker/telemetry.ts`) and again on the server: credentials in URLs,
  `token=`/`Bearer` values, secret-shaped strings (the shared
  `secret-patterns.ts`), absolute paths (cut to their last part, so ADR 0048's
  "Mushi never stores a path" holds) and compiler code frames that quote
  source are removed; e-mail addresses are masked (`s***@g***.com`).
- **Flags are derived on the server, once** (`_shared/work-flags.ts`, pure):
  host offline, a lane that cannot start, a run holding an agent space over
  45 minutes (with its stage), lanes waiting over 15 minutes (one flag per
  machine naming the holders), the account check (another account, signed
  out, missing: danger; timed out: warn), `gh` signed out, a guard holding the
  machine over 5 minutes, load of 2 or more per core, 2+ runs failing in the
  repo's git hooks in 24 hours (read from `work_claims.detail`), a `mushi work`
  run no worker claims (`fix_attempts.agent = 'mcp'`, running, over 45
  minutes) and credits idle (no agent work for 2 hours while a Cursor key the
  caller sees, or a lane's stop date, ends within 7 days), named with what
  blocks the work. A field an older daemon does not send raises no flag.
- **Every surface reads that one result**: `GET /v1/admin/work/lanes`
  (`flags`), `GET /v1/admin/work/stats` (the Pipeline sidebar badge), the
  per-app Home's Needs you, Spend credits, `mushi worker status` and the MCP
  tool `get_worker_status`. The Workers tab shows them first and never folds
  them away; a strip repeats them above the Pipeline tabs.
- **Stop this run reuses the lease.** `POST /v1/admin/work/claims/:id/stop`
  (the app's owner or admin, or the machine's owner; audited) ends the claim
  as `stopped`; the report is free for any lane or cloud agent, not requeued
  (a run that just hung would only hang again). The next heartbeat lists it as lost, as for any ended lease,
  so every daemon version stops the agent; a current one also commits and
  pushes nothing more. A git hook already running keeps the agent space until
  git's time limit; a run whose claim ended but which the machine still
  reports stays flagged until it is gone. No new verb reaches the machine.
- **Re-check the account is a value.** `work_hosts.recheck_requested_at`
  (migration `20261028120000_worker_recheck.sql`, additive) makes the
  heartbeat answer `recheckAccount: true` until the machine's next check (at
  most 30 minutes). It is a new top-level field, not a guard or a lane verb,
  so a daemon that predates it ignores it instead of refusing the answer. The
  daemon runs the same `cursor-agent status` it always runs, in the
  background, so a slow check never holds the heartbeat.
- **A machine that is not ready says so.** `gh` signed out makes the machine
  wait (`auth-wait`) instead of the daemon exiting before its first heartbeat;
  a lane whose clone is not a git clone stays out while the others run.

### Rejected

- **A load guard** (`max_load_per_core`): the CLI's guard parser refuses an
  unknown key, so a new guard would make every deployed daemon drop the whole
  heartbeat answer. Load is reported and flagged instead (BL-150).
- **Stopping a git hook already running from the console**: the abort reaches
  the agent, not git; the hook ends at git's time limit (BL-151).
- **A new run-history table**: `work_claims` already is the history, and its
  `detail` carries the hook failures.

## Amendment 2026-10-28 (b): switch the Cursor account from the console

Status: Accepted 2026-10-28 by team-lead (Claude), on the owner's choice
between two designs ("Sign-in link in console", over sending a stored key to
the machine).

The owner moved the lanes from one Cursor account to another by hand in a
terminal, then asked for it to be one action in the console, easy to watch
and to change.

- **A sign-in, never a key.** The machine's owner names the account
  (`POST /v1/admin/work/hosts/:id/cursor-account`, console session only, the
  machine's owner, audited with the account masked). The heartbeat answer
  carries `cursorAccount` (it overrides `worker.json`'s `cursorAccount`) and,
  while open, `cursorLogin: { requestId }`. The daemon finishes its runs (30
  minutes at most), runs `cursor-agent logout` and `cursor-agent login` with
  `NO_OPEN_BROWSER=1` (no shell) and reports the approve link in
  `status.cursorLogin`; the person approves on cursor.com. No BYOK key is
  sent to a worker: the rule that a worker key never reads keys stands.
- **The link is the owner's alone.** The server keeps the link in
  `work_hosts.cursor_login` only while it is the step to take, outside the
  general `status`, and returns it only from
  `GET /v1/admin/work/hosts/:id/cursor-login` to the machine's owner. Log
  lines lose any Cursor sign-in link on the machine and on the server.
- **Truth from the CLI.** After the sign-in the daemon runs `cursor-agent
  status`: the named account → `signed_in`, another → `wrong_account` (the
  account check keeps the lanes off), anything else → `failed`; 15 minutes
  without an approval → `expired`. A request no machine finishes within an
  hour reads as expired.
- **Capability, not version sniffing.** A daemon that can switch sends
  `host.can: ["cursor_login"]`; without it the console says to update the CLI.
  Migration `20261028150000_worker_cursor_account.sql` (additive).
