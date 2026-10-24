---
"@mushi-mushi/mcp": patch
---

`list_qa_story_runs` and `get_qa_story_run` take an optional `projectId` (`project_id` too), so an account connection can read QA runs for another app instead of only the configured project.
