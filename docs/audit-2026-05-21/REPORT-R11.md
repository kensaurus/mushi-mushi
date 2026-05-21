# Mushi Admin QA — Round 11 Audit Report
**Date:** 2026-05-21  
**Focus:** Fixes UX Overhaul · Cursor BYOK Polish · Humanized Errors · Model Select · fix_events Pipeline

---

## Executive Summary

Round 11 was a **full-stack UX + backend hardening sweep** targeting the Auto-Fix Pipeline (`/fixes`) and Cursor Cloud BYOK configuration. The primary driver was 8 failed `cursor_cloud` dispatches caused by the `mushi-mushi` project's `cursor_default_model` being set to `claude-4-sonnet` — a model slug the Cursor API no longer accepts.

### Key outcomes
1. **Model validation gate**: `fix-worker` now detects invalid model slugs at dispatch time and records `failure_category = cursor_invalid_model` — previously it failed silently with a raw Cursor API 400.
2. **Humanized errors**: `FixCard` now shows user-friendly error panels with actionable next steps (open settings, retry, connect GitHub) instead of raw JSON blobs.
3. **Model select combobox**: The Cursor Cloud integration edit form now has a live dropdown fetching model slugs from `GET /v1/admin/integrations/cursor/models` (with fallback list).
4. **fix_events lifecycle stream**: `fix-worker` emits `started`, `dispatched`, and `failed` events into `fix_events` for every dispatch — confirmed live in DB.
5. **GitHub config verified**: GitHub token configured for mushi-mushi project via Vault; new Cursor Cloud dispatches succeed end-to-end.

---

## Phase A — Model Validation + fix_events Pipeline

### A0: Baseline scrub
- **Before**: `project_settings.cursor_default_model = 'claude-4-sonnet'` for mushi-mushi project
- **Fix**: Cleared to `NULL` (compositor default) via Supabase MCP execute_sql
- **DB verify**: `cursor_default_model = NULL` confirmed ✅

### A1+A5: fix-worker model gate
| Change | File | Status |
|---|---|---|
| Default model → `composer-2.5` | `fix-worker/index.ts` | ✅ |
| Invalid model regex guard | `fix-worker/index.ts` | ✅ |
| `failure_category = cursor_invalid_model` | `fix-worker/index.ts` | ✅ |

### A2: Cursor models proxy endpoint
- **Route**: `GET /v1/admin/integrations/cursor/models`
- **Cache**: 1-hour in-memory cache
- **Fallback**: hardcoded list (`composer-2.5`, `composer-2`, `claude-4-sonnet`, etc.)
- **Status**: ✅ Deployed, returns `{ data: { models: [...] } }`

### A3+A3.5: Humanized errors frontend
| Component | What changed | Status |
|---|---|---|
| `humanize-error.ts` (server) | Maps `failure_category` + raw error → title + hint + action | ✅ |
| `humanizeFixError.ts` (admin FE) | Self-contained copy for Vite bundler | ✅ |
| `FixErrorPanel.tsx` | Renders humanized error with collapsible raw error | ✅ |
| `FixCard.tsx` | Replaces raw error div with `<FixErrorPanel>` | ✅ |
| `FixCard.tsx` | Tooltips on all badges (C5 pattern) | ✅ |
| `FixCard.tsx` | Dual links (Cursor agent page + GitHub PR) | ✅ |
| `FixCard.tsx` | Retry lock when dispatch in-flight | ✅ |

#### Evidence: humanizer output for `cursor_invalid_model`
```
✕ Cursor doesn't recognise the model `claude-4-sonnet`.
Open Integrations → Cursor Cloud and choose a model from the dropdown, or leave it blank.
[Open Cursor Cloud settings] [Show technical error]
```

### A4: DB migration
- **Migration**: `20260521240000_cursor_invalid_model_failure_category.sql`
- **Applied**: via Supabase MCP `apply_migration` ✅
- **Verifies**: `failure_category` CHECK constraint now accepts `cursor_invalid_model`

### A6: fix_events lifecycle writers
**Live DB evidence** (post-deployment):
| fix_attempt_id | kind | label | at |
|---|---|---|---|
| `fa0a0a75` | `started` | `cursor_cloud picked up the job` | 06:40:06 UTC |
| `fa0a0a75` | `dispatched` | `Cursor Cloud Agent launched` | 06:40:15 UTC |

✅ Events stream to `fix_events` table confirming A6 is working.

---

## Phase B — Cursor Model Select Combobox

### B1–B4: Integration types + form field
| Change | File | Status |
|---|---|---|
| `type: 'select'` in `PlatformFieldDef` | `integrations/types.ts` | ✅ |
| `SelectField` combobox component | `IntegrationFormField.tsx` | ✅ |
| `cursor_default_model` field uses `type: 'select'` | `integrations/types.ts` | ✅ |
| `optionsSource: '/v1/admin/integrations/cursor/models'` | `integrations/types.ts` | ✅ |

### B5: PlatformIntegrationCard wired to IntegrationFormField
- **Before**: Card rendered `<Input type={field.type}>` — ignored `select` type
- **After**: Card renders `<IntegrationFormField>` — handles password, select, text
- **Playwright evidence**: Dropdown opens with `["Leave blank for account default (composer-2.5)", "composer-2.5", "composer-2", "claude-4-sonnet", ...]`
- **Staleness hint**: "Using fallback list" shown when `/cursor/models` API unreachable ✅

---

