# CI runners

Source: https://kensaur.us/mushi-mushi/docs/operating/ci-runners

---
title: CI runners
description: See where your tests run and why a fix waits to land. Tell a broken fix from a stopped test machine, and set up your own machine as a GitHub Actions runner with safe defaults.
---

# CI runners

Your agent opened a fix. The check went red. Was the fix wrong, or did the test
machine stop? This page covers how Mushi tells the two apart, how to see where
your tests run and why they wait, and how to add your own machine as a runner.

Everything here is optional. Without it, Mushi still reads job times and
runner names from GitHub.

## Your fix failed, or the test machine stopped

Mushi reads every CI job of a fix's pull request and gives it one verdict:

| Verdict | What happened | Counts as |
| --- | --- | --- |
| `passed`, `skipped`, `running` | What it says | — |
| `queued` | Waiting a short time for a runner | — |
| `waiting_for_runner` | Waiting 10 minutes or more on a self-hosted label (30 on a hosted one) | Test machine |
| `runner_lost` | The runner stopped mid-job: out of memory, a reboot, a lost connection | Test machine |
| `queue_expired` | No runner picked the job up, so GitHub cancelled it | Test machine |
| `cancelled` | Someone, or a newer push, cancelled it | Neither |
| `code_failure` | A step failed on a working runner | Your code |

A test-machine verdict means **your fix was not tested**. The fix page says so
and offers **Re-run tests**. The Opus review never holds a merge for it, and no
agent is sent to "fix" CI that never ran.

## The CI view

The console's **CI** page, `mushi runner status` and the MCP tool
`get_ci_overview` show the same thing:

- **Machines** that send a heartbeat: memory, swap, load, free disk.
- **Runners**: online, busy or offline, memory used against the limit, and out-of-memory kills.
- **Wait and run times**: how long half of jobs, and 95% of jobs, waited for a runner and ran.
- **Failures**: how many were the test machine and how many were code.
- **Advice**, each with the numbers behind it: jobs wait too long, memory is near the cap, a runner was killed for memory, swap is busy, `cancel-in-progress` is missing, draft PRs run full CI, no dependency cache, the slowest steps, one runner serving a busy repo.

```bash
mushi runner status            # this project, last 7 days
mushi runner status --refresh  # read GitHub now instead of the last 10-minute sync
mushi runner status --all      # every project your account key can read
mushi runner status --json
```

### GitHub permissions

| Permission | Needed for |
| --- | --- |
| Actions: read | Jobs, their times, runner names and why a job was cancelled |
| Administration: read (optional) | The runner list: online, offline, busy, labels |

Without Administration: read, Mushi shows the runners it saw in jobs and says
so.

## Machine health: heartbeat and job hooks

GitHub does not report a runner's memory or CPU. To see them, run a small
reporter on the machine.

### The runner key

The reporter sends with a **runner key**: a key that can only report runner
health. CI jobs run as the same user as the job hooks, so a pull request's code
could read the key file. If a job steals a runner key, all it can do is send
fake numbers. Your CLI key, which can merge pull requests, never goes on a
runner.

```bash
mushi runner key    # create one and save it to /etc/mushi/runner.key (root only); it is never printed
```

Creating a runner key needs a CLI key with `mcp:write` (`mushi login --upgrade-scope`).
`mushi runner hooks install` and `mushi runner add` create one for you unless
`MUSHI_RUNNER_KEY` is set. `mushi runner status` keeps using your CLI key; it
only reads.

**Heartbeat**, every 2 minutes:

```bash
mushi runner heartbeat --dry-run   # print what would be sent
mushi runner heartbeat --once      # send one (for a timer or cron)
mushi runner heartbeat             # send one every 2 minutes
```

It reads the runner key from `MUSHI_RUNNER_KEY`, the systemd credential that
`mushi runner add` sets up, or `/etc/mushi/runner.key`.

It finds GitHub runner services in systemd (`actions.runner.*`, and the ones
`mushi runner add` creates) and reads each one's memory use, memory limit and
out-of-memory kills from its cgroup. Linux and WSL2 are fully supported; macOS
reports the machine and its runner agents only.

**Job hooks**, once per job:

```bash
mushi runner hooks install --dir ~/actions-runner
```

This writes `job-started.sh` and `job-completed.sh` into `mushi-hooks/` and
turns them on in the runner's `.env` with GitHub's
[job hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts).
They send the job's memory peak, memory limit, out-of-memory kills, swap and
load. Restart the runner service afterwards. The hooks always exit 0, give up
after 5 seconds, and never fail a job. The runner key sits in `mushi-hooks/key`
with mode 0600; it is not in the scripts and never on a command line.

### What is sent, and what never is

| Sent | Never sent |
| --- | --- |
| Hostname, platform, CPU count, total memory | The raw machine id (only a SHA-256 hash of it) |
| Load, memory and swap in use, free disk | File contents, logs, `_diag` files |
| Runner names, repo names, unit names | Environment values or secrets |
| Per runner: running or not, restarts, memory use and limit, OOM kills | Process arguments |
| Per job: repo, run id, attempt, job id, memory peak, OOM kills | Anything from the job's workspace |

## Add your own machine as a runner

```bash
mushi runner add --repo you/your-app --dry-run   # read the whole plan first
mushi runner add --repo you/your-app
```

