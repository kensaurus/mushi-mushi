/**
 * FILE: github-connect.test.ts
 * PURPOSE: Verified "Connect GitHub" (_shared/github-connect.ts and
 *          api/routes/github-connect.ts). An installation id is trusted only
 *          after GitHub says the signed-in person can reach it; the grant
 *          that proves it is signed, expires, and works only for the person
 *          and app that started the flow; a repository is saved only when an
 *          installation in the grant really sees it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1a000000-0000-4000-8000-000000000001'
const OTHER_P = '1a000000-0000-4000-8000-000000000002'
const USER = '2a000000-0000-4000-8000-000000000001'
const STRANGER = '2a000000-0000-4000-8000-000000000002'
const SECRET = 'test-connect-secret'

const state = vi.hoisted(() => ({
  db: null as unknown,
  userId: '',
  roles: new Map<string, 'owner' | 'admin' | 'member' | 'viewer'>(),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', state.userId)
    await next()
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    userCanAccessProject: async (_db: unknown, userId: string, projectId: string) => {
      const role = state.roles.get(`${userId}:${projectId}`) ?? null
      return { allowed: role !== null, role }
    },
  }
})

const ENV: Record<string, string> = {
  GITHUB_APP_SLUG: 'mushi-mushi-app',
  GITHUB_APP_ID: '42',
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'shh',
  SUPABASE_URL: 'https://proj.supabase.co',
  MUSHI_GITHUB_CONNECT_SECRET: SECRET,
  ADMIN_BASE_URL: 'https://kensaur.us/mushi-mushi/admin',
}

let connect: typeof import('../../supabase/functions/_shared/github-connect.ts')
let routes: typeof import('../../supabase/functions/api/routes/github-connect.ts')

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => ENV[k] } })
  connect = await import('../../supabase/functions/_shared/github-connect.ts')
  routes = await import('../../supabase/functions/api/routes/github-connect.ts')
})

const NOW = 1_800_000_000
let gh: {
  packageJson?: string | null
  token: string | null
  tokenError?: string
  installations: Array<Record<string, unknown>>
  repos: Record<number, Array<Record<string, unknown>>>
  /** Repo ids the signed-in person reaches per installation (null = GitHub fails). */
  userRepoIds: Record<number, number[] | null>
}

const fetchImpl = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  if (url.startsWith('https://github.com/login/oauth/access_token')) {
    return json(200, gh.token ? { access_token: gh.token } : { error: gh.tokenError ?? 'bad_verification_code' })
  }
  if (url === 'https://api.github.com/user') return json(200, { login: 'kensaurus' })
  const userRepos = /api\.github\.com\/user\/installations\/(\d+)\/repositories/.exec(url)
  if (userRepos) {
    const ids = gh.userRepoIds[Number(userRepos[1])]
    if (ids === null) return json(502, {})
    return json(200, { repositories: (ids ?? []).map((id) => ({ id })) })
  }
  if (url.startsWith('https://api.github.com/user/installations')) return json(200, { installations: gh.installations })
  if (url.includes('/contents/package.json')) {
    if (!gh.packageJson) return new Response('{}', { status: 404 })
    return new Response(gh.packageJson, { status: 200 })
  }
  const m = /installation\/repositories/.exec(url)
  if (m) return json(200, { repositories: gh.repos[Number(currentInstall)] ?? [] })
  return json(404, {})
})
let currentInstall = 0
const kicked: string[] = []

function app() {
  const a = new Hono()
  routes.registerGithubConnectRoutes(a as never, {
    now: () => NOW,
    config: () => connect.readGithubAppConfig((k) => ENV[k]),
    fetchImpl: fetchImpl as never,
    mintToken: async (id: number) => {
      if (id === 999) throw new Error('suspended')
      currentInstall = id
      return `ghs_${id}`
    },
    kickSweep: async (p) => void kicked.push(p),
    repoToken: async (_db, _p, installationId) => (installationId === 7 ? 'ghs_7' : null),
  })
  return a
}

