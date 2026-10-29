# CI runners

Source: https://kensaur.us/mushi-mushi/docs/operating/ci-runners

---
title: CI runners
description: See where your tests run and why a Mushi Mushi fix waits. Tell a broken fix from a stopped test machine, and add your own machine as a runner safely.
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
| Metadata: read | Whether a repo is public or private (read once a day): it decides what GitHub-hosted minutes cost |
| Variables: read and write (optional) | Changing where CI runs: Mushi reads and writes only `LINUX_RUNNER` and `RUNNER_`, with the GitHub token stored in the project's settings (or, without one, the organization's). Never the Mushi GitHub App, which does not have this permission, and never Mushi's own token |

Without Administration: read, Mushi shows the runners it saw in jobs and says
so.

## What CI costs, and where it should run

The **Cost and speed** section of the CI page, `mushi runner compare` and the
MCP tool `get_ci_costs` compare GitHub-hosted runners with your own machines,
per repo. Nothing here changes where your CI runs.

```bash
mushi runner compare           # this project, last 30 days
mushi runner compare --all     # every project your account key can read
mushi runner compare --json
```

For each repo and each place its jobs ran (GitHub-hosted, one of your
machines, or never picked up) you see:

| Figure | Measured or estimated |
| --- | --- |
| Wait p95, run time p50, pull-request pass rate, jobs | Measured from GitHub's job times |
| Minutes billed | Estimated: each job rounded up to a whole minute, as GitHub bills |
| Cost per month | Estimated: GitHub's list price after your included minutes, or your machine's electricity and wear |
| Busy time of your machines | Measured: parallel jobs count once |
| Speed, your machine vs GitHub | Measured only on jobs that passed on both, at least 5 times each; the sample size is shown |

Money is always an estimate. GitHub's bill is the real figure.

### Why it costs what it costs

- **Public repositories run GitHub-hosted minutes free.** Private ones pay
  after the plan's included minutes (Free 2,000, Pro and Team 3,000 a month),
  which every private repo of the same GitHub account shares.
- **Every job bills at least one whole minute.** Twenty 7-second checks bill
  20 minutes; run them as steps of one job instead.
- **macOS costs about 10× Linux** a minute (Linux $0.006, Windows $0.010,
  macOS $0.062; Mushi shows the date it read GitHub's price list).
- **Re-runs bill again on GitHub**, and cost only electricity on your machine.
- **Jobs pinned to GitHub stay there.** A job that names
  `runs-on: ubuntu-latest # pixel baselines are captured on hosted` does not
  move with a runner variable; Mushi shows the comment as the reason.
- **Main-branch and Dependabot runs often always use GitHub**, when the
  workflow checks `github.ref` or `github.actor` before reading the variable.
- **GitHub gives private repos smaller machines** (2 CPUs, 8 GB) than public
  ones (4 CPUs, 16 GB), which is often why your own machine is faster.
- **A job no runner picks up expires after 24 hours.** It costs nothing, and
  the fix it was testing was never tested.

### Your figures

**Settings → General → CI cost** holds the figures behind the estimates, per
organization: your GitHub plan, the idle and under-load watts of your
machines, your price per kWh and currency, an optional wear cost per busy
hour, and which runners share one physical machine (`Alienware: aw-,
alienware-`). Until you save them, Mushi uses example figures and says so.
On WSL2, `mushi runner heartbeat` sends a hash of the VM's boot id, so
distros on one PC count as one machine without any setting.

### Advice

Cost advice comes with the numbers behind it: a private repo paying for
GitHub minutes while your runner sits idle, a public repo queueing on your
machine when GitHub would run it free, a workflow reading `vars.LINUX_RUNNER`
in a repo with no such variable (every job falls back to GitHub), jobs pinned
to GitHub and what they cost, many tiny jobs, and a public repo running on your
own machine (a pull request from a fork can run code there).

## Change where CI runs

Most workflows that can run on your own machine pick their runner from a repo
variable:

```yaml
runs-on: ${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-latest' }}
```

The **Where CI runs** section of the CI page shows, for each repo, which jobs
read `LINUX_RUNNER` (or a `RUNNER_` variable) and where they run
now. You can move them between GitHub-hosted runners and one of your runner
labels. Mushi changes only that variable: never runner labels, registrations,
runner groups, or another tool's dispatcher.

Every change goes through four steps:

1. **Preview.** Nothing changes. You see the jobs that move and the ones that
   stay, with the reason: pinned to GitHub in the workflow (the comment next to
   `runs-on`), main-branch and Dependabot runs, or a different variable. You
   also see how many runners with the target label are online, how long jobs
   wait there, the estimated cost change, and warnings, such as no online
   runner for the label (jobs would wait, then expire after 24 hours) or a
   public repo where a pull request from a fork could run code on your
   machine.
2. **Request.** Anyone who is not a viewer can ask, in the console, with
   `mushi runner placement request`, or with the MCP tool
   `request_ci_placement_change`. Mushi builds the change itself from the
   preview, including the variable's current value.
3. **Approve.** A team owner or admin approves exactly that change in the
   console. An API key can never approve. The approval lasts an hour.
4. **Run.** The owner or admin runs it from the console. If the variable
   changed since the preview, Mushi refuses with `VARIABLE_MOVED` and you
   preview again.

After a change, Mushi watches the next 10 jobs that read the variable. It
raises an alert if one lands on another runner or waits more than 30
minutes. **Ask to revert** requests the reverse change, which goes through the
same approval.

```bash
mushi runner placement show
mushi runner placement preview --repo you/your-app --value my-runner-label
mushi runner placement request --repo you/your-app --value my-runner-label --reason "save paid minutes"
mushi runner placement preview --repo you/your-app --remove     # back to GitHub-hosted
```

### Your CI agreement

**Settings → General → CI policy** records the rules Mushi checks at the
request and again when the change runs. Mushi fills in nothing for you:

- **No paid GitHub-hosted minutes on private repos**, with a list of repos
  allowed anyway. Only an owner can turn this rule off.
- **External controllers**: another tool that decides where some repos run
  (for example a dispatcher that flips runner labels). Mushi shows those
  repos read-only and never competes with it.
- **Standby runners**: runner names or labels that are only a fallback
  (`kensaurus-local-*`). They are never a target.

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
