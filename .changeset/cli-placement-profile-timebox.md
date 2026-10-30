---
'@mushi-mushi/cli': patch
---

- **`mushi runner placement preview|request` takes CI_PROFILE and a time box**: `--variable CI_PROFILE --value economy|thorough` asks to switch a repo's checks on fix pull requests (only where a workflow reads `vars.CI_PROFILE`), and `--revert-after <hours>` (1-168) makes a move to GitHub-hosted runners switch back on its own when the time is up.