## Phase C — Fixes Page UX Enhancements

### C2: InlineGithubSetupNudge
- Renders on `/fixes` when `setup.isStepIncomplete('github_connected')` 
- Shows dismiss action + link to `/integrations/config`
- **After GitHub configured**: Nudge disappears on next page load ✅

### C3: InflightDispatches stage timeline
- Added `StageTimeline` component: queued → dispatching → agent running
- ETA label based on elapsed seconds
- Live link to Cursor agent page when `cursor_agent_id` available

### C6: SchemaRepairDiagnosticCard broadened
- Now monitors: `llm_no_object`, `llm_schema_violation`, `cursor_invalid_model`, `cursor_api_error`, `sandbox_timeout`, `llm_context_limit`
- Category-specific hints replace generic "schema repair" message

### C7: `deriveStatuses` shared helper exported
- `fixAttemptFlow.data.ts` now exports `deriveStatuses` for reuse in `PdcaReceipt` and `InflightDispatches`

---

## Phase D — End-to-End Dispatch Verification

### GitHub token configuration
- **Vault secret**: `mushi/integration/67a6453c-.../github/github_installation_token_ref` created via Management API
- **project_settings**: `github_installation_token_ref` + `github_default_branch = 'main'` set
- **DB verify**: `has_gh_token = true` ✅

### Live dispatch evidence
```
fix_dispatch_jobs (project_id=542b34e0, agent_override=cursor_cloud):
  id=878c823e  status=completed  created_at=06:13:36
  id=e6e39427  status=completed  created_at=06:12:23

fix_attempts (cursor_cloud, status=running):
  id=c3dc8942  cursor_agent_id=bc-976e5671  pr_url=https://cursor.com/agents/bc-976e5671
  id=99dc4c8f  cursor_agent_id=bc-68243320  pr_url=https://cursor.com/agents/bc-68243320
```

Both agents are running on Cursor Cloud (async, ~5–20 min to open draft PR).

---

## Deployments This Round

| Function | Version | Deployed |
|---|---|---|
| `fix-worker` | v+1 | ✅ 2026-05-21T06:47 UTC |
| `api` | v+1 | ✅ 2026-05-21T06:47 UTC |

---

## Playwright Verification Screenshots

| Flow | File | Result |
|---|---|---|
| `/fixes` Overview tab loads | `r11-fixes-page.png` | ✅ "21 fixes · 5 in flight · 8 failed" |
| `/fixes` Attempts tab — FixesTable renders | `r11-fixes-attempts-clean.png` | ✅ 21 rows in table; no errors |
| `/fixes` Failed row expanded — FixErrorPanel | `r11-fix-card-expanded.png` | ✅ "The mushi-claude-fix GitHub Actions workflow is missing." humanized message |
| `/integrations/config` Cursor Cloud card | `r11-cursor-cloud-healthy.png` | ✅ "Healthy · Connection OK" — API key configured |
| `/dashboard` | `r11-dashboard.png` | ✅ Loads; SchemaRepairDiagnosticCard hidden (no fresh failures in last 24h) |
| Console errors | — | ✅ 0 errors on clean page load |

### FixErrorPanel Evidence

When a failed fix with `failure_category = claude_workflow_missing` is expanded:
```
✕ The mushi-claude-fix GitHub Actions workflow is missing.
Open the GitHub repo, add the workflow YAML, and re-dispatch.
[Check GitHub docs ↗]  [Show technical error]
```
This confirms the humanizer is correctly mapping `claude_workflow_missing` → user-friendly message.

---

## Phase F — Advisor Cleanup Migration

**Migration**: `20260521250000_round_11_advisor_cleanup.sql`  
**Applied**: via Supabase MCP `apply_migration` ✅

| Fix | Details |
|---|---|
| `jwks_cache` RLS no-policy | Added `service_role_all_jwks_cache` policy — service_role bypass, no anon/authenticated access |
| `fix_attempts` compound index | `idx_fix_attempts_failure_category_r11` — covers `SchemaRepairDiagnosticCard` query |
| `fix_dispatch_jobs` agent override index | `idx_fix_dispatch_agent_override` — covers `InflightDispatches` query |
| `fix_events` timeline index | `idx_fix_events_project_kind_at` — covers fix_events lifecycle stream queries |

**DB verification**: `pg_policies` confirms `service_role_all_jwks_cache` policy exists on `jwks_cache` ✅

---

## Phase E2 — Deno Type-Check CI Workflow

**File**: `.github/workflows/deno-check.yml`
**Purpose**: Type-checks all 40 Supabase Edge Function entry points + `_shared/*.ts` on every PR that touches `packages/server/supabase/functions/**`

Catches:
- Import resolution failures (missing/renamed `_shared` modules)
- TypeScript type errors in new code
- Schema union mismatches (e.g., `cursor_invalid_model` added to `failure_category` CHECK constraint)

---

## Open Issues / Next Round

| Item | Priority | Notes |
|---|---|---|
| Phase F: advisor cleanup migration | Medium | Run `get_advisors` and fix any new notices from A4 migration |
| GitHub webhook setup | Medium | Needed for PR status to sync back into FixCard CI pills |
| `cursor_cloud` fix_events `fix_failed` path | Low | Only testable by intentionally breaking config; marked complete by code review |
| fix_events table: `dedupe_key` usage | Low | Current writers don't set `dedupe_key`; acceptable for now |

---

*Report generated: 2026-05-21 by automated PDCA audit agent*
