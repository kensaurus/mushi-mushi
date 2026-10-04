/**
 * FILE: apps/admin/src/lib/apiFetchTeamGate.test.ts
 * PURPOSE: A4 — a Slack/email deep link to a project in another team must not
 *          send its first requests with the previous team's X-Mushi-Org-Id
 *          (every panel 404'd PROJECT_NOT_FOUND). apiFetch resolves the
 *          project's team from the cross-team directory BEFORE the first
 *          team-scoped request, and skips that read when the browser already
 *          knows the project is in the active team.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'test-token', expires_at: 9_999_999_999 } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock('./env', () => ({
  RESOLVED_SUPABASE_URL: 'http://supabase.local',
  RESOLVED_SUPABASE_ANON_KEY: 'anon',
  RESOLVED_API_URL: 'http://api.local',
}))

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const PROJECT_IN_B = '44444444-4444-4444-8444-444444444444'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { ok: true, data } : data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type Call = { url: string; headers: Record<string, string> }

function directoryFetch(calls: Call[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    if (url.endsWith('/v1/admin/workspace/projects')) {
      return jsonResponse({
        teams: [
          { id: ORG_A, name: 'Mushi', role: 'owner', isPersonal: false },
          { id: ORG_B, name: 'glot', role: 'owner', isPersonal: false },
        ],
        projects: [{ id: PROJECT_IN_B, name: 'glot.it', organizationId: ORG_B }],
      })
    }
    return jsonResponse({ fine: true })
  })
}

async function freshModules() {
  vi.resetModules()
  const supabase = await import('./supabase')
  const activeOrg = await import('./activeOrg')
  const activeProject = await import('./activeProject')
  const crossTeam = await import('./crossTeamProject')
  return { ...supabase, ...activeOrg, ...activeProject, ...crossTeam }
}

describe('apiFetch team gate for cross-team deep links', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it("sends the project's own team on the FIRST scoped request", async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    window.history.replaceState({}, '', `/integrations?project=${PROJECT_IN_B}`)

    const res = await m.apiFetch('/v1/admin/integrations')

    expect(res.ok).toBe(true)
    // The directory read carries no team at all…
    const dir = calls.find((c) => c.url.endsWith('/v1/admin/workspace/projects'))
    expect(dir?.headers['X-Mushi-Org-Id']).toBeUndefined()
    // …and no scoped request ever leaves with the old team.
    const scoped = calls.filter((c) => !c.url.endsWith('/v1/admin/workspace/projects'))
    expect(scoped).toHaveLength(1)
    expect(scoped[0].headers['X-Mushi-Org-Id']).toBe(ORG_B)
    expect(scoped[0].headers['X-Mushi-Project-Id']).toBe(PROJECT_IN_B)
    expect(m.getActiveOrgIdSnapshot()).toBe(ORG_B)
    expect(m.getActiveProjectIdSnapshot()).toBe(PROJECT_IN_B)
  })

  it('announces the switch so the header can say which team it moved to', async () => {
    vi.stubGlobal('fetch', directoryFetch([]))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    window.history.replaceState({}, '', `/reports?project=${PROJECT_IN_B}`)
    const seen: unknown[] = []
    const onSwitch = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(m.TEAM_AUTO_SWITCH_EVENT, onSwitch)
    await m.apiFetch('/v1/admin/reports')
    window.removeEventListener(m.TEAM_AUTO_SWITCH_EVENT, onSwitch)
    expect(seen).toEqual([{ teamId: ORG_B, teamName: 'glot', projectId: PROJECT_IN_B }])
  })

  it('reads the directory once for many concurrent requests', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    window.history.replaceState({}, '', `/dashboard?project=${PROJECT_IN_B}`)
    await Promise.all([m.apiFetch('/v1/admin/a'), m.apiFetch('/v1/admin/b'), m.apiFetch('/v1/admin/c')])
    expect(calls.filter((c) => c.url.endsWith('/v1/admin/workspace/projects'))).toHaveLength(1)
    expect(
      calls.filter((c) => !c.url.endsWith('/workspace/projects')).every((c) => c.headers['X-Mushi-Org-Id'] === ORG_B),
    ).toBe(true)
  })

  it('skips the directory read when the project is known to be in the active team', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_B)
    m.rememberTeamProject(ORG_B, PROJECT_IN_B)
    window.history.replaceState({}, '', `/dashboard?project=${PROJECT_IN_B}`)
    await m.apiFetch('/v1/admin/dashboard')
    expect(calls.map((c) => c.url)).toEqual(['http://api.local/v1/admin/dashboard'])
  })

  it('does not gate team-less reads (scope none)', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    window.history.replaceState({}, '', `/dashboard?project=${PROJECT_IN_B}`)
    await m.apiFetch('/v1/org', { scope: 'none' })
    expect(calls.map((c) => c.url)).toEqual(['http://api.local/v1/org'])
  })

  it('a fresh browser (no stored team) takes the team of the linked project, not the first team', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    window.history.replaceState({}, '', `/reports?project=${PROJECT_IN_B}`)
    await m.apiFetch('/v1/admin/reports')
    const scoped = calls.filter((c) => !c.url.endsWith('/v1/admin/workspace/projects'))
    expect(scoped[0].headers['X-Mushi-Org-Id']).toBe(ORG_B)
    expect(m.getActiveOrgIdSnapshot()).toBe(ORG_B)
  })

  it('fails open when the directory cannot be read', async () => {
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
        return url.endsWith('/workspace/projects')
          ? jsonResponse({ ok: false, error: { code: 'DB_ERROR', message: 'down' } }, 500)
          : jsonResponse({ fine: true })
      }),
    )
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    window.history.replaceState({}, '', `/dashboard?project=${PROJECT_IN_B}`)
    const res = await m.apiFetch('/v1/admin/dashboard')
    expect(res.ok).toBe(true)
    expect(m.getActiveOrgIdSnapshot()).toBe(ORG_A)
  })
})

describe('coalesce key carries the scope', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('a team-less answer is never served to a team-scoped caller of the same path', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    await m.apiFetch('/v1/admin/projects', { scope: 'none' })
    await m.apiFetch('/v1/admin/projects', { scope: 'enumeration' })
    expect(calls).toHaveLength(2)
    expect(calls[0].headers['X-Mushi-Org-Id']).toBeUndefined()
    expect(calls[1].headers['X-Mushi-Org-Id']).toBe(ORG_A)
  })

  it('holds shell reads for a few seconds, and a write clears them', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    await m.apiFetch('/v1/admin/setup')
    await new Promise((r) => setTimeout(r, 250))
    await m.apiFetch('/v1/admin/setup')
    expect(calls.filter((c) => c.url.endsWith('/v1/admin/setup'))).toHaveLength(1)
    await m.apiFetch('/v1/admin/projects', { method: 'POST', body: '{}' })
    await m.apiFetch('/v1/admin/setup')
    expect(calls.filter((c) => c.url.endsWith('/v1/admin/setup'))).toHaveLength(2)
  })
})

describe('team project list is one read whatever the caller scope', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('a project-scoped and an enumeration-scoped /v1/admin/projects share one request', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', directoryFetch(calls))
    const m = await freshModules()
    m.setActiveOrgIdSnapshot(ORG_A)
    await m.apiFetch('/v1/admin/projects')
    await m.apiFetch('/v1/admin/projects', { scope: 'enumeration' })
    expect(calls.filter((c) => c.url.endsWith('/v1/admin/projects'))).toHaveLength(1)
  })
})
