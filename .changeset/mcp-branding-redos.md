---
"@mushi-mushi/mcp": patch
---

- **ReDoS fix in MCP branding**: `mcpIconUrl()` now trims trailing slashes with a linear character scan instead of the `/\/+$/` regex, which degraded to quadratic backtracking on a long all-slash input (CodeQL `js/polynomial-redos`). The returned icon URL is unchanged.
