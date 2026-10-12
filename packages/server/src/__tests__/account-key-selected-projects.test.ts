/**
 * An account key limited to some projects (project_api_keys.allowed_project_ids,
 * ADR 0026). adminOrApiKey runs the rest of the request inside
 * key-project-scope.ts, and the two access primitives every route uses —
 * accessibleProjectIds and userCanAccessProject — intersect with it, so the
 * limit holds on every route without per-route code. Organization-wide
 * actions need a pinned allowed project, and a project pinned on the request
 * (X-Mushi-Project-Id) limits report-detail reads for any account key.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let shared: typeof import('../../supabase/functions/api/shared.ts')
let scope: typeof import('../../supabase/functions/_shared/key-project-scope.ts')
let auth: typeof import('../../supabase/functions/_shared/auth.ts')
let portfolio: typeof import('../../supabase/functions/api/routes/portfolio.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  shared = await import('../../supabase/functions/api/shared.ts')
  scope = await import('../../supabase/functions/_shared/key-project-scope.ts')
  auth = await import('../../supabase/functions/_shared/auth.ts')
  portfolio = await import('../../supabase/functions/api/routes/portfolio.ts')
})

const ORG = '5000000a-0000-4000-8000-000000000000'
const P_OWNED = '1000000a-0000-4000-8000-000000000000'
const P_MEMBER = '1000000b-0000-4000-8000-000000000000'
const P_TEAM_2 = '1000000d-0000-4000-8000-000000000000'
const OWNER = 'key-owner'

function db() {
  return makeFakeDb({
    projects: [
      { id: P_OWNED, name: 'Owned', owner_id: OWNER, organization_id: ORG, created_at: '2026-01-01' },
      { id: P_MEMBER, name: 'Team app', owner_id: 'someone-else', organization_id: ORG, created_at: '2026-01-02' },
      { id: P_TEAM_2, name: 'Team app 2', owner_id: 'someone-else', organization_id: ORG, created_at: '2026-01-03' },
    ],
    organization_members: [{ organization_id: ORG, user_id: OWNER, role: 'admin' }],
    project_members: [],
  })
}

function ctx(opts: { vars?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
  const vars: Record<string, unknown> = { userId: OWNER, ...opts.vars }
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    vars,
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => { vars[k] = v },
    req: { query: (_k: string) => undefined, header: (k: string) => headers[k.toLowerCase()] },
    json: (body: unknown, status = 200) => ({ body, status }),
  }
}

const limitedKey = { authMethod: 'apiKey', isOrgScopedKey: true, projectId: null, keyAllowedProjectIds: [P_MEMBER] }
const accountKey = { authMethod: 'apiKey', isOrgScopedKey: true, projectId: null, keyAllowedProjectIds: null }
const inLimit = <T>(fn: () => Promise<T>) => scope.runWithKeyProjectScope(OWNER, [P_MEMBER], fn)

describe('the two access primitives under a limited key', () => {
  it('accessibleProjectIds returns only the allowed projects the owner can still reach', async () => {
    const d = db()
    expect((await shared.accessibleProjectIds(d as never, OWNER)).sort()).toEqual([P_MEMBER, P_OWNED, P_TEAM_2].sort())
    expect(await inLimit(() => shared.accessibleProjectIds(d as never, OWNER))).toEqual([P_MEMBER])
    // A stale or foreign id in the limit grants nothing.
    expect(await scope.runWithKeyProjectScope(OWNER, ['1000000f-0000-4000-8000-000000000000'], () => shared.accessibleProjectIds(d as never, OWNER))).toEqual([])
  })

  it('userCanAccessProject refuses a project outside the limit, keeping the real role inside it', async () => {
    const d = db()
    expect(await inLimit(() => shared.userCanAccessProject(d as never, OWNER, P_OWNED))).toEqual({ allowed: false, role: null })
    expect(await inLimit(() => shared.userCanAccessProject(d as never, OWNER, P_MEMBER))).toEqual({ allowed: true, role: 'admin' })
  })

  it('the limit is bound to the request, not the user: a concurrent unlimited request is unaffected', async () => {
    const d = db()
    const [limited, console] = await Promise.all([
      inLimit(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return shared.accessibleProjectIds(d as never, OWNER)
      }),
      shared.accessibleProjectIds(d as never, OWNER),
    ])
    expect(limited).toEqual([P_MEMBER])
    expect(console).toHaveLength(3)
  })
})

describe('routes inherit the limit through the shared helpers', () => {
  it('callerProjectIds lists only allowed projects and refuses naming another', async () => {
    const d = db()
    expect(await inLimit(() => shared.callerProjectIds(ctx({ vars: limitedKey }) as never, d as never, OWNER))).toEqual([P_MEMBER])
    expect(
      await inLimit(() =>
        shared.callerProjectIds(ctx({ vars: limitedKey, headers: { 'X-Mushi-Project-Id': P_OWNED } }) as never, d as never, OWNER),
      ),
    ).toEqual([])
  })

  it('resolveOwnedProject answers 404 for a project outside the limit', async () => {
    const out = (await inLimit(() =>
      shared.resolveOwnedProject(ctx({ vars: limitedKey, headers: { 'X-Mushi-Project-Id': P_OWNED } }) as never, db() as never, OWNER),
    )) as { response?: { status: number } }
    expect(out.response?.status).toBe(404)
  })

  it('canAccessReportProject refuses a report in a project outside the limit', async () => {
    const d = db()
    expect(await inLimit(() => shared.canAccessReportProject(ctx({ vars: limitedKey }) as never, d as never, OWNER, P_OWNED))).toBe(false)
    expect(await inLimit(() => shared.canAccessReportProject(ctx({ vars: limitedKey }) as never, d as never, OWNER, P_MEMBER))).toBe(true)
  })

  it('a pinned project limits report reads for any account key (hosted ?project=, stdio MUSHI_PROJECT_ID)', async () => {
    const d = db()
    const pinned = ctx({ vars: accountKey, headers: { 'X-Mushi-Project-Id': P_OWNED } })
    expect(await shared.canAccessReportProject(pinned as never, d as never, OWNER, P_MEMBER)).toBe(false)
    expect(await shared.canAccessReportProject(pinned as never, d as never, OWNER, P_OWNED)).toBe(true)
    expect(await shared.canAccessReportProject(ctx({ vars: accountKey }) as never, d as never, OWNER, P_MEMBER)).toBe(true)
  })

  it('organization-wide actions need a pinned allowed project', async () => {
    const d = db()
    const unpinned = (await inLimit(() =>
      shared.resolveAccessibleOrg(ctx({ vars: limitedKey, headers: { 'X-Mushi-Org-Id': ORG } }) as never, d as never, OWNER),
    )) as { ok: boolean; response?: { status: number } }
    expect(unpinned.ok).toBe(false)
    expect(unpinned.response?.status).toBe(403)

    const pinned = await inLimit(() =>
      shared.resolveAccessibleOrg(ctx({ vars: { ...limitedKey, projectId: P_MEMBER } }) as never, d as never, OWNER),
    )
    expect(pinned).toMatchObject({ ok: true, organizationId: ORG, role: 'admin' })

    // An unlimited account key keeps naming the org directly.
    const unlimited = await shared.resolveAccessibleOrg(
      ctx({ vars: accountKey, headers: { 'X-Mushi-Org-Id': ORG } }) as never,
      d as never,
      OWNER,
    )
    expect(unlimited).toMatchObject({ ok: true, organizationId: ORG })
  })
})

describe('adminOrApiKey runs a limited key inside its limit', () => {
  const RAW = 'mushi_limitedkey0123456789abcdef'
  const hash = createHash('sha256').update(RAW).digest('hex')

  function middlewareCtx(headers: Record<string, string>) {
    const vars: Record<string, unknown> = {}
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return {
      vars,
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      req: { header: (k: string) => lower[k.toLowerCase()], path: '/v1/admin/reports', url: 'https://x/v1/admin/reports', query: () => undefined },
      json: (body: unknown, status = 200) => ({ body, status }),
      header: () => {},
    }
  }

  async function seenInsideRequest(allowed: string[] | null): Promise<{ status?: number; seen: string[] | null }> {
    state.db = makeFakeDb({
      ...db().tables,
      project_api_keys: [
        {
          id: 'k1', key_hash: hash, key_prefix: RAW.slice(0, 12), project_id: null, is_org_scoped: true,
          allowed_project_ids: allowed, is_active: true, scopes: ['mcp:read'], owner_user_id: OWNER, projects: null,
        },
      ],
    })
    let seen: string[] | null = null
    const c = middlewareCtx({ Authorization: `Bearer ${RAW}` })
    const out = (await auth.adminOrApiKey({ scope: 'mcp:read' })(c as never, async () => {
      seen = await shared.accessibleProjectIds(state.db as never, OWNER)
    })) as { status?: number } | undefined
    return { status: out?.status, seen }
  }

  it('narrows every access check of the request to allowed_project_ids', async () => {
    const limited = await seenInsideRequest([P_MEMBER])
    expect(limited.status).toBeUndefined()
    expect(limited.seen).toEqual([P_MEMBER])
  })

  it('leaves an unlimited account key reaching every project', async () => {
    const unlimited = await seenInsideRequest(null)
    expect(unlimited.seen?.sort()).toEqual([P_MEMBER, P_OWNED, P_TEAM_2].sort())
  })
})

describe('organization-wide routes (portfolioAccess) for narrowed account keys', () => {
  const orgCtx = (vars: Record<string, unknown>, headers: Record<string, string> = {}) => ({
    ...ctx({ vars, headers }),
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  })

  it('refuses a key limited to selected projects: org-wide data would reach the other projects', async () => {
    const out = (await inLimit(() => portfolio.portfolioAccess(orgCtx(limitedKey) as never, db() as never, ORG))) as {
      ok: boolean
      response?: Response
    }
    expect(out.ok).toBe(false)
    expect(out.response?.status).toBe(403)
    expect(await out.response?.text()).toContain('KEY_LIMITED_TO_PROJECTS')
  })

  it('refuses an account key pinned to one project on the request', async () => {
    const out = (await portfolio.portfolioAccess(
      orgCtx(accountKey, { 'X-Mushi-Project-Id': P_OWNED }) as never,
      db() as never,
      ORG,
    )) as { ok: boolean; response?: Response }
    expect(out.ok).toBe(false)
    expect(await out.response?.text()).toContain('CONNECTION_PINNED_TO_PROJECT')
  })

  it('an unlimited, unpinned account key keeps the whole organization', async () => {
    const out = await portfolio.portfolioAccess(orgCtx(accountKey) as never, makeFakeDb({
      ...db().tables,
      organizations: [{ id: ORG, name: 'Team' }],
    }) as never, ORG)
    expect(out).toMatchObject({ ok: true, orgId: ORG })
    expect((out as { projectIds: string[] }).projectIds.sort()).toEqual([P_MEMBER, P_OWNED, P_TEAM_2].sort())
  })
})
