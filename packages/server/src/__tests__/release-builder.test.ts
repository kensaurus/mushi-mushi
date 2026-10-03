/**
 * FILE: release-builder.test.ts
 * PURPOSE: release-builder as behaviour, not source text. An automatic draft
 *          (auto-release) is published with nobody reading it, and report
 *          summaries come from the public widget, so it never goes through
 *          the LLM: its body is the escaped, link-free list of summaries. A
 *          second concurrent automatic draft is a 409 AUTO_DRAFT_EXISTS
 *          (uq_releases_one_auto_draft), which auto-release reads as "busy".
 */

import { describe, expect, it, vi } from 'vitest'
import { createFakeDb, findQueries, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))

import {
  deterministicReleaseBody,
  handleReleaseBuilder,
  sanitizeReleaseLine,
} from '../../supabase/functions/release-builder/index.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'
const HOSTILE = {
  id: 'r1',
  summary: 'Login breaks [click here](https://evil.example/x) <img src=x onerror=alert(1)> **now** see www.evil.example',
  description: null,
  severity: 'high',
  end_user_id: 'eu1',
}

function builderDb(opts: { insertError?: { code?: string; message: string }; reportsError?: { message: string } } = {}) {
  return createFakeDb((q: FakeQuery) => {
    if (q.table === 'reports') return opts.reportsError ? { error: opts.reportsError } : { data: [HOSTILE] }
    if (q.table === 'end_users') return { data: [{ id: 'eu1', display_name: 'Ana', external_user_id: null }] }
    if (q.table === 'releases' && q.op === 'insert') {
      return opts.insertError ? { error: opts.insertError } : { data: { id: 'rel-1', ...(q.payload as object) } }
    }
    return { data: null }
  })
}

function post(body: Record<string, unknown>) {
  return new Request('https://x.test/functions/v1/release-builder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('sanitizeReleaseLine / deterministicReleaseBody', () => {
  it('removes links and escapes every inline markdown / HTML metacharacter', () => {
    const line = sanitizeReleaseLine(HOSTILE.summary)
    expect(line).not.toMatch(/https?:|www\./)
    expect(line).not.toMatch(/(^|[^\\])[[\]()<>*]/)
    expect(line).toContain('\\[click here\\]')
    expect(line).toContain('\\<img src=x onerror=alert\\(1\\)\\>')
    expect(sanitizeReleaseLine('a\nb\r\n# heading')).toBe('a b # heading')
    expect(sanitizeReleaseLine('x'.repeat(500))).toHaveLength(160)
  })

  it('lists each fixed report on its own "- Fixed:" line', () => {
    expect(deterministicReleaseBody([])).toBe('No changes tracked for this release.')
    expect(deterministicReleaseBody([{ summary: null, description: 'Crash on save' }, { summary: '  ', description: null }])).toBe(
      '## Bug fixes\n\n- Fixed: Crash on save\n- Fixed: A reported bug',
    )
  })
})

describe('handleReleaseBuilder', () => {
  it('an automatic draft never calls the LLM and stores the escaped deterministic body with its auto_source', async () => {
    const { db, queries } = builderDb()
    const writeBody = vi.fn(async () => 'LLM body')
    const res = await handleReleaseBuilder(post({ project_id: PROJECT, version: '1.4.0', auto_source: 'recipe_event' }), {
      db: () => db,
      authorize: () => null,
      writeBody,
    })
    expect(res.status).toBe(200)
    expect(writeBody).not.toHaveBeenCalled()
    const insert = findQueries(queries, 'releases', 'insert')[0].payload as Record<string, unknown>
    expect(insert).toMatchObject({ auto_source: 'recipe_event', status: 'draft', fixed_report_ids: ['r1'] })
    expect(insert.body_md).toBe(deterministicReleaseBody([HOSTILE]))
    expect(String(insert.body_md)).not.toContain('evil.example')
    expect(await res.json()).toMatchObject({ ok: true, data: { reportCount: 1, creditCount: 1 } })
  })

  it('a second automatic draft for the project is a 409 AUTO_DRAFT_EXISTS', async () => {
    const { db } = builderDb({ insertError: { code: '23505', message: 'duplicate key value violates unique constraint "uq_releases_one_auto_draft"' } })
    const res = await handleReleaseBuilder(post({ project_id: PROJECT, version: '1.4.0', auto_source: 'github_release' }), {
      db: () => db,
      authorize: () => null,
      writeBody: vi.fn(async () => ''),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, code: 'AUTO_DRAFT_EXISTS' })
  })

  it('a manual draft (a person reviews it) still gets the LLM body, and a unique hit there is a plain 500', async () => {
    const { db, queries } = builderDb()
    const writeBody = vi.fn(async () => 'Warm LLM changelog')
    const res = await handleReleaseBuilder(post({ project_id: PROJECT, version: '1.4.0' }), { db: () => db, authorize: () => null, writeBody })
    expect(res.status).toBe(200)
    expect(writeBody).toHaveBeenCalledTimes(1)
    expect(findQueries(queries, 'releases', 'insert')[0].payload).toMatchObject({ body_md: 'Warm LLM changelog' })
    expect(findQueries(queries, 'releases', 'insert')[0].payload).not.toHaveProperty('auto_source')

    const dup = builderDb({ insertError: { code: '23505', message: 'dup' } })
    const res2 = await handleReleaseBuilder(post({ project_id: PROJECT, version: '1.4.0' }), { db: () => dup.db, authorize: () => null, writeBody })
    expect(res2.status).toBe(500)
  })

  it('a failed report read is a 500, never an empty release', async () => {
    const { db, queries } = builderDb({ reportsError: { message: 'timeout' } })
    const res = await handleReleaseBuilder(post({ project_id: PROJECT, version: '1.4.0', auto_source: 'recipe_event' }), {
      db: () => db,
      authorize: () => null,
      writeBody: vi.fn(async () => ''),
    })
    expect(res.status).toBe(500)
    expect(findQueries(queries, 'releases', 'insert')).toHaveLength(0)
  })

  it('refuses callers without the service role, bad bodies and other methods', async () => {
    const { db } = builderDb()
    const deps = { db: () => db, authorize: () => new Response('no', { status: 401 }), writeBody: vi.fn(async () => '') }
    expect((await handleReleaseBuilder(post({ project_id: PROJECT, version: '1' }), deps)).status).toBe(401)
    const open = { ...deps, authorize: () => null }
    expect((await handleReleaseBuilder(post({ project_id: 'nope', version: '1' }), open)).status).toBe(400)
    expect((await handleReleaseBuilder(post({ project_id: PROJECT, version: '1', auto_source: 'cron' }), open)).status).toBe(400)
    expect((await handleReleaseBuilder(new Request('https://x.test', { method: 'GET' }), open)).status).toBe(405)
  })
})
