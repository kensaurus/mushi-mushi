---
'@mushi-mushi/plugin-cursor-cloud': minor
'@mushi-mushi/agents': patch
---

Cursor Cloud integration hardening — security, correctness, and `qa_story.failed` handler.

## `@mushi-mushi/plugin-cursor-cloud` — security & new event

### Breaking: mandatory `webhookSecret`
`createCursorCloudPlugin` now requires an explicit `webhookSecret` option (or
`MUSHI_PLUGIN_WEBHOOK_SECRET` env var). The previous behaviour derived the
HMAC secret from `workspaceId`, making it trivially forgeable by anyone who
knew the workspace. Existing self-hosted installs must add
`MUSHI_PLUGIN_WEBHOOK_SECRET` to their env before upgrading.

### New: `qa_story.failed` event handler
The plugin now dispatches a Cursor Cloud Agent run whenever a QA story run
fails all its assertions. Configure `repoUrl` in the plugin options to enable.
The agent is prompted to investigate the failing assertion and open a draft PR
with a minimal fix.

### Fix: `createCursorAgentRun` response parsing
Cursor's API returns `id` or `agentId` depending on the endpoint version.
The plugin now accepts both fields so the returned `agentId` is never empty.

## `@mushi-mushi/agents` — REST path, correct MIME types, `workspaceId`/`maxIterations`

### Fix: switched from `@cursor/sdk` to Cursor REST API
`CursorCloudAgent.generateFix` now calls `POST https://api.cursor.com/v0/agents`
directly (same surface as the Marketplace plugin) and polls for completion.
This ensures `workspaceId` and `maxIterations` from `project_settings` are
forwarded to Cursor — the SDK `v1 Agent.create()` path did not expose those
fields, making the "Max iterations" setting in Marketplace silently inert.

### Fix: IANA-compliant MIME types for artifacts
`classifyArtifactPath` now maps:
- `.jpg` → `image/jpeg` (was `image/jpg`, not a registered IANA type)
- `.mov` → `video/quicktime` (was `video/mov`, not a registered IANA type)

These incorrect values were persisted in `fix_attempts.cursor_artifacts` and
caused any downstream code doing `mime === 'image/jpeg'` to miss screenshots.

### Fix: fail-fast for missing `workspaceId`
`generateFix` now returns a descriptive failure immediately when
`cursor_workspace_id` is not configured, instead of silently dispatching an
incomplete agent run.
