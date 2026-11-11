---
'@mushi-mushi/cli': patch
---

`mushi work` now stops with `E_WRONG_REPO` before listing, planning or claiming anything when the `--repo-dir` clone's origin is not a repo the key's project is linked to, so one project's reports are never fixed in another app's repo. `--any-repo` skips the check for a monorepo or a fork. A `mushi work --daemon` lane with the wrong clone stays out and says why.
