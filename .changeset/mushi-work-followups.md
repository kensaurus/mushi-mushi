---
'@mushi-mushi/cli': patch
---

`mushi work --followups` fixes the Opus "fix first" findings on pull requests `mushi work` opened. Mushi checks the round and sends only the findings that pass its safety screen. The local agent fixes them on the PR's branch, `mushi work` pushes, and Opus reviews the new commit. Each PR gets at most 2 rounds, as cloud-agent PRs do.
