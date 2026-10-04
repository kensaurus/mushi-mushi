/**
 * `_shared/report-groups.ts` — /graph?tab=backend "Merge groups".
 *
 * Regression: the route ignored every write error and answered ok, and any
 * project member (viewers included) could merge, which deletes a group.
 */
import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { canMergeReportGroups, mergeReportGroups } from '../../supabase/functions/_shared/report-groups.ts'

function seed(failRead?: (t: string) => string | null) {
  return makeFakeDb(
    {
      report_groups: [
        { id: 'g1', project_id: 'p1', report_count: 2 },
        { id: 'g2', project_id: 'p1', report_count: 1 },
      ],
      reports: [
        { id: 'r1', report_group_id: 'g1' },
        { id: 'r2', report_group_id: 'g1' },
        { id: 'r3', report_group_id: 'g2' },
      ],
    },
    failRead ? { failRead } : {},
  )
}

describe('mergeReportGroups', () => {
  it('moves the reports, recounts the target and deletes the source', async () => {
    const db = seed()
    const result = await mergeReportGroups(db as never, 'g1', 'g2')
    expect(result).toEqual({ ok: true, moved: 2, reportCount: 3 })
    expect(db.table('report_groups').map((g) => g.id)).toEqual(['g2'])
    expect(db.table('report_groups')[0]!.report_count).toBe(3)
    expect(db.table('reports').every((r) => r.report_group_id === 'g2')).toBe(true)
  })

  it('keeps the source group when the recount fails', async () => {
    const db = seed((t) => (t === 'reports' ? 'statement timeout' : null))
    const result = await mergeReportGroups(db as never, 'g1', 'g2')
    expect(result.ok).toBe(false)
    expect(db.table('report_groups').map((g) => g.id)).toEqual(['g1', 'g2'])
  })
})

describe('canMergeReportGroups', () => {
  it('lets members and admins merge, never viewers', () => {
    expect(canMergeReportGroups('owner')).toBe(true)
    expect(canMergeReportGroups('admin')).toBe(true)
    expect(canMergeReportGroups('member')).toBe(true)
    expect(canMergeReportGroups('viewer')).toBe(false)
    expect(canMergeReportGroups(null)).toBe(false)
  })
})
