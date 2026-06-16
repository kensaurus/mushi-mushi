---
"@mushi-mushi/cli": patch
---

Internal refactor: split the monolithic CLI entrypoint into per-domain command
modules (`commands/account`, `audit`, `deploy`, `diagnostics`, `feedback`,
`fix`, `integrations`, `keys`, `lessons`, `project`, `qa`, `reports`, `setup`,
`skills`, `tdd`) backed by shared `cli-shared` (resilient `apiCall` with
timeout + abort + graceful error handling) and `cli-types` helpers. The command
surface, flags, and output are unchanged.
