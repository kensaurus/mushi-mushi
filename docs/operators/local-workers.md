# Local workers (`mushi work --daemon`)

A local worker fixes reports with a coding agent (the Cursor CLI) on your own
machine and pushes with your own `git` and `gh`. The console sees it and
steers it from **Pipeline → Workers**. Decision records:
[ADR 0048](../adr/0048-local-workers.md) (workers),
[ADR 0049](../adr/0049-local-conflict-lane.md) (conflicts mode),
[ADR 0050](../adr/0050-code-read-audit.md) (audit mode) and
[ADR 0042's amendment](../adr/0042-skill-runs-apply-a-catalog-skill-round-by-round.md) (skill mode). Command reference:
[`mushi worker`](https://kensaur.us/mushi-mushi/docs/sdks/cli#mushi-worker).

## What runs where

| On your machine | In Mushi |
| --- | --- |
| `~/.config/mushi/worker.json`: each lane's name, app id and clone path | `work_hosts`: the machine (a sha256 of its machine id, never the raw id) |
| The worker key (`worker:run`): OS keychain, or `~/.config/mushi/worker.key` (mode 0600) | `work_lanes`: each lane's settings (model, mode, concurrency, paused, stop date, drain) |
| The service: a systemd user unit or a Windows scheduled task | `work_queue`: reports a lane takes first |
| The clones, worktrees and the agent | `work_claims`: the 45-minute lease on each report a lane is working on |

The machine opens no port. Every 60 s it sends a heartbeat and reads back its
lanes' settings. Mushi never sends a command or a path.

## Install

Prerequisites on the machine: Node 20+, the Mushi CLI, `cursor-agent` signed
in (`cursor-agent login`), `gh` signed in (`gh auth login`), and one clone per
lane.

```bash
# Review first: prints the lanes, where the key goes and the service file
mushi worker install --lane my-app --project <projectId> --repo-dir ~/code/my-app --dry-run
# Then write it (asks before writing; --yes for scripts)
mushi worker install --lane my-app --project <projectId> --repo-dir ~/code/my-app
```

The key: `install` makes a worker key with your CLI login, which needs
`mcp:write` on every lane's app. For several apps, either use an account CLI
key, or make the worker key in the console (Pipeline → Workers → **Create a
worker key**) and pass it on stdin:

```bash
mushi worker install --lanes-conf lanes.conf --key-stdin --yes < worker.key && rm worker.key
```

The worker key can take reports for its lanes, record their fixes, run review
follow-ups and file reports. It cannot merge, change settings or read keys.
The daemon refuses your CLI key, and the coding agent gets neither key.

### Linux and WSL2: systemd user unit

`install` writes `~/.config/systemd/user/mushi-worker.service` and runs
`systemctl --user daemon-reload && systemctl --user enable --now mushi-worker.service`.

- Start at boot without a login session: as root, once,
  `loginctl enable-linger <user>` (check with `loginctl show-user <user> -p Linger`).
  Without it the user unit stops when the user's last session ends.
- Run `install` in a real login session of that user (`machinectl shell <user>@`
  or ssh), not through `su`/`sudo -u`, or `systemctl --user` cannot reach the
  user's systemd.
- Logs: `journalctl --user -u mushi-worker.service -f`.
- The unit restarts the daemon 5 minutes after a crash, but not after exit
  code 2 (the key was revoked or is missing), so a revoked worker stays down.
  The key is never in the unit file.
- Under a headless user unit (WSL, a server), the Secret Service (libsecret)
  is usually not running, so the keychain is unavailable and the key is
  stored in `~/.config/mushi/worker.key` with mode 0600. `install` says which
  one it used.

### Windows: scheduled task

`install` runs `schtasks /Create /TN "Mushi worker" /SC ONLOGON …` so the
daemon starts when you log on. Remove it with `mushi worker revoke` or
`schtasks /Delete /TN "Mushi worker" /F`.

### macOS

Not automated yet: run `mushi work --daemon` under launchd yourself.

## Lane modes

Each lane does one thing, set on the Workers tab (**Mode**). The machine reads
it at its next heartbeat. A daemon older than the mode leaves the lane idle and
logs "lane settings refused": update the CLI on the machine first.

| Mode | What the lane does |
| --- | --- |
| Fix reports and follow-ups (`fix`) | Its queue first, then the worst open reports; a draft PR each; review follow-ups on its own PRs first |
| Review follow-ups only (`followups`) | Only the Opus "fix first" findings on PRs a local agent opened |
| Resolve merge conflicts (`conflicts`) | Merge-queue PRs of this clone's repository that wait for a conflict agent (see below) |
| Audit the code, screen by screen (`audit`) | Files only bugs the machine reproduces itself (see below) |
| Run skill runs (`skill`) | Only the rounds of skill runs started on /credits with **Run on** set to this lane |

### Conflicts

The daemon tells Mushi which repository each clone is (`owner/name` from its
`origin` remote), so a conflicts lane takes only that repository's PRs. It
takes a PR that waits in the merge queue for a conflict agent, while fewer
than 2 conflict agents (cloud and local together) have tried that PR. Then:

1. It checks the PR is open, from the same repository, and still at the
   commit Mushi saw.
2. It merges the base branch in, in a worktree under
   `~/.cache/mushi/conflicts/`.
3. The agent may edit only the conflicted files.
4. The result is refused if a conflict marker is left, or any other file
   changed.
5. It commits with your hooks and pushes the merge commit, fast-forward
   only, after checking the branch did not move.

Mushi then asks Opus to review the new head, and the merge queue goes on. A
machine failure (a clone permission, the network) gives the PR its attempt
back. A result the checks refused does not. A lane does not try the same PR
again within the hour.

### Audit

One pass reads one screen (a page file, or a UI file in an app without page
folders) of the default branch, in a worktree under `~/.cache/mushi/audit/`:

1. The lane's model, in read-only ask mode, proposes up to 3 bugs. Each
   comes with the line, the code on it, and a check: a pattern near that
   line, or one of the repo's own `lint`, `typecheck`, `test` or `check`
   scripts that must fail and name the file.
2. The machine runs each check itself, with no model.
3. **Second model (may only veto)**, when set, can drop a reproduced
   finding. It cannot add one. A missing answer counts as a veto.
4. What is left is filed as a report (`source = code_audit`), once per file,
   rule and line of code, at most 12 an hour per app. It goes into the queue
   of a fix lane for the same app on the same machine, when there is one.

The screens done, and findings the hourly cap held back, live in
`~/.cache/mushi/audit/<lane>.json`. Delete it to start the screens over. An
audit lane runs one pass at a time.

### Skill runs

On /credits, **Run on** offers your fix and skill lanes for the app. Each round
of that run is put into the lane's queue as it is filed. Spend-down leaves a
report in a local lane's queue alone while that lane will take it and its
machine is alive (not revoked, a heartbeat in the last 24 hours); after that
the report is free for a cloud agent again. A `skill` lane takes nothing else;
a `fix` lane takes the rounds too. Conflicts and audit lanes have no queue.

## Guards

Set per machine on the Workers tab (the machine's owner only). The daemon
checks them before every new agent:

| Guard | Default | What happens |
| --- | --- | --- |
| Agents at once | 6 | One cap across every lane on the machine; lanes wait for a slot |
| Free-memory floor | 5 GB | Takes nothing new while less is free (`MemAvailable`) |
| GitHub API floor | 800 calls | Takes nothing new while fewer core API calls are left; a hung `gh` call counts as unknown, not empty |

Also on the machine: the Cursor sign-in (checked at most every 20 minutes; a
status call that times out still counts as signed in for 2 hours after the
last confirmation) and each lane's stop date. With `--cursor-account <email>`
(kept in the local worker.json, never sent), a CLI signed in as any other
account counts as signed out, so only that account's credits are spent.

Since the 2026-10-28 amendment of ADR 0048, `gh` signed out makes the machine
wait (it used to stop the daemon at start), and a lane whose clone is not a git
clone stays out while the others run. The Cursor check runs in the background
after the first one, so a slow `cursor-agent status` never holds the heartbeat.

## What the console shows when a worker stops working

Every heartbeat also carries (ADR 0048 amendment 2026-10-28, cleaned on the
machine in `worker/telemetry.ts` and again by the server in
`_shared/work-telemetry.ts`):

- each run in flight (`status.inflight` of the lane): claim, stage
  (`prepare`, `agent`, `commit`, `push`, `pr`; `run` for conflict, audit and
  test runs), seconds since it started and since the stage began, model and
  the last 4 log lines, at most 160 characters each;
- per machine: load and cores, why it waits, the Cursor account check and the
  `gh` sign-in as they really answered with their age (`status.checks`), which
  lane holds each agent space (`status.slots`) and lanes that could not start.

Ages are seconds measured on the machine; no clock is compared. Log lines lose
credentials in URLs, `token=` and `Bearer` values, anything shaped like a
secret, e-mail addresses (masked), absolute paths (cut to their last part) and
compiler code-frame lines that quote source.

The server turns that, plus claims, local `mushi work` runs and credit expiry
dates, into flags (`_shared/work-flags.ts`): host offline, a lane that cannot
start, a run holding an agent space over 45 minutes (with its stage), lanes
waiting over 15 minutes, the account check, `gh` signed out, a guard holding
the machine over 5 minutes, load of 2 or more per core, 2+ runs failing in the
repo's git hooks in 24 h, a `mushi work` run no worker claims, and credits idle
for 2 hours within 7 days of expiry. `GET /v1/admin/work/lanes` returns them
(`flags`), `GET /v1/admin/work/stats` counts them for the sidebar badge, Home
"Needs you" and Spend credits show them, `mushi worker status` prints them
(exit code 2 while one is danger), and the MCP tool `get_worker_status`
returns them.

Two console actions answer them:

| Action | Route | Who | What the machine does |
| --- | --- | --- | --- |
| Stop this run | `POST /v1/admin/work/claims/:id/stop` | the app's owner or admin, or the machine's owner; audited (`fix_dispatch.cancelled`, `source: worker_stop`) | The claim ends as `stopped` and the report is free for any lane or cloud agent (it is not requeued); the next heartbeat lists the claim as lost, the daemon aborts the agent, and `mushi work` commits and pushes nothing more. A git hook already running keeps the agent space until git's own time limit (10 min, 25 min for commit and push), flagged as a stopped run still holding the space. Works with every daemon version |
| Re-check the account | `POST /v1/admin/work/hosts/:id/recheck` | the machine's owner | `work_hosts.recheck_requested_at` (migration `20261028120000_worker_recheck.sql`); the heartbeat answers `recheckAccount: true` until the machine has checked again (at most 30 minutes). An older daemon ignores the field |
| Switch account | `POST /v1/admin/work/hosts/:id/cursor-account` (`GET …/cursor-login` reads where it stands) | the machine's owner, from a console session; audited (`worker.cursor_account_switch`, masked account) | Sets the account its lanes may spend and asks for a sign-in (see **Switch the Cursor account** below). Needs a CLI that sends `can: ["cursor_login"]`; an older one is told to update |

## Switch the Cursor account

On the **Workers** tab, the machine's owner presses **Switch account** on
the machine (or on a Cursor account flag), types the e-mail address of the
Cursor account its lanes should spend, and presses **Start the switch**.
Nobody types a key or a password, and none reaches the machine.

1. Within a minute the machine stops taking new work and lets the runs in
   progress finish (at most 30 minutes; after that it goes on and says so).
2. It signs the Cursor CLI out and starts `cursor-agent login` (no browser
   on the machine). The approve link appears in the dialog:
   **Open Cursor sign-in**, approve as that account. The link works for 15
   minutes and only its owner sees it in the console; it is never in a log
   line, the Workers list, MCP or the audit log.
3. The machine checks which account it now is. The dialog then says
   **Signed in as …**, **wrong account** (another account approved: the
   lanes take nothing until you try again), **expired** or **failed**, with
   why, and offers **Try again**.

The account you name replaces `--cursor-account` from `worker.json` on
that machine (it rides the heartbeat answer), so the account check and the
**Cursor account** flag compare against it. An offline machine starts the
switch when it checks in; a request nobody finishes expires after an hour.
A machine whose CLI predates this says **update the CLI there**
(`npm i -g @mushi-mushi/cli@latest`, then restart the worker). Migration
`20261028150000_worker_cursor_account.sql` adds `work_hosts.cursor_account`,
`cursor_login_requested_at` and `cursor_login`.

## Outcomes and requeue

Each run is reported back with its outcome. A failure of the machine (a clone
permission, the network, a git lock, memory, a hook that timed out under load)
is marked infra: it starts no 7-day cooldown and never counts against the
report. The report goes back to the front of its lane once on its own; after
a second infra failure it waits in the **Pipeline** page's stuck groups for a
person to press **Requeue**.

If the daemon stops without reporting (a crash, a lost network), its lease
runs out after 45 minutes; the report is then free for any worker or cloud
agent, and goes back to its lane once.

## Revoke

```bash
mushi worker revoke
```

revokes the key in Mushi, removes it from the keychain and the key file, and
disables the service. Revoking the machine on the Workers tab does the same
on the server side; the daemon stops at its next heartbeat.

## Moving the 2026-10-26 lanes onto the daemon

The WSL machine ran the lanes as `mushi-lane@<name>` systemd units around
`lane-v4.sh`, configured by `~/mushi-credits-handoff/lanes.conf`, with a queue
file per lane in `state/<name>.queue`. lane-v4 also stopped at `STOP_AT`
(2026-10-31T14:59:00Z) and spent only when `cursor-agent status` named suzu's
account. To move them:

1. As root, once: `loginctl enable-linger mushi-agent` (it was off on
   2026-10-27), so the user unit keeps running without a login session.
2. As `mushi-agent`, install the CLI build that has `mushi worker`, in a login
   session (`machinectl shell mushi-agent@`).
3. Copy each lane's queue somewhere: `cat ~/mushi-credits-handoff/state/*.queue`.
4. Review the import without writing anything:
   ```bash
   mushi worker install --lanes-conf ~/mushi-credits-handoff/lanes.conf      --clone-root ~/.cache/mushi-work      --stop-at 2026-10-31T14:59:00Z --cursor-account suzu.haruka1130@gmail.com      --no-service --dry-run
   ```
   Each lane keeps its name, app and model; `queue` and `fix` become `fix`,
   `off` becomes paused; every lane gets the stop date. The profile column is
   dropped: one worker key serves every app. Run it again without `--dry-run`
   to write the lanes file and the key.
5. Let the running lanes finish their current report, then stop them. Set
   each lane's mode to `off` in `lanes.conf` (re-read every pass, no restart
   needed), wait until `sudo ~/mushi-credits-handoff/lanectl.sh status` shows
   every lane `off` or `idle`, then run `sudo ~/mushi-credits-handoff/lanectl.sh stop all`
   and `sudo systemctl disable 'mushi-lane@*'` so they do not start at boot.
   (`lanectl.sh drain` starts a lane again afterwards, so do not use it here.)
   Never run both at once: two processes would work in the same clones.
6. Start the daemon: run step 4's command without `--no-service` and
   `--dry-run`, add `--yes`. It writes and starts `mushi-worker.service`.
7. On Pipeline → Workers, check that the machine is online and each lane
   shows its model and stop date. Paste each lane's old queue ids (step 3)
   into that lane's **Add reports by id** box; a whole queue file works.
8. Check the machine's guards there (old `MAX_AGENTS=6`, `MIN_MEM_GB=5`,
   `GH_FLOOR=800`, which are also the defaults).
