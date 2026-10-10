/**
 * POST /v1/sdk/session writes.
 *
 * - page_view_count is optional: a heartbeat / session_end / page_view that
 *   omits it used to write `?? 1` and reset the stored count.
 * - end_user_id was never written, so the activity RPCs read every session as
 *   anonymous (live: 0 of 32k sessions identified). A verified
 *   X-Mushi-User-Token now links the session on session_start / page_view.
 * - user_id_hash is not stored; the web SDK sends a raw `sub` there, which
 *   must not 422 the event.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const PROJECT = '1000000a-0000-4000-8000-000000000000'
const SESSION = 'sess-1'
const END_USER = '7000000a-0000-4000-8000-000000000000'

let fake: ReturnType<typeof makeFakeDb>
const verify = vi.fn()

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fake }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  apiKeyAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('projectId', PROJECT)
    await next()
  },
}))
vi.mock('../../supabase/functions/api/routes/ingest-budget.ts', () => ({
  claimIngestBudget: async () => 'ok',
  clientIp: () => null,
}))
vi.mock('../../supabase/functions/_shared/end-user-identity.ts', () => ({
  MUSHI_USER_TOKEN_HEADER: 'X-Mushi-User-Token',
  verifyEndUserToken: (...args: unknown[]) => verify(...args),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  const { registerSessionRoutes } = await import('../../supabase/functions/api/routes/sessions.ts')
  app = new Hono()
  registerSessionRoutes(app as never)
})

beforeEach(() => {
  verify.mockReset()
  verify.mockResolvedValue(null)
  fake = makeFakeDb({
    end_user_sessions: [{ project_id: PROJECT, session_id: SESSION, page_view_count: 7, end_user_id: null }],
    session_page_views: [],
  })
})

async function send(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request('/v1/sdk/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', ...headers },
    body: JSON.stringify({ session_id: SESSION, ...body }),
  })
}

function row() {
  return (fake as unknown as { tables: Record<string, Array<Record<string, unknown>>> }).tables.end_user_sessions[0]!
}

describe('POST /v1/sdk/session page_view_count', () => {
  for (const kind of ['session_heartbeat', 'session_end', 'page_view']) {
    it(`${kind} without a count keeps the stored count`, async () => {
      const res = await send({ kind, route: '/a' })
      expect(res.status).toBe(200)
      expect(row().page_view_count).toBe(7)
    })
  }

  it('a sent count is written', async () => {
    await send({ kind: 'session_heartbeat', page_view_count: 9 })
    expect(row().page_view_count).toBe(9)
  })
})

describe('POST /v1/sdk/session identity', () => {
  it('a verified token links the session on page_view', async () => {
    verify.mockResolvedValue({ endUserId: END_USER, externalUserId: 'u1', organizationId: 'o1' })
    await send({ kind: 'page_view', route: '/a' }, { 'X-Mushi-User-Token': 'tok' })
    expect(verify).toHaveBeenCalledWith(fake, PROJECT, 'tok')
    expect(row().end_user_id).toBe(END_USER)
  })

  it('an already identified session does not verify again on page_view', async () => {
    row().end_user_id = END_USER
    await send({ kind: 'page_view', route: '/b' }, { 'X-Mushi-User-Token': 'tok' })
    expect(verify).not.toHaveBeenCalled()
    expect(row().end_user_id).toBe(END_USER)
  })

  it('session_start verifies and stores end_user_id on a new session', async () => {
    verify.mockResolvedValue({ endUserId: END_USER, externalUserId: 'u1', organizationId: 'o1' })
    await send({ session_id: 'sess-2', kind: 'session_start', route: '/' }, { 'X-Mushi-User-Token': 'tok' })
    const sessions = (fake as unknown as { tables: Record<string, Array<Record<string, unknown>>> }).tables.end_user_sessions
    expect(sessions.find((s) => s.session_id === 'sess-2')?.end_user_id).toBe(END_USER)
  })

  it('heartbeats do not verify (Vault read per minute per tab)', async () => {
    await send({ kind: 'session_heartbeat' }, { 'X-Mushi-User-Token': 'tok' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('a failed verification still writes the event, anonymously', async () => {
    verify.mockRejectedValue(new Error('vault down'))
    const res = await send({ kind: 'page_view', route: '/b' }, { 'X-Mushi-User-Token': 'tok' })
    expect(res.status).toBe(200)
    expect(row().end_user_id).toBeNull()
  })
})

describe('POST /v1/sdk/session user_id_hash', () => {
  it('a raw user id is accepted, not rejected with a 422', async () => {
    const res = await send({ kind: 'session_heartbeat', user_id_hash: 'user_42@example.com' })
    expect(res.status).toBe(200)
  })
})
