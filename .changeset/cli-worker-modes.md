---
'@mushi-mushi/cli': minor
---

`mushi work --daemon` runs three more lane modes, chosen on Pipeline → Workers:

- **Resolve merge conflicts** (`conflicts`): takes a merge-queue PR of the lane's own repository that waits for a conflict agent. It merges the base branch into the commit Mushi saw, and lets the agent change only the conflicted files. It refuses the result when a conflict marker is left or any other file changed. Then it commits with your hooks and pushes the merge commit, fast-forward only.
- **Audit the code, screen by screen** (`audit`): a model proposes bugs in read-only mode. Each comes with the line, the code there and a check (a pattern, or one of the repo's lint, typecheck, test or check scripts). The machine runs the check itself, an optional second model may only veto, and only reproduced findings are filed.
- **Run skill runs** (`skill`): runs only the rounds of skill runs started on /credits with this lane.

The heartbeat now names each lane's repository (`owner/name` from its origin remote), never its path. `lanes.conf` imports the new modes, and `mushi worker status` shows each lane's mode. A command whose child process keeps the output open no longer hangs the worker: it answers 30 seconds after the command exits.
