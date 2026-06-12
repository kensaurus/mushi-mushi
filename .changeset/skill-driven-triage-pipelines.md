---
"@mushi-mushi/cli": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/plugin-sdk": minor
"@mushi-mushi/plugin-cursor-cloud": minor
---

Add skill-driven triage pipelines — attach a Cursor agent-skill chain to any report and run it as a live pipeline.

- **CLI**: new `mushi skills` (`list`, `show`, `sync`) and `mushi pipeline` (`start`, `watch`, `checkin`) command groups. Browse the synced skill catalog, start a pipeline for a report, print the composed run packet, and check step progress back in from the terminal or CI.
- **MCP**: five new tools so a Cursor agent can close the loop without leaving the IDE — `list_skills` and `get_skill` (read), plus `start_skill_pipeline`, `get_pipeline_run`, and `checkin_pipeline_step` (write). Each tool now advertises the correct title and `readOnlyHint` from the shared catalog so MCP clients render the right UI.
- **plugin-sdk**: new `skill_pipeline.step.dispatched` event. Plugins can subscribe to react when a pipeline step is dispatched in cloud mode; the event payload carries `{ runId, stepIndex, skillSlug, contextPacket, projectId }`.
- **plugin-cursor-cloud**: handles `skill_pipeline.step.dispatched` by running the step's pre-composed context packet as a Cursor Cloud agent, storing the agent run id on the step, and checking the step back in. Emits a clear warning when `MUSHI_API_KEY` or `repoUrl` is unset so dispatches can no longer fail silently.

The new CLI and MCP skill commands correctly unwrap the API response envelope, so run, skill, and pipeline payloads are always populated.
