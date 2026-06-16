---
"@mushi-mushi/mcp": minor
---

Add four Codebase Atlas MCP tools and structured request logging.

- New tools: `search_codebase` (semantic + name search), `get_codebase_domains`
  (architectural domain grouping), `analyze_codebase_impact` (change blast-radius),
  and `analyze_wiki_knowledge` (wiki-backed RAG answers) — bringing the MCP
  catalog to full parity with the hosted Codebase Atlas surface.
- The MCP server now emits structured per-request API logs (request id +
  duration + status) for observability.
