---
"@mushi-mushi/mcp": minor
---

Add three App Recipe and design-plane tools, on by default in the `inventory` group:

- `get_app_recipe` returns one card per part of the app (schema, design, routes, gates, CI, deploy, env, integrations). Each card is `ok`, `drift`, `unknown`, `not_connected` or `error`, and `unknown` never means healthy.
- `get_design_tokens` returns the app's design tokens plus a `nameMap` from each CSS variable or TS name to its token. A fix can then use the app's tokens instead of hard-coded colours, spacing and fonts.
- `get_design_deviance` returns the 0–100 design deviance score (lower is better), the score for each rule, the trend, and the top off-token findings with the nearest token to use instead.

`get_fix_context` now also returns `recipe`. This is a design excerpt of at most 4 KB with the tokens, the deviance score and the findings in the files the fix touches. When the excerpt can't be read, `recipe` is `{ state, note }` and the rest of the fix context still comes back. `use_mushi` gains a `design` intent, and `list_gate_findings` accepts the `design_drift`, `ci_drift`, `deploy_drift` and `env_drift` gates.
