# @mushi-mushi/plugin-cursor-cloud

## 0.4.0

### Minor Changes

- 0c66aa9: Cursor Cloud integration hardening — security, correctness, and `qa_story.failed` handler.

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

### Patch Changes

- Updated dependencies [0c66aa9]
  - @mushi-mushi/plugin-sdk@0.6.0

## 0.3.0

### Minor Changes

- **Breaking: mandatory `webhookSecret`** — `createCursorCloudPlugin` now requires
  `webhookSecret` (or `MUSHI_PLUGIN_WEBHOOK_SECRET` env var). The previous scheme
  derived the HMAC secret from `workspaceId`, making it trivially forgeable.
  Self-hosted installs must set `MUSHI_PLUGIN_WEBHOOK_SECRET` before upgrading.

- **New `qa_story.failed` event handler** — dispatches a Cursor Cloud Agent run
  when a QA story fails all assertions. Requires `repoUrl` in plugin options.
  The agent opens a draft PR with a targeted fix.

### Patch Changes

- Fix `createCursorAgentRun` response parsing to accept both `id` and `agentId`
  fields from Cursor's API response, preventing an empty agent ID on some endpoint
  versions.

## 0.2.0

### Minor Changes

- Cursor Cloud Agent integration — dispatch a Cursor Cloud Agent to auto-fix classified reports.

  ## New package: `@mushi-mushi/plugin-cursor-cloud`

  First-party Mushi Marketplace plugin that dispatches a Cursor Cloud Agent run when qualifying events fire (`report.classified`, `fix.requested`, `qa_story.failed`). The agent opens a signed draft PR automatically — no manual triage required.

  Install from Admin → Marketplace → Cursor Cloud Agent, supply your API key and workspace ID, and configure per-severity severity gating. The plugin calls the Cursor REST API directly (no `@cursor/sdk` peer dep needed at the call site — the SDK is node-only and used only in the Path B orchestrator).

  ## `@mushi-mushi/plugin-sdk` — new events

  Three new event names added to `MushiEventName`:
  - `fix.requested` — fires when a fix dispatch has been requested, before the agent launches.
  - `qa_story.failed` — fires when a QA story run fails all its assertions.
  - `qa_story.passed` — fires when a QA story run passes.

  Corresponding sample envelopes added to the `mushi-plugin simulate` CLI for local development.

  ## `@mushi-mushi/cli` — `mushi fix` command

  New `fix` verb for dispatching an agentic fix from the terminal:

  ```bash
  mushi fix <reportId> --agent cursor_cloud --model composer-latest --wait
  ```

  Options: `--agent`, `--model`, `--no-auto-pr`, `--wait` (polls until terminal state; exits non-zero on failure). Streams structured events to stdout — JSON when piped, human-readable in a TTY. Integrates cleanly with CI pipelines.

  ## `@mushi-mushi/mcp` — `dispatch_fix` Cursor Cloud support

  `dispatch_fix` tool extended with:
  - `agent` enum: `claude_code | codex | rest_worker | mcp | cursor_cloud`
  - `backend` alias (deprecated — prefer `agent`)
  - `cursorModel` optional override when `agent = cursor_cloud`
  - `outputSchema` returns `{ fixId, status, agentId?, runId?, prUrl? }` — typed output for modern MCP clients

  ## `@mushi-mushi/core` — `report:dispatched` event

  New `MushiEventType` value `'report:dispatched'` emitted by the Web SDK after a report is submitted if the backend auto-dispatched a Cursor Cloud Agent fix. Host pages can subscribe to show a toast or update the UI.

### Patch Changes

- Updated dependencies
  - @mushi-mushi/plugin-sdk@0.5.0
