---
"@mushi-mushi/mcp": patch
---

`dispatch_fix` takes an optional `targetRepoId` (`target_repo_id` works too): the linked repo (`project_repos.id`) the fix PR opens against, for a project with several repos. Omit it to keep using the primary repo. The id must belong to the report's project; anything else is refused with `400 TARGET_REPO_NOT_IN_PROJECT`.
