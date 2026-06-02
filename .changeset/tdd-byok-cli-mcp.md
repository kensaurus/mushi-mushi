---
"@mushi-mushi/cli": minor
"@mushi-mushi/mcp": minor
---

feat(cli,mcp): TDD story-mapping + PDCA commands and BYOK multi-key pool management

Adds the Phase 4 TDD surface to the CLI and MCP server:

- CLI: `mushi stories map`, `mushi tdd gen|improve|run|pending|approve`, and `mushi keys list|add` (the latter reads `MUSHI_BYOK_KEY` from the env so secrets stay out of shell history).
- MCP tools: `map_user_stories`, `get_map_run_status`, `generate_tdd_from_story`, `improve_qa_story`, `run_qa_story`, `list_byok_keys`, `add_byok_key`, `list_pending_review_stories`, `approve_qa_story` — all scope-gated via the shared catalog.
