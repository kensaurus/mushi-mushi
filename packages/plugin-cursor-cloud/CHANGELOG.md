# @mushi-mushi/plugin-cursor-cloud

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
