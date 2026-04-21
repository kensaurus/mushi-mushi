---
'@mushi-mushi/mcp': minor
'@mushi-mushi/mcp-ci': minor
---

Wave G2 — MCP becomes the agentic centerpiece.

- `@mushi-mushi/mcp`: five new tools — `trigger_judge`, `dispatch_fix`, `transition_status`, `run_nl_query`, `get_knowledge_graph`. Existing tool endpoints corrected to match the backend API.
- `@mushi-mushi/mcp-ci` (new package): GitHub Action + CLI (`mushi-mcp-ci`) with subcommands `trigger-judge`, `dispatch-fix`, `check-coverage`, `query`. Drop-in merge gate for PRs that must wait for Mushi judge pass before shipping.
