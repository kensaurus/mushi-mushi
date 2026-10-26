import { describe, expect, it } from 'vitest'
import { withSetupRequiredCounts } from './setupProgress'

const stats = { projectId: 'p1', requiredComplete: 3, requiredTotal: 3, setupDone: true, projectName: 'mushi-demo' }

describe('withSetupRequiredCounts', () => {
  it('takes /v1/admin/setup counts, and ready only when both agree (mushi-demo 3/4, SDK never seen)', () => {
    const out = withSetupRequiredCounts(stats, { project_id: 'p1', required_complete: 3, required_total: 4, done: false })
    expect(out).toEqual({ ...stats, requiredComplete: 3, requiredTotal: 4, setupDone: false })
  })

  it('keeps the page stats for another project or while setup is loading', () => {
    expect(withSetupRequiredCounts(stats, { project_id: 'p2', required_complete: 1, required_total: 4, done: false })).toBe(stats)
    expect(withSetupRequiredCounts(stats, null)).toBe(stats)
  })

  it('both done reads ready', () => {
    expect(withSetupRequiredCounts(stats, { project_id: 'p1', required_complete: 4, required_total: 4, done: true }).setupDone).toBe(true)
  })
})
