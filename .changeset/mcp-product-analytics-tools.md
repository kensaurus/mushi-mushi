---
'@mushi-mushi/mcp': minor
---

Add three product-analytics tools backed by the new events routes: `query_funnel` (an ordered funnel over `Mushi.track()` events, 2–8 steps with a per-step window and optional breakdown), `get_product_events_summary` (event names, counts, distinct users and daily volume — call it first to discover event names) and `get_user_paths` (what users did next after a given event). The bundled docs index behind `search_mushi_docs` is regenerated from the current docs.

The package root (`import '@mushi-mushi/mcp'`, `main`, `types`) now resolves to the library entry that exports `createMushiServer`, `MushiApiError` and `MushiServerConfig` — the same module as `@mushi-mushi/mcp/server`. It used to point at the stdio binary, which exports nothing and starts a server on import. The `mushi-mcp` bin is unchanged.
