/**
 * Project create / delete authz and the indexed-file count.
 *
 * - DELETE /v1/admin/projects/:id checked confirm_slug before authz and put
 *   the real slug in the SLUG_MISMATCH message, so any signed-in user with a
 *   project UUID learned that it exists and its slug. Authz now runs first, a
 *   caller who cannot see the project gets 404, and the slug is not echoed.
 * - The org-membership reads on create and delete dropped `error`, so a DB
 *   failure answered 403 (or bootstrapped a personal org on create).
 * - countRowsPerProject can filter to live file rows (no symbol chunks or
 *   tombstones) for the "indexed files" count.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const ORG = '5000000a-0000-4000-8000-000000000000'
const P = '1000000a-0000-4000-8000-000000000000'
let userId = 'stranger'
let db: FakeDb
let failing: string | null = null

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', userId)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})

let app: Hono
let signals: typeof import('../../supabase/functions/_shared/setup-signals.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerProjectsCrudRoutes } = await import('../../supabase/functions/api/routes/projects-crud.ts')
  signals = await import('../../supabase/functions/_shared/setup-signals.ts')
  app = new Hono()
  registerProjectsCrudRoutes(app as never)
})

beforeEach(() => {
  failing = null
  db = makeFakeDb(
    {
      projects: [
        { id: P, name: 'App', slug: 'secret-slug', organization_id: ORG, owner_id: 'owner' },
        { id: '1000000b-0000-4000-8000-000000000000', name: 'App 2', slug: 'secret-slug-2', organization_id: ORG, owner_id: 'owner' },
      ],
      organization_members: [
        { organization_id: ORG, user_id: 'member', role: 'member', created_at: '2026-01-01' },
        { organization_id: ORG, user_id: 'admin', role: 'admin', created_at: '2026-01-01' },
      ],
      project_codebase_files: [
        { id: 'f1', project_id: P, symbol_name: null, tombstoned_at: null },
        { id: 'f2', project_id: P, symbol_name: 'fn', tombstoned_at: null },
        { id: 'f3', project_id: P, symbol_name: null, tombstoned_at: '2026-01-01' },
      ],
    },
    {
      failRead: (t) => (t === failing ? 'connection reset' : null),
      uniques: { projects: ['slug'] },
      autoId: true,
    },
  )
})

async function del(body: unknown) {
  const res = await app.request(`/v1/admin/projects/${P}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

describe('DELETE /v1/admin/projects/:id', () => {
  it('a stranger gets 404 even with a wrong slug, and never sees the slug', async () => {
    userId = 'stranger'
    const res = await del({ confirm_slug: 'guess' })
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('secret-slug')
  })

  it('a member gets 403 before the slug is checked', async () => {
    userId = 'member'
    expect((await del({ confirm_slug: 'guess' })).status).toBe(403)
  })

  it('an admin with a wrong slug gets 400 without the real slug', async () => {
    userId = 'admin'
    const res = await del({ confirm_slug: 'guess' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('SLUG_MISMATCH')
    expect(res.text).not.toContain('secret-slug')
  })

  it('a failed membership read is a 500, not a 403', async () => {
    userId = 'admin'
    failing = 'organization_members'
    expect((await del({ confirm_slug: 'secret-slug' })).status).toBe(500)
  })
})

describe('POST /v1/admin/projects', () => {
  it('a failed membership read is a 500, not a 403 or a personal-org bootstrap', async () => {
    userId = 'admin'
    failing = 'organization_members'
    const res = await app.request('/v1/admin/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mushi-org-id': ORG },
      body: JSON.stringify({ name: 'New app' }),
    })
    expect(res.status).toBe(500)
  })

  // projects.slug is unique across every team. A second "Secret Slug" used to
  // die as DbError 23505 (projects_slug_key) instead of taking the next free handle.
  it('takes the next free slug when projects_slug_key is already used', async () => {
    userId = 'admin'
    const emptyOrg = '5000000b-0000-4000-8000-000000000000'
    db.table('organization_members').push({
      organization_id: emptyOrg,
      user_id: 'admin',
      role: 'owner',
      created_at: '2026-02-01',
    })
    const res = await app.request('/v1/admin/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mushi-org-id': emptyOrg },
      body: JSON.stringify({ name: 'Secret Slug' }),
    })
    const json = await res.json() as { ok?: boolean; data?: { slug?: string } }
    expect(res.status).toBe(201)
    expect(json.data?.slug).toBe('secret-slug-3')
    expect(db.table('projects').some((p) => p.slug === 'secret-slug-3' && p.organization_id === emptyOrg)).toBe(true)
  })
})

describe('countRowsPerProject indexed files', () => {
  it('counts only live file rows', async () => {
    const counts = await signals.countRowsPerProject(db as never, 'project_codebase_files', [P], {
      nullColumns: signals.INDEXED_FILE_ROW,
    })
    expect(counts.get(P)).toBe(1)
  })
})
