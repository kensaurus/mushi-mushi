---
'@mushi-mushi/cli': patch
---

`mushi work` stops when the reports it is given belong to another app than `--project`. An API key bound to one app answers with that app's reports whatever `--project` says, so the agent would have "fixed" them in the wrong repo. The error names both apps and the `mushi login --project-id` command to run.
