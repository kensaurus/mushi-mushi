---
"@mushi-mushi/mcp": patch
---

Trim trailing slashes in `mcpIconUrl()` with a linear character scan instead of
the `/\/+$/` regex. Resolves CodeQL `js/polynomial-redos`: the anchored
`\/+$` pattern degrades to quadratic backtracking on a long all-slash input.
No behavioural change to the returned icon URL.
