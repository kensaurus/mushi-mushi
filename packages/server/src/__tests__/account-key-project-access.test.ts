/**
 * Account-level (org-scoped) API keys on project routes (gap #28/#29).
 *
 * An account key has no bound project and reaches every project its owner
 * can reach. resolveOwnedProject used to refuse it outright ("API key missing
 * project binding") and assertTargetProjectAccess refused it as a scope
 * mismatch, so such a key could list releases but not open one, and could not
 * read code health. Now it must name the project, and it acts with its
 * owner's real role there. Project-bound keys are unchanged.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let shared: typeof import('../../supabase/functions/api/shared.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  shared = await import('../../supabase/functions/api/shared.ts')
})

const ORG = '5000000a-0000-4000-8000-000000000000'
const ORG_B = '5000000b-0000-4000-8000-000000000000'
const P_OWNED = '1000000a-0000-4000-8000-000000000000'
const P_MEMBER = '1000000b-0000-4000-8000-000000000000'
const P_STRANGER = '1000000c-0000-4000-8000-000000000000'
const KEY_OWNER = 'key-owner'

function db() {
  return makeFakeDb({
    projects: [
      { id: P_OWNED, name: 'Owned', owner_id: KEY_OWNER, organization_id: null, created_at: '2026-01-01' },
      { id: P_MEMBER, name: 'Team app', owner_id: 'someone-else', organization_id: ORG, created_at: '2026-01-02' },
      { id: P_STRANGER, name: 'Not mine', owner_id: 'stranger', organization_id: ORG_B, created_at: '2026-01-03' },
    ],
    organization_members: [{ organization_id: ORG, user_id: KEY_OWNER, role: 'member' }],
    project_members: [],
  })
}

interface Ctx {
  vars: Record<string, unknown>
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined }
  json: (body: unknown, status?: number) => { body: { ok: boolean; error?: { code: string; message: string } }; status: number }
}

function ctx(opts: { vars?: Record<string, unknown>; query?: Record<string, string>; headers?: Record<string, string> } = {}): Ctx {
  const vars: Record<string, unknown> = { userId: KEY_OWNER, ...opts.vars }
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    vars,
    get: (k) => vars[k],
    set: (k, v) => { vars[k] = v },
    req: { query: (k) => opts.query?.[k], header: (k) => headers[k.toLowerCase()] },
    json: (body, status = 200) => ({ body: body as never, status }),
  }
}

const accountKey = { authMethod: 'apiKey', isOrgScopedKey: true, projectId: null }
const boundKey = (projectId: string) => ({ authMethod: 'apiKey', isOrgScopedKey: false, projectId })

type Resolution = { project?: { id: string; organization_role?: string | null }; response?: { status: number; body: { error?: { code: string } } } }

async function resolve(c: Ctx, options: Record<string, unknown> = {}): Promise<Resolution> {
  return (await shared.resolveOwnedProject(c as never, db() as never, KEY_OWNER, options as never)) as unknown as Resolution
}

describe('resolveOwnedProject with an account-level key', () => {
  it('resolves a named project the owner owns, as owner, and pins the request to it', async () => {
    const c = ctx({ vars: accountKey, query: { project_id: P_OWNED } })
    const out = await resolve(c)
    expect(out.project).toMatchObject({ id: P_OWNED, organization_role: 'owner' })
    expect(c.vars.projectId).toBe(P_OWNED)
  })

  it('uses the owner\'s real role, so a member\'s key cannot pass requireProjectAdmin', async () => {
    const c = ctx({ vars: accountKey, headers: { 'X-Mushi-Project-Id': P_MEMBER } })
    const out = await resolve(c)
    expect(out.project).toMatchObject({ id: P_MEMBER, organization_role: 'member' })
    const refused = shared.requireProjectAdmin(c as never, out.project as never) as unknown as { status: number }
    expect(refused.status).toBe(403)
  })

  it('takes the project from the route\'s URL id', async () => {
    const out = await resolve(ctx({ vars: accountKey }), { overrideProjectId: P_OWNED })
    expect(out.project?.id).toBe(P_OWNED)
  })

  it('is a 404 for a project the owner cannot reach', async () => {
    const out = await resolve(ctx({ vars: accountKey, query: { project_id: P_STRANGER } }))
    expect(out.response).toMatchObject({ status: 404, body: { error: { code: 'PROJECT_NOT_FOUND' } } })
  })

  it('needs a project named, with no first-project fallback (an empty project_id counts as none)', async () => {
    for (const query of [{}, { project_id: '' }]) {
      const out = await resolve(ctx({ vars: accountKey, query }))
      expect(out.response, JSON.stringify(query)).toMatchObject({ status: 400, body: { error: { code: 'PROJECT_REQUIRED' } } })
    }
  })

  it('ignores the route\'s empty no-project payload, which is meant for a user with no projects', async () => {
    const c = ctx({ vars: accountKey })
    const out = await resolve(c, { noProjectResponse: () => c.json({ ok: true, data: { reason: 'no_project' } }, 200) })
    expect(out.response).toMatchObject({ status: 400, body: { error: { code: 'PROJECT_REQUIRED' } } })
  })

  it('rejects a non-uuid project and a project outside the named organization', async () => {
    expect((await resolve(ctx({ vars: accountKey, query: { project_id: 'nope' } }))).response?.status).toBe(400)
    const mismatch = await resolve(ctx({ vars: accountKey, query: { project_id: P_MEMBER, organization_id: ORG_B } }))
    expect(mismatch.response?.status).toBe(403)
  })
})

describe('resolveOwnedProject with other keys (unchanged)', () => {
  it('pins a project-bound key to its project and refuses another', async () => {
    expect((await resolve(ctx({ vars: boundKey(P_OWNED) }))).project).toMatchObject({ id: P_OWNED, organization_role: 'owner' })
    const other = await resolve(ctx({ vars: boundKey(P_OWNED), query: { project_id: P_MEMBER } }))
    expect(other.response?.status).toBe(403)
  })

  it('still refuses a key that has neither a project nor account scope', async () => {
    const out = await resolve(ctx({ vars: { authMethod: 'apiKey', isOrgScopedKey: false, projectId: null }, query: { project_id: P_OWNED } }))
    expect(out.response?.status).toBe(403)
  })
})

describe('assertTargetProjectAccess with an account-level key', () => {
  type Access = { ok: boolean; projectId?: string; role?: string; response?: { status: number } }
  const check = async (c: Ctx, projectId: string) =>
    (await shared.assertTargetProjectAccess(c as never, db() as never, KEY_OWNER, projectId)) as unknown as Access

  it('allows a reachable project with the owner\'s real role', async () => {
    expect(await check(ctx({ vars: accountKey }), P_OWNED)).toMatchObject({ ok: true, projectId: P_OWNED, role: 'owner' })
    expect(await check(ctx({ vars: accountKey }), P_MEMBER)).toMatchObject({ ok: true, projectId: P_MEMBER, role: 'member' })
  })

  it('refuses a project the owner cannot reach', async () => {
    expect(await check(ctx({ vars: accountKey }), P_STRANGER)).toMatchObject({ ok: false, response: { status: 403 } })
  })

  it('keeps a member\'s role after the request is pinned to the project (one context, two checks)', async () => {
    const c = ctx({ vars: accountKey, query: { project_id: P_MEMBER } })
    expect((await resolve(c)).project).toMatchObject({ id: P_MEMBER, organization_role: 'member' })
    expect(c.vars.projectId).toBe(P_MEMBER)
    // A pinned projectId must not turn the account key into a bound key, which reads as 'owner'.
    expect(await check(c, P_MEMBER)).toMatchObject({ ok: true, role: 'member' })
    const again = await resolve(c)
    expect(again.project).toMatchObject({ id: P_MEMBER, organization_role: 'member' })
    const refused = shared.requireProjectAdmin(c as never, again.project as never) as unknown as { status: number }
    expect(refused.status).toBe(403)
  })

  it('resolves the pinned project again when the request names none', async () => {
    const c = ctx({ vars: accountKey })
    expect((await resolve(c, { overrideProjectId: P_MEMBER })).project?.id).toBe(P_MEMBER)
    expect((await resolve(c)).project).toMatchObject({ id: P_MEMBER, organization_role: 'member' })
  })

  it('keeps a project-bound key on its own project', async () => {
    expect(await check(ctx({ vars: boundKey(P_OWNED) }), P_OWNED)).toMatchObject({ ok: true, role: 'owner' })
    expect(await check(ctx({ vars: boundKey(P_OWNED) }), P_MEMBER)).toMatchObject({ ok: false, response: { status: 403 } })
  })
})

describe('resolveAccessibleOrg with an account-level key', () => {
  type OrgAccess = { ok: boolean; organizationId?: string; role?: string; response?: { status: number; body: { error?: { code: string } } } }
  const org = async (c: Ctx) =>
    (await shared.resolveAccessibleOrg(c as never, db() as never, KEY_OWNER)) as unknown as OrgAccess

  it('uses the owner\'s membership role in a named organization', async () => {
    expect(await org(ctx({ vars: accountKey, headers: { 'X-Mushi-Org-Id': ORG } }))).toMatchObject({ ok: true, organizationId: ORG, role: 'member' })
  })

  it('refuses an organization the owner is not a member of, and a non-uuid', async () => {
    expect(await org(ctx({ vars: accountKey, query: { organization_id: ORG_B } }))).toMatchObject({ ok: false, response: { status: 403 } })
    expect(await org(ctx({ vars: accountKey, query: { organization_id: 'nope' } }))).toMatchObject({ ok: false, response: { status: 400 } })
  })

  it('needs an organization named or a project pinned', async () => {
    expect(await org(ctx({ vars: accountKey }))).toMatchObject({ ok: false, response: { status: 400, body: { error: { code: 'ORG_REQUIRED' } } } })
  })

  it('keeps a member\'s role after a project resolver pinned the request (one context, two checks)', async () => {
    const c = ctx({ vars: accountKey, query: { project_id: P_MEMBER } })
    expect((await resolve(c)).project).toMatchObject({ id: P_MEMBER, organization_role: 'member' })
    expect(c.vars.projectId).toBe(P_MEMBER)
    // The pinned projectId must not make the account key read as a bound key, which resolves as 'owner'.
    expect(await org(c)).toMatchObject({ ok: true, organizationId: ORG, role: 'member' })
  })

  it('refuses a named organization that is not the pinned project\'s', async () => {
    const c = ctx({ vars: accountKey, query: { organization_id: ORG_B } })
    c.vars.projectId = P_MEMBER
    expect(await org(c)).toMatchObject({ ok: false, response: { status: 403 } })
  })

  it('still resolves a project-bound key as the owner of its project\'s organization', async () => {
    expect(await org(ctx({ vars: boundKey(P_MEMBER) }))).toMatchObject({ ok: true, organizationId: ORG, role: 'owner' })
  })
})
