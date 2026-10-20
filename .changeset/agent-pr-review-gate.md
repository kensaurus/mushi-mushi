---
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": minor
---

Every pull request a cloud coding agent opens as a fix now gets an independent review by Claude Opus 5.5 on your own Anthropic key: merge, fix first or hold, with findings, removed behaviour and decisions that need you. A "hold" stops Mushi from merging the pull request until you override it. `merge_fix` takes `override` and `overrideReason`, and `get_fix_timeline` returns the review. The CLI adds `mushi fixes merge --override [--reason]` and `mushi fixes review <fixId> [--show]`.