const cfg = () => {
  const r = connect.readGithubAppConfig((k) => ENV[k])
  if (!r.ok) throw new Error('config')
  return r.config
}

beforeEach(() => {
  state.userId = USER
  state.roles = new Map([[`${USER}:${P}`, 'owner']])
  state.db = makeFakeDb({ project_repos: [], project_settings: [{ project_id: P }] })
  gh = {
    token: 'ghu_user',
    installations: [{ id: 7, app_slug: 'mushi-mushi-app', app_id: 42, account: { login: 'kensaurus', type: 'User' }, suspended_at: null }],
    repos: {
      7: [
        { id: 101, full_name: 'kensaurus/kensaur.us', private: true, default_branch: 'main', pushed_at: '2026-10-29T00:00:00Z' },
        { id: 102, full_name: 'kensaurus/old', private: false, default_branch: 'master', pushed_at: '2025-01-01T00:00:00Z' },
      ],
    },
    userRepoIds: { 7: [101, 102] },
  }
  fetchImpl.mockClear()
  kicked.length = 0
})

describe('signed state and grant', () => {
  it('round-trips and rejects tampering, the wrong purpose and expiry', async () => {
    const s = await connect.signConnectState(SECRET, { p: P, u: USER, r: 'onboarding', exp: NOW + 60 })
    expect(await connect.openConnectState(SECRET, s, NOW)).toMatchObject({ ok: true, state: { p: P, u: USER } })
    expect(await connect.openConnectState('other-secret', s, NOW)).toEqual({ ok: false, reason: 'invalid' })
    expect(await connect.openConnectState(SECRET, s, NOW + 61)).toEqual({ ok: false, reason: 'expired' })
    const [body, mac] = s.split('.')
    const forged = `${btoa(JSON.stringify({ p: OTHER_P, u: USER, r: 'onboarding', exp: NOW + 60 })).replace(/=+$/, '')}.${mac}`
    expect((await connect.openConnectState(SECRET, forged, NOW)).ok).toBe(false)
    expect((await connect.openConnectState(SECRET, `${body}.${mac}.x`, NOW)).ok).toBe(false)
    // A state is not a grant, even with the same secret.
    expect((await connect.openConnectGrant(SECRET, s, NOW)).ok).toBe(false)
    // A bare project id (the old install link) is not a state.
    expect((await connect.openConnectState(SECRET, P, NOW)).ok).toBe(false)
  })

  it('reports the settings it is missing', () => {
    const r = connect.readGithubAppConfig((k) => (k === 'GITHUB_APP_CLIENT_SECRET' ? undefined : ENV[k]))
    expect(r).toEqual({ ok: false, missing: ['GITHUB_APP_CLIENT_SECRET'] })
  })
})

describe('suggestRepo', () => {
  const repos = [{ fullName: 'kensaurus/kensaur.us' }, { fullName: 'kensaurus/mushi-mushi' }, { fullName: 'acme/web' }]
  it('matches the app name ignoring case and punctuation', () => {
    expect(connect.suggestRepo(repos, 'kensaur.us')).toBe('kensaurus/kensaur.us')
    expect(connect.suggestRepo(repos, 'Mushi Mushi')).toBe('kensaurus/mushi-mushi')
  })
  it('prefers an exact name over a partial one, and takes a partial one alone', () => {
    expect(connect.suggestRepo([{ fullName: 'a/mushi-mushi-docs' }, { fullName: 'a/mushi-mushi' }], 'mushi-mushi')).toBe('a/mushi-mushi')
    expect(connect.suggestRepo([{ fullName: 'a/glot-it-web' }, { fullName: 'a/other' }], 'glot.it')).toBe('a/glot-it-web')
  })
  it('suggests nothing when unclear: a tie, no match, or a tiny name', () => {
    expect(connect.suggestRepo([{ fullName: 'a/shop-web' }, { fullName: 'a/shop-api' }], 'shop')).toBeNull()
    expect(connect.suggestRepo(repos, 'Something else')).toBeNull()
    expect(connect.suggestRepo(repos, 'ab')).toBeNull()
    expect(connect.suggestRepo(repos, null)).toBeNull()
  })
})

