---
"@mushi-mushi/cli": patch
---

`mushi fix <reportId> --repo <repoId|owner/name>` sends the fix to one of the project's linked repos instead of the primary one, for example the backend repo of a project whose frontend is primary. A GitHub `owner/name` is looked up among the project's linked repos (needs a project id); a name that is not linked is refused before anything is dispatched, with the linked repos listed.
