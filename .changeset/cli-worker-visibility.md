---
'@mushi-mushi/cli': minor
---

The local worker now tells the console why it is not working. Each heartbeat carries every run's stage (getting ready, the coding agent, the repo's commit hook, its pre-push hook, opening the PR), how long it has been there, its model and its last few log lines, which lane holds each agent space, the Cursor account check and the `gh` sign-in as they really answered, and the machine's load. Lines are cleaned before they leave the machine: no keys, tokens or paths, e-mail addresses masked. `mushi worker status` lists the same problems the console shows, worst first, with what to do, and exits 2 while one needs you. A run stopped from the console commits and pushes nothing more. A machine with `gh` signed out, or a lane whose clone is not a git clone, now starts and says so instead of exiting, and the Cursor check runs in the background so a slow one never holds the heartbeat.
