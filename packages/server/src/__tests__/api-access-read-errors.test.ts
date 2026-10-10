/**
 * A failed access read must not look like "no access" with nothing logged.
 *
 * - userCanAccessProject used to drop `error` on its three reads, so a DB
 *   outage answered 403 "forbidden". It now throws ProjectAccessReadError,
 *   which app.onError turns into a 500.
 * - accessibleProjectIds keeps its lenient (empty-list) default, but logs the
 *   read error so the outage shows in Supabase Logs.
 * - dbError's transient-DB log line carries the requestId the 500 body has.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let shared: typeof import('../../supabase/functions/api/shared.ts')
let access: typeof import('../../supabase/functions/_shared/project-access.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  shared = await import('../../supabase/functions/api/shared.ts')
  access = await import('../../supabase/functions/_shared/project-access.ts')
})

afterEach(() => vi.restoreAllMocks())

const ORG = '5000000a-0000-4000-8000-000000000000'
const P_ORG = '1000000a-0000-4000-8000-000000000000'
const USER = 'member-user'

function db(failing: string | null) {
  return makeFakeDb(
    {
      projects: [{ id: P_ORG, name: 'Team app', owner_id: 'someone-else', organization_id: ORG }],
      organization_members: [{ organization_id: ORG, user_id: USER, role: 'member' }],
      project_members: [],
    },
    { failRead: (table) => (table === failing ? 'connection reset' : null) },
  )
}

describe('userCanAccessProject on a failed read', () => {
  it('grants access normally', async () => {
    await expect(shared.userCanAccessProject(db(null) as never, USER, P_ORG)).resolves.toEqual({
      allowed: true,
      role: 'member',
    })
  })

  for (const table of ['projects', 'organization_members', 'project_members']) {
    it(`throws instead of answering "no access" when ${table} fails`, async () => {
      // project_members is only read when the org check found no role.
      const user = table === 'project_members' ? 'stranger' : USER
      await expect(shared.userCanAccessProject(db(table) as never, user, P_ORG)).rejects.toBeInstanceOf(
        access.ProjectAccessReadError,
      )
    })
  }
})

describe('accessibleProjectIds lenient mode', () => {
  it('still returns what it could read, and logs the failed read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ids = await access.accessibleProjectIds(db('project_members') as never, USER)
    expect(ids).toEqual([P_ORG])
    expect(warn.mock.calls.map((a) => String(a[0])).join('\n')).toContain('project access read failed')
  })

  it('strict mode throws', async () => {
    await expect(
      access.accessibleProjectIds(db('project_members') as never, USER, { strict: true }),
    ).rejects.toBeInstanceOf(access.ProjectAccessReadError)
  })
})

describe('dbError transient log line', () => {
  it('includes the requestId that the 500 body returns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const vars: Record<string, unknown> = { requestId: 'req-123' }
    const c = {
      get: (k: string) => vars[k],
      req: { path: '/v1/admin/reports', method: 'GET' },
      json: (body: unknown, status?: number) => ({ body, status }),
    }
    const res = shared.dbError(c as never, { code: '08006', message: 'connection failure' }) as unknown as {
      body: { error: { requestId?: string } }
      status: number
    }
    expect(res.status).toBe(500)
    expect(res.body.error.requestId).toBe('req-123')
    const line = JSON.parse(String(warn.mock.calls[0]![0]))
    expect(line.event).toBe('db_transient_error')
    expect(line.requestId).toBe('req-123')
  })
})
