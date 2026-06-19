import { describe, expect, it } from 'vitest'
import {
  membersNavBadge,
  projectsNavBadge,
  projectsNeedingAttentionCount,
  workspaceSectionAttention,
} from './workspaceNavMeta'

describe('projectsNeedingAttentionCount', () => {
  it('sums never-ingested projects and stale-key signal', () => {
    expect(projectsNeedingAttentionCount({ neverIngestedCount: 2, staleKeyCount: 0 })).toBe(2)
    expect(projectsNeedingAttentionCount({ neverIngestedCount: 0, staleKeyCount: 5 })).toBe(1)
    expect(projectsNeedingAttentionCount({ neverIngestedCount: 2, staleKeyCount: 5 })).toBe(3)
  })
})

describe('projectsNavBadge', () => {
  it('returns attention mode when setup issues exist', () => {
    const badge = projectsNavBadge({ projectCount: 6, neverIngestedCount: 2, staleKeyCount: 0 })
    expect(badge?.mode).toBe('attention')
    expect(badge?.count).toBe(2)
    expect(badge?.tone).toBe('warn')
  })

  it('returns inventory mode when all projects are healthy', () => {
    const badge = projectsNavBadge({ projectCount: 6, neverIngestedCount: 0, staleKeyCount: 0 })
    expect(badge).toEqual({
      mode: 'inventory',
      count: 6,
      label: '6 projects in workspace',
    })
  })

  it('returns null when workspace is empty', () => {
    expect(projectsNavBadge({ projectCount: 0, neverIngestedCount: 0, staleKeyCount: 0 })).toBeNull()
  })
})

describe('membersNavBadge', () => {
  it('prioritizes pending invites as attention', () => {
    const badge = membersNavBadge({ memberCount: 4, pendingInvites: 2 })
    expect(badge?.mode).toBe('attention')
    expect(badge?.count).toBe(2)
  })

  it('shows member inventory when no pending invites', () => {
    const badge = membersNavBadge({ memberCount: 4, pendingInvites: 0 })
    expect(badge?.mode).toBe('inventory')
    expect(badge?.count).toBe(4)
  })
})

describe('workspaceSectionAttention', () => {
  it('aggregates project and invite attention', () => {
    const result = workspaceSectionAttention({ projectsNeedingAttention: 2, pendingInvites: 1 })
    expect(result?.count).toBe(3)
    expect(result?.label).toContain('project setup')
    expect(result?.label).toContain('pending invite')
  })

  it('returns null when workspace is clear', () => {
    expect(workspaceSectionAttention({ projectsNeedingAttention: 0, pendingInvites: 0 })).toBeNull()
  })
})
