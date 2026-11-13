---
"@mushi-mushi/mcp": minor
---

Three new tools for the Journey optimizer. `get_journeys` (read) answers "where do people get stuck in my app, and what should I change?". It returns the journey score, visit stats, the most common paths and each finding: dead ends, pages people leave, loops, reloads, duplicate pages, route variants, orphan and deep pages, and pages nobody visits. Each finding comes with a ready prompt for your coding agent. Filter with `kind`, cap with `limit` (default 20) and add `includeGraph` for the page map. `scan_site_journeys` (write) starts a scan of the live site (up to 40 pages, on your Firecrawl key), so the map also knows the site's links. `record_journeys` (write) opens, extends or stops the visit recording window for apps whose SDK uses `trackSessions: 'on-demand'`, for up to 168 hours and a share of visitors you choose. All three work on stdio and on hosted MCP, in the default `triage` group. The catalog now has 133 tools.
