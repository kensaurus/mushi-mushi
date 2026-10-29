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
import { SAFE_INTERNAL_MESSAGE } from '../../supabase/functions/_shared/error-codes.ts'
import { reportError } from '../../supabase/functions/_shared/sentry.ts'
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

function db(failing: string | null, message = 'connection reset') {
  return makeFakeDb(
    {
      projects: [{ id: P_ORG, name: 'Team app', owner_id: 'someone-else', organization_id: ORG }],
      organization_members: [{ organization_id: ORG, user_id: USER, role: 'member' }],
      project_members: [],
    },
    { failRead: (table) => (table === failing ? message : null) },
  )
}

/** The page Sentry stored on MUSHI-a8a03270, plus a status title and padding. */
const CF_HTML =
  '<!DOCTYPE html>\n' +
  '<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n' +
  '<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->\n' +
  '<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->\n' +
  '<head><title>abc.supabase.co | 522: Connection timed out</title></head>' +
  `<body><div id="cf-wrapper">${'x'.repeat(8000)}</div></body>`

describe('userCanAccessProject on a failed read', () => {
  it('grants access normally', async () => {
    await expect(shared.userCanAccessProject(db(null) as never, USER, P_ORG)).resolves.toEqual({
      allowed: true,
      role: 'member',
    })
  })

  it('does not embed a Cloudflare HTML page when organization_members fails', async () => {
    const err = await shared.userCanAccessProject(db('organization_members', CF_HTML) as never, USER, P_ORG).then(
      () => {
        throw new Error('expected ProjectAccessReadError')
      },
      (caught: unknown) => caught,
    )
    expect(err).toBeInstanceOf(access.ProjectAccessReadError)
    const message = (err as Error).message
    expect(message).toContain('[upstream gateway error] abc.supabase.co | 522: Connection timed out')
    expect(message).not.toContain('<!DOCTYPE')
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

  it('strict mode does not embed a Cloudflare HTML page in the error', async () => {
    const err = await access
      .accessibleProjectIds(db('organization_members', CF_HTML) as never, USER, { strict: true })
      .then(
        () => {
          throw new Error('expected ProjectAccessReadError')
        },
        (caught: unknown) => caught,
      )
    expect(err).toBeInstanceOf(access.ProjectAccessReadError)
    const message = (err as Error).message
    expect(message).toContain('organization_members')
    expect(message).toContain('[upstream gateway error] abc.supabase.co | 522: Connection timed out')
    expect(message).not.toContain('<!DOCTYPE')
    expect(message.length).toBeLessThan(200)
  })

  it('lenient mode logs the one-line summary, not the HTML page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await access.accessibleProjectIds(db('organization_members', CF_HTML) as never, USER)
    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n')
    expect(logged).toContain('[upstream gateway error] abc.supabase.co | 522: Connection timed out')
    expect(logged).not.toContain('<!DOCTYPE')
  })
})

describe('callerProjectIds is strict (owner decision 2026-10-10)', () => {
  // A reports list that came back empty on a DB blip read as "no bugs".
  function ctx(vars: Record<string, unknown>) {
    return {
      get: (k: string) => vars[k],
      req: { query: () => undefined, header: () => undefined },
    }
  }
  const jwt = ctx({ authMethod: 'jwt' })
  const orgKey = ctx({ authMethod: 'apiKey', isOrgScopedKey: true })

  it('lists the projects a member can reach', async () => {
    await expect(shared.callerProjectIds(jwt as never, db(null) as never, USER)).resolves.toEqual([P_ORG])
    await expect(shared.callerProjectIds(orgKey as never, db(null) as never, USER)).resolves.toEqual([P_ORG])
  })

  for (const table of ['projects', 'organization_members', 'project_members']) {
    it(`throws (a 500) instead of an empty list when ${table} fails`, async () => {
      for (const c of [jwt, orgKey]) {
        await expect(shared.callerProjectIds(c as never, db(table) as never, USER)).rejects.toBeInstanceOf(
          access.ProjectAccessReadError,
        )
      }
    })
  }

  it('a project-bound key reads nothing, so it is unaffected', async () => {
    const bound = ctx({ authMethod: 'apiKey', projectId: P_ORG })
    await expect(shared.callerProjectIds(bound as never, db('projects') as never, USER)).resolves.toEqual([P_ORG])
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

  it('an HTML gateway page is a 503 and is not sent to Sentry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html =
      '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>' +
      '<body><h1>502 Bad Gateway</h1><script>secret()</script></body></html>'
    const c = {
      get: () => 'req-html',
      req: { path: '/v1/admin/reports', method: 'GET' },
      json: (body: unknown, status?: number) => ({ body, status }),
    }
    const res = shared.dbError(c as never, { message: html, code: '' }) as unknown as {
      body: { ok: boolean; error: { code: string; message: string; requestId?: string } }
      status: number
    }
    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
    expect(res.body.error.code).toBe('DB_ERROR')
    expect(res.body.error.message).toBe(SAFE_INTERNAL_MESSAGE)
    expect(res.body.error.requestId).toBe('req-html')
    expect(JSON.stringify(res.body)).not.toContain('<')
    expect(reportError).not.toHaveBeenCalled()
    const line = JSON.parse(String(warn.mock.calls[0]![0]))
    expect(line.event).toBe('db_transient_error')
    expect(line.err_message).toBe('[upstream gateway error] 502 Bad Gateway')
    expect(String(line.err_message)).not.toContain('<')
  })

  it('a shared company-funnel org is a 409 and is not sent to Sentry', () => {
    vi.mocked(reportError).mockClear()
    const c = {
      get: () => 'req-org',
      req: { path: '/v1/admin/projects', method: 'POST' },
      json: (body: unknown, status?: number) => ({ body, status }),
    }
    const res = shared.dbError(c as never, {
      code: '23514',
      message: 'SELF_ORG_SHARED',
      hint: 'The company-funnel project must be the only project in its organization',
    }) as unknown as {
      body: { ok: boolean; error: { code: string; message: string } }
      status: number
    }
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toBe(shared.SELF_ORG_SHARED_MESSAGE)
    expect(res.body.error.message).not.toContain('SELF_ORG_SHARED')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('a real SQL error is still reported and the client message stays generic', () => {
    const c = {
      get: () => undefined,
      req: { path: '/v1/admin/reports', method: 'GET' },
      json: (body: unknown, status?: number) => ({ body, status }),
    }
    const res = shared.dbError(c as never, { code: '42703', message: 'column x does not exist' }) as unknown as {
      body: { error: { message: string } }
      status: number
    }
    expect(res.status).toBe(500)
    expect(res.body.error.message).not.toContain('column')
    expect(reportError).toHaveBeenCalledOnce()
    const captured = vi.mocked(reportError).mock.calls[0]![0] as Error
    expect(captured.message).toBe('column x does not exist')
  })

  it('reports a statement timeout under a per-route fingerprint and logs the message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(reportError).mockClear()
    const path = '/v1/admin/projects/1000000a-0000-4000-8000-000000000000/reports'
    const c = {
      get: (k: string) => (k === 'requestId' ? 'req-9' : undefined),
      req: { path, method: 'GET' },
      json: (body: unknown, status?: number) => ({ body, status }),
    }
    shared.dbError(c as never, {
      message: '',
      code: '57014',
      details: 'canceling statement due to statement timeout',
      hint: null,
    })
    expect(reportError).toHaveBeenCalledTimes(1)
    const [captured, ctx] = vi.mocked(reportError).mock.calls[0]!
    expect(captured).toMatchObject({
      name: 'DbError',
      message: 'canceling statement due to statement timeout',
    })
    expect(ctx).toMatchObject({
      tags: { path, method: 'GET', db_code: '57014', error_type: 'db' },
      fingerprint: ['db-error', '57014', '/v1/admin/projects/:id/reports'],
      extra: { pg_code: '57014', pg_details: 'canceling statement due to statement timeout' },
    })
    const line = JSON.parse(String(error.mock.calls[0]![0]))
    expect(line).toMatchObject({
      event: 'db_error',
      requestId: 'req-9',
      db_code: '57014',
      err_message: 'canceling statement due to statement timeout',
    })
  })
})
