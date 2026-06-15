---
"@mushi-mushi/mcp": patch
---

Fix MCP lessons and pipeline-log tool contracts. `query_lessons` now calls the API with the expected POST body, `get_pipeline_logs` only advertises backend-supported service filters, and the package build now emits the root TypeScript declaration file referenced by `package.json`.
