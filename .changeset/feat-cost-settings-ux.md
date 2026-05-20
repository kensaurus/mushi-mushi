---
"mushi-mushi": minor
---

feat(admin): Cost console overhaul + Settings UX polish

**Cost page (`/cost`)**
- Merged `llm_invocations` (primary telemetry) with legacy `llm_cost_usd` ledger into
  one unified cost view — no gaps between old and new telemetry sources.
- New `CostRawLogTable`: server-side pagination, sort (7 columns), and full-text search
  across operation names, models, and IDs. Powered by URL-synced query params so deep
  links work (`?log_sort=cost_usd&log_order=desc`).
- Backend `/v1/admin/costs` endpoint rewritten to support `page`, `limit`, `sort`,
  `order`, `q` params and return a `{ rows, total, capped }` payload. Falls back to
  the legacy ledger for search across both sources with dedup by ID.
- Summary cards (By operation, By model) now use `OperationChip` for click-through
  to the operation's admin page.

**Settings panels**
- New shared primitives: `SettingsPanelLayout` (2-col lg grid), `SettingsCard`,
  `SettingsFormFooter` (sticky save/discard bar), `SettingsChangeHint` (inline
  "Was: X" delta), `settingsDiff` utilities.
- `GeneralPanel`, `FirecrawlPanel`, `DevToolsPanel`, and `ByokPanel` all migrated
  to the new layout primitives — unsaved changes tracked, change count shown,
  sticky save bar replaces scattered per-field save buttons.

**New chip components**
- `OperationChip` — colour-coded by pipeline category (ingest/fix/iterate/release/intel/qa/ops).
- `PipelineStageChip` — links to the owning admin page.
- `AuditResourceChip` — resource-type chip with tooltip and nav link.
- All chips backed by typed registries (`llmOperations.ts`, `pipelineStages.ts`,
  `auditResources.ts`) with ELI5 descriptions.

**`PageHelp` component enhanced**
- New `PageHelpPanel` with full-width 2-col layout, related-page flow links,
  rich text body, and a "Keep tips open on every page" localStorage preference.
  Cross-tab sync via `CustomEvent`. Auto-open for first-time visitors only.

**Tooltip API widened**
- `Tooltip.content` now accepts `ReactNode` (was `string`), enabling rich tooltip
  bodies used by all new chip components.
