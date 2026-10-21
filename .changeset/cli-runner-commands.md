---
'@mushi-mushi/cli': minor
---

New `mushi runner` commands (ADR 0033): see where your tests run and why a fix waits to land.

- `mushi runner status` shows your machines, runners (online, busy, offline, memory, out-of-memory kills), how long jobs wait and run, how many failures were the test machine and how many were code, and what to do first.
- `mushi runner heartbeat` sends this machine's memory, swap, load and runner services every 2 minutes (`--once` for a timer, `--dry-run` to see the JSON). The machine id is hashed; no file contents, environment values or process arguments are sent.
- `mushi runner hooks install --dir <runner>` adds GitHub job hooks that report each job's memory peak and out-of-memory kills. They always exit 0 and never fail a job.
- `mushi runner add --repo owner/name` sets this machine up as a GitHub Actions runner with safe defaults: private repos only, one job per runner, a dedicated non-admin user, a memory cap, its own label, a checked download, and optional `--block-lan` and `--wsl-isolate`. `--dry-run` prints the whole plan.
- `mushi runner audit` lists the self-hosted runners on your repos and flags ones Mushi did not set up, any named like the Shai-Hulud backdoor, weak fork approval and `pull_request_target` workflows.
