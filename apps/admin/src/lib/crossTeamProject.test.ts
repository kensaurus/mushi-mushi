import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./supabase', () => ({ apiFetch }))

import { findProjectTeam, lastTeamProject, rememberTeamProject } from './crossTeamProject'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const ORG_C = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'

describe('findProjectTeam', () => {
  beforeEach(() => apiFetch.mockReset())

  it('returns the other team that owns the project, skipping the active one', async () => {
    apiFetch.mockImplementation(async (path: string, opts?: { headers?: Record<string, string> }) => {
      if (path === '/v1/org') {
        return {
          ok: true,
          data: { organizations: [{ id: ORG_A, name: 'A' }, { id: ORG_B, name: 'B' }, { id: ORG_C, name: 'C' }] },
        }
      }
      const org = opts?.headers?.['X-Mushi-Org-Id']
      return { ok: true, data: { projects: org === ORG_C ? [{ id: PROJECT }] : [] } }
    })

    await expect(findProjectTeam(PROJECT, ORG_A)).resolves.toEqual({ id: ORG_C, name: 'C' })
    const probed = apiFetch.mock.calls.filter(([p]) => p === '/v1/admin/projects').map(([, o]) => o.headers['X-Mushi-Org-Id'])
    expect(probed).toEqual([ORG_B, ORG_C])
    // Another team's list must bypass the path-keyed micro-cache.
    expect(apiFetch.mock.calls.find(([p]) => p === '/v1/admin/projects')?.[1].cache).toBe('no-store')
  })

  it('returns null when no team owns it', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === '/v1/org'
        ? { ok: true, data: { organizations: [{ id: ORG_A, name: 'A' }, { id: ORG_B, name: 'B' }] } }
        : { ok: true, data: { projects: [] } },
    )
    await expect(findProjectTeam(PROJECT, ORG_A)).resolves.toBeNull()
  })
})

describe('team project memory', () => {
  beforeEach(() => window.localStorage.clear())

  it('remembers the last project per team', () => {
    expect(lastTeamProject(ORG_A)).toBeNull()
    rememberTeamProject(ORG_A, PROJECT)
    expect(lastTeamProject(ORG_A)).toBe(PROJECT)
    expect(lastTeamProject(ORG_B)).toBeNull()
  })

  it('survives a corrupt stored value', () => {
    window.localStorage.setItem('mushi:last_project_by_org', '{not json')
    expect(lastTeamProject(ORG_A)).toBeNull()
    rememberTeamProject(ORG_A, PROJECT)
    expect(lastTeamProject(ORG_A)).toBe(PROJECT)
  })
})