describe('POST /github/connect', () => {
  it('gives an owner install and authorize links carrying a signed state', async () => {
    const res = await app().request(`/v1/admin/projects/${P}/github/connect`, { method: 'POST', body: JSON.stringify({ returnTo: 'integrations' }) })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { installUrl: string; authorizeUrl: string } }
    expect(data.installUrl).toMatch(/^https:\/\/github\.com\/apps\/mushi-mushi-app\/installations\/new\?state=/)
    const st = new URL(data.authorizeUrl).searchParams.get('state')
    expect(await connect.openConnectState(SECRET, st, NOW)).toMatchObject({ ok: true, state: { p: P, u: USER, r: 'integrations' } })
    expect(new URL(data.authorizeUrl).searchParams.get('redirect_uri')).toBe('https://proj.supabase.co/functions/v1/api/v1/webhooks/github/app-authorize')
  })

  it('refuses a viewer and a stranger', async () => {
    state.roles.set(`${USER}:${P}`, 'viewer')
    expect((await app().request(`/v1/admin/projects/${P}/github/connect`, { method: 'POST' })).status).toBe(403)
    state.userId = STRANGER
    expect((await app().request(`/v1/admin/projects/${P}/github/connect`, { method: 'POST' })).status).toBe(404)
  })
})

