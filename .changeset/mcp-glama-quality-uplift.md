---
"@mushi-mushi/mcp": minor
---

Tool-definition quality and surface cleanup for better agent ergonomics (and Glama score):

- **Rewrote every tool description** to a consistent template — front-loaded verb + object, explicit return shape, side-effects/idempotency, usage guidance with sibling cross-references, and an example. All four annotation hints (`readOnly`, `destructive`, `idempotent`, `openWorld`) are now explicit per tool.
- **Renamed off-pattern tools to `verb_object`** (old names still resolve for one release via the deprecated-alias map): `fix_suggest` → `suggest_fix`, `inventory_get` → `get_inventory`, `inventory_diff` → `diff_inventory`, `inventory_findings` → `list_gate_findings`, `graph_neighborhood` → `get_graph_neighborhood`, `graph_node_status` → `get_graph_node`.
- **Removed deprecated tools** superseded by a single entry point: `setup_check`, `ingest_setup_check`, and `diagnose_connection` are replaced by `diagnose_setup` (`mode=full|ingest|dispatch`); `get_activation_status` → the `activation_status` tool/resource; `get_reporter_thread` → `get_report_timeline`.
- **Lean default tool surface.** When `MUSHI_FEATURES` is unset, the stdio server now exposes the focused `DEFAULT_FEATURE_GROUPS` (triage + fixes + inventory + setup + docs) instead of the full catalog. Set `MUSHI_FEATURES=all` (or a CSV of groups, e.g. `triage,qa,skills`) to widen the surface. The CODEBASE tools are now grouped under `codebase`.
