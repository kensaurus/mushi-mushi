# Local workers (`mushi work --daemon`)

A local worker fixes reports with a coding agent (the Cursor CLI) on your own
machine and pushes with your own `git` and `gh`. The console sees it and
steers it from **Pipeline → Workers**. Decision record:
[ADR 0048](../adr/0048-local-workers.md). Command reference:
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

- Start at boot without a login session: `loginctl enable-linger $USER`.
- Logs: `journalctl --user -u mushi-worker.service -f`.
- The unit restarts the daemon 5 minutes after a crash. The key is never in
  the unit file.
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
last confirmation) and each lane's stop date.

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
file per lane in `state/<name>.queue`. To move them:

1. Install the CLI build that has `mushi worker` for the `mushi-agent` user.
2. Write down each lane's queue: `cat ~/mushi-credits-handoff/state/*.queue`.
3. Import the lanes without starting anything yet:
   `mushi worker install --lanes-conf ~/mushi-credits-handoff/lanes.conf --clone-root ~/.cache/mushi-work --no-service --dry-run`,
   check the clone paths, then run it again without `--dry-run`. Each lane
   keeps its name, app and model; `queue` and `fix` become `fix`, `off`
   becomes paused. The profile column is dropped: one worker key serves every
   app.
4. Let the running lanes finish their current report, then stop them. Set
   each lane's mode to `off` in `lanes.conf` (re-read every pass, no restart
   needed), wait until `sudo ~/mushi-credits-handoff/lanectl.sh status` shows
   every lane `off` or `idle`, then run `sudo ~/mushi-credits-handoff/lanectl.sh stop all`
   and `sudo systemctl disable 'mushi-lane@*'` so they do not start at boot.
   (`lanectl.sh drain` starts a lane again afterwards, so do not use it here.)
   Never run both at once: two processes would work in the same clones.
5. Start the daemon: `mushi worker install … --yes` without `--no-service`
   (or `systemctl --user enable --now mushi-worker.service`) and
   `loginctl enable-linger mushi-agent`.
6. On Pipeline → Workers, check that the machine is online and each lane
   shows its model, then put the report ids from step 2 back into each lane's
   queue (report page → **Send to my local worker**, or the lane's queue).
7. Set each lane's stop date in the console (the old `STOP_AT`,
   2026-10-31 23:59 JST) and the machine's guards (old `MAX_AGENTS=6`,
   `MIN_MEM_GB=5`, `GH_FLOOR=800`, which are also the defaults).
