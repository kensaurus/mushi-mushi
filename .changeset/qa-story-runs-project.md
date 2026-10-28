---
'@mushi-mushi/mcp': patch
---

`list_qa_story_runs` and `get_qa_story_run` take an optional `projectId`, so an account connection can read QA runs for another app that key can reach. A project-bound connection still refuses a different project.
