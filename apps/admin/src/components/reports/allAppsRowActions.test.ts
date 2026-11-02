/**
 * FILE: apps/admin/src/components/reports/allAppsRowActions.test.ts
 * PURPOSE: All-apps rows do not reuse the pinned app's dispatch checklist,
 *          and a mixed selection cannot be bulk-edited as one app.
 */

import { describe, expect, it } from 'vitest'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import {
  OTHER_APP_BULK_REASON,
  otherAppDispatchNote,
  preflightForReportRow,
  selectionCrossesPinnedApp,
} from './allAppsRowActions'

const PINNED = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const OTHER = '542b34e0-019e-41fe-b900-7b637717bb86'

const preflight = {
  loading: false,
  ready: false,
  checks: [],
  failing: [{ key: 'github', ready: false, label: 'GitHub connected', hint: '', fixHref: '/connect' }],
  error: null,
  reload: () => {},
  repoUrl: 'https://github.com/acme/pinned',
} as PreflightState

describe('preflightForReportRow', () => {
  it('shares the checklist in one-app mode and for the pinned app', () => {
    expect(preflightForReportRow(preflight, null, { project_id: OTHER }).preflight).toBe(preflight)
    expect(preflightForReportRow(preflight, null, { project_id: OTHER }).dispatchScopeNote).toBeNull()
    expect(preflightForReportRow(preflight, PINNED, { project_id: PINNED }).dispatchScopeNote).toBeNull()
  })

  it('drops the pinned checklist for a bug in another app and names that app', () => {
    const row = preflightForReportRow(preflight, PINNED, { project_id: OTHER, project_name: 'yen-yen' })
    expect(row.preflight).toBeUndefined()
    expect(row.dispatchScopeNote).toBe(otherAppDispatchNote('yen-yen'))
    expect(row.dispatchScopeNote).toContain('yen-yen')
    expect(otherAppDispatchNote(null)).toContain('another app')
  })
})

describe('selectionCrossesPinnedApp', () => {
  const rows = [
    { id: 'a', project_id: PINNED },
    { id: 'b', project_id: OTHER },
  ]

  it('is false when every selected bug is the pinned app', () => {
    expect(selectionCrossesPinnedApp(rows, new Set(['a']), PINNED)).toBe(false)
    expect(OTHER_APP_BULK_REASON).toMatch(/header/)
  })

  it('is true when the selection includes another app', () => {
    expect(selectionCrossesPinnedApp(rows, new Set(['a', 'b']), PINNED)).toBe(true)
    expect(selectionCrossesPinnedApp(rows, new Set(['b']), PINNED)).toBe(true)
    expect(selectionCrossesPinnedApp(rows, new Set(['a']), null)).toBe(true)
  })
})
