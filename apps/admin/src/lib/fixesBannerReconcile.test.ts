import { describe, expect, it } from 'vitest'
import { EMPTY_FIXES_STATS, type FixesStats } from '../components/fixes/FixesStatsTypes'
import { reconcileFixesStats } from './fixesBannerReconcile'

const healthy: FixesStats = { ...EMPTY_FIXES_STATS, hasAnyProject: true, topPriority: 'healthy', failed: 0 }

describe('reconcileFixesStats (audit 2026-10-20, B3)', () => {
  it('a healthy banner above stopped dispatches becomes a failed banner with their count', () => {
    const out = reconcileFixesStats(healthy, [
      { status: 'failed' },
      { status: 'completed_no_pr' },
      { status: 'skipped' },
      { status: 'running' },
      { status: 'completed' },
    ])
    expect(out.topPriority).toBe('failed')
    expect(out.failed).toBe(3)
    expect(out.topPriorityLabel).toContain('3 dispatches stopped')
  })

  it('leaves the server stats alone when nothing stopped', () => {
    expect(reconcileFixesStats(healthy, [{ status: 'running' }])).toBe(healthy)
  })

  it('does not override a setup priority', () => {
    const noGithub: FixesStats = { ...healthy, topPriority: 'no_github' }
    expect(reconcileFixesStats(noGithub, [{ status: 'failed' }])).toBe(noGithub)
  })

  it('keeps the server wording when it already counts at least as many failures', () => {
    const failed: FixesStats = { ...healthy, topPriority: 'failed', failed: 5, topPriorityLabel: 'server says' }
    expect(reconcileFixesStats(failed, [{ status: 'failed' }, { status: 'failed' }])).toBe(failed)
  })

  it('counts only attention statuses', () => {
    expect(reconcileFixesStats(healthy, [{ status: 'queued' }, { status: 'cancelled' }, { status: 'skipped_no_sandbox' }]).failed).toBe(1)
  })
})
