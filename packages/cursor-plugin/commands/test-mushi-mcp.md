# Test Mushi MCP

Verify that the Mushi MCP server is reachable and all expected tools/resources/prompts are advertised correctly.

## Steps

1. Call `list_projects` — confirm it returns at least one project and shows a valid `name` and `id`.
2. Call `get_recent_reports { limit: 1 }` — confirm you get a valid response (even if empty).
3. Call `get_project_context { project_id: "<id from step 1>" }` — confirm preflight and activation fields are present.
4. Call `get_pipeline_logs { project_id: "<id>", level: "error", limit: 5 }` — confirm the response has an `entries` array.
5. Report back:
   - ✅ Connected — `{toolCount}` tools available
   - ✅ `list_projects` returned `{N}` project(s)
   - ✅ `get_recent_reports` returned `{N}` report(s)
   - ✅ `get_project_context` shows SDK status: `{heartbeat}`
   - ✅ `get_pipeline_logs` returned `{N}` recent entries
   - ❌ Any errors encountered

## Troubleshooting

- **UNAUTHENTICATED / 401**: `MUSHI_API_KEY` is missing or invalid. Mint a new `mcp:read` key at your Mushi project settings.
- **PROJECT_REQUIRED**: Set `MUSHI_PROJECT_ID` in your environment or pass `project_id` explicitly.
- **No tools listed**: The MCP server binary may not be installed. Run `npx @mushi-mushi/mcp` manually to check.
- **Hosted HTTP 404**: Verify the edge function URL in your `mcp.json` matches your Supabase project URL.
