---
'@mushi-mushi/cli': patch
---

`mushi work` runs a failed pre-commit hook once more on the same change before it gives up, as it already did for the pre-push hook. A typecheck hook that died under load no longer throws away a finished fix and the agent run behind it; a hook that fails twice is still the change's failure.
