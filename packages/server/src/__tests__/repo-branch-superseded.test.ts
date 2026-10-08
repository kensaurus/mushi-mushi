/**
 * /repo's "stuck dispatches" counted a failed attempt even after a later
 * attempt for the same report opened a PR that merged, so the banner told the
 * user to retry work that was already fixed (the-wanting-mind, 2026-10-08).
 */
import { describe, expect, it } from 'vitest'
import {
  classifyRepoBranch,
  countRepoBranches,
  markSupersededFailures,
} from '../../supabase/functions/_shared/repo-branch-counts.ts'

const failed = (report_id: string) => ({ report_id, status: 'failed', pr_url: null })
const merged = (report_id: string) => ({ report_id, status: 'completed', pr_url: 'https://x/pull/1', merged_at: '2026-10-03T10:00:00Z' })
const openPr = (report_id: string) => ({ report_id, status: 'completed', pr_url: 'https://x/pull/2', pr_state: 'open' })

describe('failed attempts a later attempt replaced', () => {
  it('are not stuck once the report has a merged or open PR', () => {
    const counts = countRepoBranches([failed('r1'), merged('r1'), failed('r2'), openPr('r2')])
    expect(counts.failedToOpen).toBe(0)
    expect(counts.merged).toBe(1)
    expect(counts.prOpen).toBe(1)
  })

  it('stay stuck while nothing replaced them', () => {
    expect(countRepoBranches([failed('r1'), failed('r1'), merged('r2')]).failedToOpen).toBe(2)
  })

  it('leave the Stuck filter too, so the tile and the list agree', () => {
    const [row] = markSupersededFailures([failed('r1'), merged('r1')])
    expect(classifyRepoBranch(row)).toBe('other')
    expect(classifyRepoBranch(failed('r9'))).toBe('failed')
  })
})
