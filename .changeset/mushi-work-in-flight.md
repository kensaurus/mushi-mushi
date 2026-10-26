---
'@mushi-mushi/cli': minor
---

`mushi work` registers each run in Mushi when the local agent starts and marks it running, so the console's Fixes page counts it in flight for the whole run, not only after the agent finishes. Every way a run ends closes that record exactly once. Ctrl-C or SIGTERM (for example `systemctl stop`) ends the agent, closes the record as "mushi work stopped by …" within a few seconds and never commits or pushes a half-done change; a stopped or reaped run starts no 7-day retry cooldown. CLI commands can now register cleanups that run on SIGINT/SIGTERM before the process exits (8 s budget; a second signal exits at once).