describe('GET /v1/webhooks/github/app-authorize', () => {
  async function callback(query: Record<string, string>) {
    const res = await app().request(`/v1/webhooks/github/app-authorize?${new URLSearchParams(query)}`)
    expect(res.status).toBe(302)
    return new URL(res.headers.get('location')!)
  }
  const goodState = () => connect.signConnectState(SECRET, { p: P, u: USER, r: 'onboarding', exp: NOW + 600 })

  it('returns a grant for the installations the person can reach', async () => {
    const loc = await callback({ code: 'abc', state: await goodState() })
    expect(loc.pathname).toBe('/mushi-mushi/admin/onboarding')
    expect(loc.searchParams.get('project')).toBe(P)
    const grant = decodeURIComponent(loc.hash.replace('#gh_grant=', ''))
    expect(await connect.openConnectGrant(SECRET, grant, NOW)).toMatchObject({ ok: true, grant: { p: P, u: USER, i: [7], r: [101, 102], g: 'kensaurus' } })
  })

  it('carries only the repos the person reaches, and fails closed when GitHub will not say', async () => {
    gh.userRepoIds = { 7: [101] }
    const loc = await callback({ code: 'abc', state: await goodState() })
    const grant = decodeURIComponent(loc.hash.replace('#gh_grant=', ''))
    expect(await connect.openConnectGrant(SECRET, grant, NOW)).toMatchObject({ ok: true, grant: { r: [101] } })
    gh.userRepoIds = { 7: null }
    const failed = await callback({ code: 'abc', state: await goodState() })
    expect(failed.searchParams.get('github_error')).toBe('github_unreachable')
    expect(failed.hash).toBe('')
  })

  it('sends a person with no installation on to install, once', async () => {
    gh.installations = [{ id: 8, app_slug: 'someone-else', app_id: 1, account: { login: 'x', type: 'User' } }]
    const first = await goodState()
    const loc = await callback({ code: 'abc', state: first })
    expect(loc.origin + loc.pathname).toBe('https://github.com/apps/mushi-mushi-app/installations/new')
    expect(loc.searchParams.get('state')).toBe(first)
    // Back from install (the setup URL marks the state): no second round trip.
    const back = await connect.signConnectState(SECRET, { p: P, u: USER, r: 'onboarding', exp: NOW + 600, x: 1 })
    const again = await callback({ code: 'abc', state: back })
    expect(again.searchParams.get('github_error')).toBe('no_installation')
    expect(again.hash).toBe('')
  })

  it('names a suspended installation', async () => {
    gh.installations[0].suspended_at = '2026-10-01T00:00:00Z'
    expect((await callback({ code: 'abc', state: await goodState() })).searchParams.get('github_error')).toBe('installation_suspended')
  })

  it('handles cancel, missing code, an expired code, a forged or expired state', async () => {
    expect((await callback({ error: 'access_denied', state: await goodState() })).searchParams.get('github_error')).toBe('authorize_cancelled')
    expect((await callback({ state: await goodState() })).searchParams.get('github_error')).toBe('authorize_failed')
    gh.token = null
    expect((await callback({ code: 'old', state: await goodState() })).searchParams.get('github_error')).toBe('code_expired')
    expect((await callback({ code: 'abc', state: P })).searchParams.get('github_error')).toBe('state_invalid')
    const old = await connect.signConnectState(SECRET, { p: P, u: USER, r: 'onboarding', exp: NOW - 1 })
    expect((await callback({ code: 'abc', state: old })).searchParams.get('github_error')).toBe('state_expired')
  })

  it('refuses a person who lost access since starting', async () => {
    state.roles.delete(`${USER}:${P}`)
    expect((await callback({ code: 'abc', state: await goodState() })).searchParams.get('github_error')).toBe('not_allowed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('repository picker', () => {
  const grantFor = (over: Partial<{ p: string; u: string; i: number[]; r: number[]; exp: number }> = {}) =>
    connect.signConnectGrant(SECRET, { p: P, u: USER, i: [7], r: [101, 102], g: 'kensaurus', exp: NOW + 600, ...over })

  it('puts the repository named like the app first', async () => {
    state.db = makeFakeDb({ project_repos: [], project_settings: [{ project_id: P }], projects: [{ id: P, name: 'old' }] })
    const res = await app().request(`/v1/admin/projects/${P}/github/repos`, { method: 'POST', body: JSON.stringify({ grant: await grantFor() }) })
    const { data } = (await res.json()) as { data: { repos: Array<{ fullName: string }>; suggestedFullName: string | null } }
    expect(data.suggestedFullName).toBe('kensaurus/old')
    expect(data.repos.map((r) => r.fullName)).toEqual(['kensaurus/old', 'kensaurus/kensaur.us'])
  })

  it('lists the repositories the grant reaches, newest push first', async () => {
    const res = await app().request(`/v1/admin/projects/${P}/github/repos`, { method: 'POST', body: JSON.stringify({ grant: await grantFor({ i: [7, 999] }) }) })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { repos: Array<{ fullName: string }>; unreachableInstallations: number[] } }
    expect(data.repos.map((r) => r.fullName)).toEqual(['kensaurus/kensaur.us', 'kensaurus/old'])
    expect(data.unreachableInstallations).toEqual([999])
  })

  it('refuses a grant for another app, another person, or an expired one', async () => {
    const call = async (grant: string) =>
      (await app().request(`/v1/admin/projects/${P}/github/repos`, { method: 'POST', body: JSON.stringify({ grant }) })).status
    expect(await call(await grantFor({ p: OTHER_P }))).toBe(403)
    expect(await call(await grantFor({ u: STRANGER }))).toBe(403)
    expect(await call(await grantFor({ exp: NOW - 1 }))).toBe(410)
    expect(await call('not-a-grant')).toBe(400)
  })

  it('saves a reachable repository as the app’s primary with its real default branch', async () => {
    ;(state.db as FakeDb).table('project_repos').push({ id: 'old', project_id: P, repo_url: 'https://github.com/kensaurus/old', is_primary: true })
    const res = await app().request(`/v1/admin/projects/${P}/github/repo`, {
      method: 'POST',
      body: JSON.stringify({ grant: await grantFor(), fullName: 'kensaurus/kensaur.us' }),
    })
    expect(res.status).toBe(200)
    const repos = (state.db as FakeDb).table('project_repos')
    const primary = repos.filter((r) => r.is_primary)
    expect(primary).toHaveLength(1)
    expect(primary[0]).toMatchObject({ repo_url: 'https://github.com/kensaurus/kensaur.us', default_branch: 'main', github_app_installation_id: 7 })
    expect((state.db as FakeDb).table('project_settings')[0]).toMatchObject({ github_repo_url: 'https://github.com/kensaurus/kensaur.us' })
    expect(kicked).toEqual([P])
  })

  it('an org member sees and saves only the repos they can reach, not every repo the App covers', async () => {
    const list = await app().request(`/v1/admin/projects/${P}/github/repos`, { method: 'POST', body: JSON.stringify({ grant: await grantFor({ r: [101] }) }) })
    const { data } = (await list.json()) as { data: { repos: Array<{ fullName: string }> } }
    expect(data.repos.map((r) => r.fullName)).toEqual(['kensaurus/kensaur.us'])
    const save = await app().request(`/v1/admin/projects/${P}/github/repo`, {
      method: 'POST',
      body: JSON.stringify({ grant: await grantFor({ r: [101] }), fullName: 'kensaurus/old' }),
    })
    expect(save.status).toBe(409)
    expect(((await save.json()) as { error: { code: string } }).error.code).toBe('REPO_NOT_REACHABLE')
    expect((state.db as FakeDb).table('project_repos')).toHaveLength(0)
  })

  it('refuses a grant without its repository list (issued before the list existed)', async () => {
    const old = await connect.signConnectGrant(SECRET, { p: P, u: USER, i: [7], g: 'kensaurus', exp: NOW + 600 } as never)
    const res = await app().request(`/v1/admin/projects/${P}/github/repos`, { method: 'POST', body: JSON.stringify({ grant: old }) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('GRANT_INVALID')
  })

  it('refuses a repository the installation cannot see, and a malformed name', async () => {
    const save = async (fullName: string) =>
      app().request(`/v1/admin/projects/${P}/github/repo`, { method: 'POST', body: JSON.stringify({ grant: await grantFor(), fullName }) })
    const res = await save('someone/private')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('REPO_NOT_REACHABLE')
    expect((await save('../../etc')).status).toBe(400)
    expect((state.db as FakeDb).table('project_repos')).toHaveLength(0)
  })

  it('says plainly when the server has no GitHub App settings', async () => {
    const a = new Hono()
    routes.registerGithubConnectRoutes(a as never, {
      now: () => NOW,
      config: () => ({ ok: false, missing: ['GITHUB_APP_CLIENT_ID'] }),
      fetchImpl: fetchImpl as never,
      mintToken: async () => 'x',
      kickSweep: async () => {},
    })
    const res = await a.request(`/v1/admin/projects/${P}/github/connect`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('GITHUB_APP_NOT_CONFIGURED')
  })
})

describe('GET /github/stack', () => {
  const stack = async () => {
    const res = await app().request(`/v1/admin/projects/${P}/github/stack`)
    return { status: res.status, body: (await res.json()) as { data?: { repo: string | null; packageJson: string | null; reason: string | null } } }
  }

  it('says there is no repository yet', async () => {
    expect((await stack()).body.data).toEqual({ repo: null, packageJson: null, reason: 'no_repo' })
  })

  it('returns the primary repository’s package.json', async () => {
    ;(state.db as FakeDb).table('project_repos').push({ project_id: P, repo_url: 'https://github.com/kensaurus/kensaur.us', is_primary: true, default_branch: 'main', github_app_installation_id: 7 })
    gh.packageJson = '{"dependencies":{"react":"19.0.0"},"devDependencies":{"vite":"7.0.0"}}'
    expect((await stack()).body.data).toEqual({ repo: 'kensaurus/kensaur.us', packageJson: gh.packageJson, reason: null })
    gh.packageJson = null
    expect((await stack()).body.data?.reason).toBe('no_package_json')
  })

  it('says when the app has no GitHub access, and hides other teams’ apps', async () => {
    ;(state.db as FakeDb).table('project_repos').push({ project_id: P, repo_url: 'https://github.com/kensaurus/kensaur.us', is_primary: true, github_app_installation_id: null })
    expect((await stack()).body.data?.reason).toBe('no_access')
    state.userId = STRANGER
    expect((await stack()).status).toBe(404)
  })
})
