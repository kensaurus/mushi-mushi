---
'@mushi-mushi/mcp': patch
---

- **`request_ci_placement_change` takes CI_PROFILE and `revertAfterHours`**: CI_PROFILE (economy, the default, or thorough) is accepted where a workflow reads it, and a move to GitHub-hosted runners can carry `revertAfterHours` (1-168) so it switches back on its own.
