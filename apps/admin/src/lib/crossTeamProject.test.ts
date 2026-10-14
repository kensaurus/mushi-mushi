import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./supabase', () => ({ apiFetch }))

import {
  claimStaleLinkRecovery,
  findProjectTeam,
  knownProjectTeam,
  lastTeamProject,
  pickRecoveryProject,
  rememberProjectTeams,
  rememberTeamProject,
  resolveTeamForProject,
  urlProjectNeedsTeamCheck,
} from './crossTeamProject'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const ORG_C = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'

const DIRECTORY = {
  teams: [
    { id: ORG_A, name: 'A', role: 'owner', isPersonal: false },
    { id: ORG_B, name: 'B', role: 'member', isPersonal: false },
    { id: ORG_C, name: 'C', role: 'member', isPersonal: false },
  ],
  projects: [{ id: PROJECT, name: 'glot.it', organizationId: ORG_C }],
}

describe('findProjectTeam', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    window.localStorage.clear()
  })

  it('finds the owning team with ONE team-less directory read, whatever the team count', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: DIRECTORY })
    await expect(findProjectTeam(PROJECT, ORG_A)).resolves.toEqual({ id: ORG_C, name: 'C' })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0]).toEqual(['/v1/admin/workspace/projects', { scope: 'none' }])
    // The answer is remembered so the next load needs no read.
    expect(knownProjectTeam(PROJECT)).toBe(ORG_C)
  })

  it('returns null when no team owns it, or it is already the active team', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: DIRECTORY })
    await expect(findProjectTeam('55555555-5555-4555-8555-555555555555', ORG_A)).resolves.toBeNull()
    await expect(findProjectTeam(PROJECT, ORG_C)).resolves.toBeNull()
  })
})

describe('resolveTeamForProject', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    window.localStorage.clear()
  })

  it('switches team first, then project', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: DIRECTORY })
    window.localStorage.setItem('mushi:active_org_id', ORG_A)
    const order: string[] = []
    const onOrg = () => order.push(`org:${window.localStorage.getItem('mushi:active_org_id')}`)
    const onProject = () => order.push(`project:${window.localStorage.getItem('mushi:active_org_id')}`)
    window.addEventListener('mushi:active-org-change', onOrg)
    window.addEventListener('mushi:active-project-change', onProject)
    await expect(resolveTeamForProject(PROJECT)).resolves.toBe('switched')
    window.removeEventListener('mushi:active-org-change', onOrg)
    window.removeEventListener('mushi:active-project-change', onProject)
    expect(order).toEqual([`org:${ORG_C}`, `project:${ORG_C}`])
    expect(window.localStorage.getItem('mushi:active_project_id')).toBe(PROJECT)
  })

  it('asks to retry when signed out instead of giving up', async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: 'MISSING_AUTH', message: 'no' } })
    await expect(resolveTeamForProject(PROJECT)).resolves.toBe('retry')
  })

  // A stale bookmark or a deleted project: no team of the user has it.
  it('says a project in none of the user’s teams is unreachable, and switches nothing', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: DIRECTORY })
    window.localStorage.setItem('mushi:active_org_id', ORG_A)
    await expect(resolveTeamForProject('55555555-5555-4555-8555-555555555555')).resolves.toBe('unreachable')
    expect(window.localStorage.getItem('mushi:active_org_id')).toBe(ORG_A)
    expect(window.localStorage.getItem('mushi:active_project_id')).toBeNull()
  })

  it('concludes nothing from a failed directory read (never "unreachable" on a guess)', async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'boom' } })
    await expect(resolveTeamForProject(PROJECT)).resolves.toBe('unknown')
  })
})

describe('pickRecoveryProject', () => {
  const list = [{ project_id: 'a' }, { project_id: 'b' }]
  it('prefers the project last used in this team when it is still listed', () => {
    expect(pickRecoveryProject(list, 'b')).toEqual({ project_id: 'b' })
  })
  it('falls back to the first project, and to null for an empty team', () => {
    expect(pickRecoveryProject(list, 'gone')).toEqual({ project_id: 'a' })
    expect(pickRecoveryProject(list, null)).toEqual({ project_id: 'a' })
    expect(pickRecoveryProject([], 'a')).toBeNull()
  })
})

describe('urlProjectNeedsTeamCheck', () => {
  beforeEach(() => window.localStorage.clear())

  it('checks unless the project is known to be in the active team', () => {
    // Fresh browser: no team yet, so the link must decide it.
    expect(urlProjectNeedsTeamCheck(PROJECT, null)).toBe(true)
    expect(urlProjectNeedsTeamCheck(PROJECT, ORG_A)).toBe(true)
    rememberProjectTeams([{ id: PROJECT, organizationId: ORG_A }])
    expect(urlProjectNeedsTeamCheck(PROJECT, ORG_A)).toBe(false)
    expect(urlProjectNeedsTeamCheck(PROJECT, ORG_B)).toBe(true)
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

describe('claimStaleLinkRecovery', () => {
  it('lets only the first of the two header switchers recover a stale link', () => {
    const id = '66666666-6666-4666-8666-666666666666'
    expect(claimStaleLinkRecovery(id)).toBe(true)
    expect(claimStaleLinkRecovery(id)).toBe(false)
  })
})
