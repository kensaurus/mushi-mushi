/**
 * GET /v1/admin/repo/activity built its feed only from fix_attempts columns
 * ("we don't have a fix_events table yet"), so events recorded only in
 * fix_events (CI started, PR closed, ...) never appeared. Stored rows now win
 * per kind for their attempt, as on the per-fix timeline.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const F = '4000000a-0000-4000-8000-000000000000'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerQueryFixesRepoRoutes } = await import('../../supabase/functions/api/routes/query-fixes-repo.ts')
  app = new Hono()
  registerQueryFixesRepoRoutes(app as never)
  db = makeFakeDb({
    fix_attempts: [
      {
        id: F,
        project_id: P,
        report_id: 'r1',
        branch: 'mushi/fix-1',
        pr_url: 'https://github.com/o/r/pull/7',
        pr_number: 7,
        status: 'completed',
        check_run_status: 'completed',
        check_run_conclusion: 'success',
        commit_sha: 'abcdef1234',
        started_at: '2026-10-01T00:01:00Z',
        completed_at: '2026-10-01T00:05:00Z',
        created_at: '2026-10-01T00:00:00Z',
        check_run_updated_at: '2026-10-01T00:06:00Z',
      },
    ],
    fix_events: [
      { id: 'e1', project_id: P, fix_attempt_id: F, kind: 'ci_started', status: 'pending', label: 'CI started', detail: null, at: '2026-10-01T00:05:30Z' },
      { id: 'e2', project_id: P, fix_attempt_id: F, kind: 'ci_resolved', status: 'fail', label: 'CI failure (stored)', detail: null, at: '2026-10-01T00:07:00Z' },
    ],
  })
})

describe('GET /v1/admin/repo/activity', () => {
  it('includes stored fix_events and lets them win per kind', async () => {
    const res = await app.request(`/v1/admin/repo/activity?project_id=${P}`)
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { events: Array<{ kind: string; label: string; fix_attempt_id: string }> } }
    const kinds = data.events.map((e) => e.kind)
    expect(kinds).toContain('ci_started')
    const ci = data.events.filter((e) => e.kind === 'ci_resolved')
    expect(ci).toHaveLength(1)
    expect(ci[0]!.label).toBe('CI failure (stored)')
    expect(ci[0]!.fix_attempt_id).toBe(F)
    // Stages with no stored row are still synthesized.
    expect(kinds).toEqual(expect.arrayContaining(['dispatched', 'branch', 'commit', 'pr_opened', 'completed']))
  })
})
