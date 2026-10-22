import { describe, expect, it } from 'vitest'
import { SCOPE_PRESETS, canDeleteProject, canManageProject, isScopePresetId, projectKeyCounts, scopeBadgeTone, type Project } from './project-models'

const base = { organization_id: 'org1', organization_role: null } as unknown as Project

// QA bugs 128, 129: organization_role is null for project-only members and
// legacy owners, and the old rule read null as "owner".
describe('project capability helpers', () => {
  it('follow the server-computed capabilities', () => {
    expect(canDeleteProject({ ...base, can_delete: false })).toBe(false)
    expect(canManageProject({ ...base, can_manage: false })).toBe(false)
    expect(canDeleteProject({ ...base, can_delete: true })).toBe(true)
    expect(canManageProject({ ...base, can_manage: true })).toBe(true)
  })

  it('without server fields, a null org role no longer counts as owner', () => {
    expect(canDeleteProject(base)).toBe(false)
    expect(canManageProject(base)).toBe(false)
    expect(canDeleteProject({ ...base, organization_role: 'admin' } as Project)).toBe(true)
  })
})

// QA bug 135: the readout showed workspace-wide key totals beside one project's prefixes.
describe('projectKeyCounts', () => {
  it('counts only this project’s active keys and the active ones never used', () => {
    expect(
      projectKeyCounts([
        { is_active: true, last_seen_at: '2026-10-01' },
        { is_active: true, last_seen_at: null },
        { is_active: false, last_seen_at: null },
      ]),
    ).toEqual({ active: 2, neverSeen: 1 })
  })
})

describe('runner health key template', () => {
  it('mints a runner:write key with the same chip tone as a voice key', () => {
    const runner = SCOPE_PRESETS.find((p) => p.id === 'runner')!
    expect(runner).toMatchObject({ label: 'Runner health', scopes: ['runner:write'] })
    expect(runner.hint).toMatch(/can only report runner health/)
    expect(isScopePresetId('runner')).toBe(true)
    expect(scopeBadgeTone('runner:write')).toBe(scopeBadgeTone('voice:write'))
  })
})
