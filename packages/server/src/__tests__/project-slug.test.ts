/**
 * FILE: packages/server/src/__tests__/project-slug.test.ts
 * PURPOSE: A taken project slug (`projects_slug_key`, SQLSTATE 23505) is
 *          retried with the next free handle. Any other unique violation,
 *          and an insert that returns no row and no error, stops immediately.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  insertProjectAllocatingSlug,
  isProjectSlugConflict,
  projectSlugBase,
  projectSlugCandidates,
  type ProjectInsertError,
  type ProjectSlugDb,
} from '../../supabase/functions/_shared/project-slug.ts'

const cliDb = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeDb> | null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => cliDb.current }))

const ROW = { name: 'My SaaS App', owner_id: 'user-1', organization_id: 'org-1' }

function scripted(results: Array<{ data: { id: string } | null; error: ProjectInsertError | null }>): {
  db: ProjectSlugDb
  slugs: string[]
} {
  const slugs: string[] = []
  const db: ProjectSlugDb = {
    from() {
      return {
        insert(values) {
          slugs.push(values.slug)
          const next = results[slugs.length - 1] ?? {
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "projects_slug_key"',
            },
          }
          return { select: () => ({ single: () => Promise.resolve(next) }) }
        },
      }
    },
  }
  return { db, slugs }
}

const slugConflict: ProjectInsertError = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "projects_slug_key"',
  details: 'Key (slug)=(my-saas-app) already exists.',
}

describe('project slug allocation', () => {
  it('derives the historical slug and keeps a long name inside 48 characters', () => {
    expect(projectSlugBase('My SaaS App')).toBe('my-saas-app')
    expect(projectSlugBase('!!!', () => 'abcd1234')).toBe('project-abcd1234')
    const long = projectSlugBase('A'.repeat(80))
    expect(long).toHaveLength(48)
    const next = projectSlugCandidates(long, () => 'deadbeef')[1]
    expect(next).toHaveLength(48)
    expect(next.endsWith('-2')).toBe(true)
  })

  it('uses the plain slug, then -2, when the slug constraint is taken', async () => {
    const { db, slugs } = scripted([
      { data: null, error: slugConflict },
      { data: { id: 'new-id' }, error: null },
    ])
    const created = await insertProjectAllocatingSlug(db, ROW, () => 'deadbeef')
    expect(created).toEqual({ ok: true, id: 'new-id', slug: 'my-saas-app-2' })
    expect(slugs).toEqual(['my-saas-app', 'my-saas-app-2'])
  })

  it('skips a taken -2 and stores -3', async () => {
    const { db } = scripted([
      { data: null, error: slugConflict },
      { data: null, error: { ...slugConflict, details: 'Key (slug)=(my-saas-app-2) already exists.' } },
      { data: { id: 'new-id' }, error: null },
    ])
    const created = await insertProjectAllocatingSlug(db, ROW, () => 'deadbeef')
    expect(created).toMatchObject({ ok: true, slug: 'my-saas-app-3' })
  })

  it('does not retry a different unique violation', async () => {
    const pkey: ProjectInsertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "projects_pkey"',
      details: 'Key (id)=(already) already exists.',
    }
    const { db, slugs } = scripted([{ data: null, error: pkey }])
    const created = await insertProjectAllocatingSlug(db, ROW, () => 'deadbeef')
    expect(created).toEqual({ ok: false, error: pkey })
    expect(slugs).toEqual(['my-saas-app'])
    expect(isProjectSlugConflict(pkey)).toBe(false)
    expect(isProjectSlugConflict({ code: '23502', message: 'null value in column "organization_id"' })).toBe(false)
  })

  it('retries the in-memory duplicate-key message and stops when the insert returns nothing', async () => {
    const fake = { code: '23505', message: 'duplicate key on projects' }
    expect(isProjectSlugConflict(fake)).toBe(true)
    const retry = scripted([
      { data: null, error: fake },
      { data: { id: 'new-id' }, error: null },
    ])
    expect(await insertProjectAllocatingSlug(retry.db, ROW, () => 'deadbeef')).toMatchObject({
      ok: true,
      slug: 'my-saas-app-2',
    })
    const empty = scripted([{ data: null, error: null }])
    const created = await insertProjectAllocatingSlug(empty.db, ROW, () => 'deadbeef')
    expect(created).toEqual({
      ok: false,
      error: { code: 'PGRST116', message: 'project insert returned no row' },
    })
    expect(empty.slugs).toEqual(['my-saas-app'])
  })
})

describe('POST /v1/cli/projects', () => {
  const ORG = '5000000a-0000-4000-8000-000000000000'
  const TOKEN = 'cli-test-token'
  let app: Hono

  beforeAll(async () => {
    ;(globalThis as { Deno?: { env: { get: () => undefined } } }).Deno = { env: { get: () => undefined } }
    const { registerCliAuthRoutes } = await import('../../supabase/functions/api/routes/cli-auth.ts')
    app = new Hono()
    registerCliAuthRoutes(app as never)
  })

  it('allocates the next slug when the handle is taken', async () => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN))
    const cli_token_hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    cliDb.current = makeFakeDb(
      {
        cli_auth_requests: [{
          cli_token_hash,
          user_id: 'admin',
          status: 'approved',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }],
        organization_members: [{ organization_id: ORG, user_id: 'admin', role: 'admin', created_at: '2026-01-01' }],
        projects: [{ id: '1000000a-0000-4000-8000-000000000000', name: 'Taken', slug: 'my-saas-app', organization_id: 'other', owner_id: 'owner' }],
      },
      { autoId: true, uniques: { projects: ['slug'] } },
    )
    const res = await app.request('/v1/cli/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'My SaaS App' }),
    })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.slug).toBe('my-saas-app-2')
  })
})
