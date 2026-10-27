/**
 * FILE: apps/admin/src/components/reports/allAppsRowActions.ts
 * PURPOSE: All-apps triage stays honest about which app an action belongs to.
 *
 * The header keeps the last concrete app while All apps is on. Dispatch
 * preflight and bulk edits are loaded for that one app. A row from another
 * app must not reuse them.
 */

import type { PreflightState } from '../../lib/useDispatchPreflight'

export const OTHER_APP_BULK_REASON =
  'Bulk actions apply to the app in the header. Deselect bugs from other apps.'

export function otherAppDispatchNote(projectName: string | null | undefined): string {
  const app = projectName?.trim()
  return app
    ? `This bug is in ${app}. Open it to dispatch a fix for that app.`
    : 'This bug is in another app. Open it to dispatch a fix for that app.'
}

/**
 * `preflightProjectId` null means one-app mode: every row shares the page
 * preflight. A string means All apps: only rows of that app get it.
 */
export function preflightForReportRow(
  preflight: PreflightState | undefined,
  preflightProjectId: string | null | undefined,
  row: { project_id: string; project_name?: string | null },
): { preflight?: PreflightState; dispatchScopeNote: string | null } {
  if (preflightProjectId == null || row.project_id === preflightProjectId) {
    return { preflight, dispatchScopeNote: null }
  }
  return { preflight: undefined, dispatchScopeNote: otherAppDispatchNote(row.project_name) }
}

/** True when the selection includes a bug that is not the pinned app. */
export function selectionCrossesPinnedApp(
  rows: ReadonlyArray<{ id: string; project_id: string }>,
  selected: ReadonlySet<string>,
  pinnedProjectId: string | null,
): boolean {
  for (const row of rows) {
    if (!selected.has(row.id)) continue
    if (row.project_id !== pinnedProjectId) return true
  }
  return false
}