It prints every command before it runs, runs the ones that need root through
`sudo`, and registers the runner with **your own** `gh` login. Mushi's GitHub
App never registers runners.

### Is it worth it?

Self-hosted runners are free on GitHub in 2026: the planned per-minute charge
for them was
[postponed](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/).
GitHub-hosted Linux costs $0.006 a minute (2 cores) after your included
minutes: 2,000 a month on Free, 3,000 on Pro and Team. Public repos run free
anyway ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

So the savings are small. The reason to do it: when an agent opens many fix
PRs, your included minutes run out mid-month and the fixes stop being tested.
A machine you already own keeps them tested.

### The safe defaults, and why

| Default | Why |
| --- | --- |
| **Private repos only.** A public repo is refused unless you pass `--allow-public`. | A pull request from a fork runs its code on your machine. GitHub: self-hosted runners "should almost never be used for public repositories" and "can be persistently compromised" ([secure use](https://docs.github.com/en/actions/reference/security/secure-use)). |
| **One job per runner** (`--ephemeral`, the default). Before every job, a fresh one-job config is minted and the work folder is wiped. | One job cannot leave something behind for the next. `--persistent` keeps one long-lived runner. |
| **A dedicated user**, `gha-runner`, with a fixed uid, no login shell and no admin rights. Never your account, never root. The service cannot see `/home`. | A job cannot read your SSH keys, browser profile or other projects. |
| **A memory cap** (`--memory`, default 60% of RAM) in a systemd slice, with throttling before the hard limit. | A hungry build is stopped by its own limit instead of freezing the machine, and the CI view shows the out-of-memory kill. |
| **A label of its own**: `mushi-` (`--label` to change it). | Only workflows that ask for it run there. GitHub-hosted runners stay the fallback. |
| **Download checked**: the official `actions/runner` release, checked against the SHA-256 GitHub publishes in the release notes. | You run what GitHub shipped. |
| **Hooks and heartbeat** installed with it. | The CI view sees the machine from the first job. |
| **A runner key**, not your CLI key, on the machine. The heartbeat gets it from systemd; it is not in any unit file. | A job that reads it can only send fake numbers, not merge your pull requests. |

Before it registers, it also checks the repo's fork pull request approval
setting (it warns unless it is "Require approval for all external
contributors") and lists workflows that use `pull_request_target`, which run
with your secrets on fork pull requests.

Options:

| Flag | Does |
| --- | --- |
| `--block-lan` | Blocks the runner user from your LAN, tailnet and link-local addresses with nftables, in a table of its own. DNS stays open. It never flushes other rules. |
| `--wsl-isolate` | On WSL2: turns off Windows drives (`/mnt/c`) and starting Windows programs for that distro. |
| `--set-variable` | Sets the repo variable `LINUX_RUNNER` to the label. |
| `--persistent` | One long-lived runner instead of one per job. |

Then point a workflow at it:

```yaml
runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}
# or: runs-on: [self-hosted, mushi-<host>]
```

  Cloud agents push branches inside your repo, so fork approval does not stop
  code an agent wrote from running on your runner. Keep the runner on private
  repos you trust, and review what your agents can push.

### WSL2

`mushi runner add` turns on systemd in `/etc/wsl.conf` (needed), then asks you
to run `wsl --shutdown` and run it again. WSL2 stops a distro about 15 seconds
after its last terminal closes, and the VM a minute later, so the runner goes
offline. To keep it up, add to `%USERPROFILE%\.wslconfig`:

```ini
[general]
instanceIdleTimeout=-1

[wsl2]
vmIdleTimeout=-1
```

Run `wsl --shutdown` once, then start the distro at logon (PowerShell):

```powershell
schtasks /Create /TN "mushi-runner-keepalive-Ubuntu" /SC ONLOGON /RL LIMITED /F /TR "wsl.exe -d Ubuntu -u root --exec sleep infinity"
```

See [WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

### macOS and Windows

- **macOS**: Mushi prints the steps instead of running them. Use a separate
  standard user and a user-session LaunchAgent (`./svc.sh install`), not a
  daemon, so jobs can reach the keychain and the iOS simulator.
- **Windows**: use WSL2 (`wsl --install`) and run `mushi runner add` inside it.

### One-job runners and your `gh` login

The one-job runner mints its config with your `gh` login before every job,
which needs **Administration: write** on the repo. If `gh` keeps its token in a
desktop keyring, a background service cannot read it. Then save a fine-grained
token with Administration: write on that one repo as
`/etc/mushi-runner/.gh-token` (root, mode 0600); the runner uses it
instead.

## What can go wrong

Self-hosted runners have been a real attack path:

- **Shai-Hulud 2.0** (November 2025) installed a rogue self-hosted runner named
  `SHA1HULUD` on developers' machines as a backdoor.
- **Nx "s1ngularity"** (August 2025) used a compromised package to steal tokens
  from developer machines.
- **tj-actions/changed-files** (CVE-2025-30066) leaked CI secrets from the
  workflows that used it.

Check your repos:

```bash
mushi runner audit --repo you/your-app
mushi runner audit --all
```

It lists every self-hosted runner, flags the ones Mushi did not set up (no
`mushi-` label and no heartbeat) and any named like `SHA1HULUD`, and shows the
fork approval setting and the `pull_request_target` workflows.

The stronger option is a fresh container for every job. `mushi runner add`
does not set that up yet; until it does, keep runners on private repos you
trust.
