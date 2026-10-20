---
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": minor
---

Every pull request a cloud coding agent opens as a fix now gets an independent review by Claude Opus 5.5 on your own Anthropic key: merge, fix first or hold, with findings, removed behaviour and decisions that need you. A "hold" stops every Mushi merge path (the console, `merge_fix`, `mushi fixes merge`) until a project member overrides it in the console with a reason; the CLI and MCP cannot override. Mushi merges only the commit it reviewed. `get_fix_timeline` returns the review, `merge_fix` reports it, and the CLI adds `mushi fixes review <fixId> [--show]`.
