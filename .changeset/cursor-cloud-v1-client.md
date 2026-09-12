---
"@mushi-mushi/plugin-cursor-cloud": minor
---

Move the Cursor Cloud Agent plugin to the Cursor Cloud Agents **v1** API (`POST /v1/agents` with top-level `autoCreatePR`, `repos[{ url, startingRef }]`, `model.id` and a deterministic `bc-<uuid>` `agentId` so a redelivered Mushi event answers `409 agent_id_conflict` instead of starting a second agent). `fix.requested` events that already carry `data.fix.externalAgentId` (Mushi's own `cursor_cloud` fix-worker path) are logged and skipped so one report never gets two agents. New optional `startingRef` / `apiBase` config; `workspaceId` and `maxIterations` are accepted but deprecated (v1 does not use them). README documents v0 vs v1.
