/**
 * webhooks-github-indexer's internal modes (gap 16b): a sweep or push
 * handler that throws is a 500 naming the error, never a fall-through into
 * the GitHub-webhook path (where it read as 401 "invalid signature"); and
 * the internal push handler's auth, skips and bookkeeping.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  dispatchInternalIndexerRequest,
  handleInternalPushRequest,
  type InternalPushRepoRow,
} from '../../supabase/functions/_shared/indexer-internal.ts'

const P1 = '1000000a-0000-4000-8000-000000000000'
const R1 = '2000000a-0000-4000-8000-000000000000'
const NOW = '2026-10-03T12:00:00.000Z'

const ok = (body: Record<string, unknown> = {}) => async () => new Response(JSON.stringify({ ok: true, ...body }), { status: 200 })

describe('dispatchInternalIndexerRequest', () => {
  const log = () => ({ error: vi.fn() })

  it('routes sweep and push to their handlers', async () => {
    const sweep = vi.fn(ok({ m: 'sweep' }))
    const push = vi.fn(ok({ m: 'push' }))
    const s = await dispatchInternalIndexerRequest('{"mode":"sweep","project_id":"x"}', { sweep, push }, log())
    expect(await s?.json()).toMatchObject({ m: 'sweep' })
    expect(sweep.mock.calls[0][0]).toMatchObject({ project_id: 'x' })
    const p = await dispatchInternalIndexerRequest('{"mode":"push"}', { sweep, push }, log())
    expect(await p?.json()).toMatchObject({ m: 'push' })
  })

  it('returns null only for bodies that are not internal requests', async () => {
    const handlers = { sweep: vi.fn(ok()), push: vi.fn(ok()) }
    for (const raw of ['', 'not json', '[1,2]', 'null', '{"ref":"refs/heads/main"}', '{"mode":"other"}']) {
      expect(await dispatchInternalIndexerRequest(raw, handlers, log()), raw).toBeNull()
    }
    expect(handlers.sweep).not.toHaveBeenCalled()
    expect(handlers.push).not.toHaveBeenCalled()
  })

  it('a throwing push handler is a 500 with a code, not a fall-through; the cause is logged, not returned', async () => {
    const l = log()
    const res = await dispatchInternalIndexerRequest(
      '{"mode":"push"}',
      { sweep: vi.fn(ok()), push: async () => { throw new Error('codebase scope read failed: timeout') } },
      l,
    )
    expect(res).not.toBeNull()
    expect(res?.status).toBe(500)
    const text = await res!.text()
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: 'PUSH_INDEX_FAILED', message: 'Indexing the push failed. The indexer logs have the cause.' },
    })
    expect(text).not.toContain('timeout')
    expect(l.error).toHaveBeenCalledWith('internal push failed', { error: 'codebase scope read failed: timeout' })
  })

  it('a throwing sweep handler is a 500 too, and no stack or message reaches the body', async () => {
    const l = log()
    const err = new Error('boom at /srv/secret/path.ts')
    const res = await dispatchInternalIndexerRequest(
      '{"mode":"sweep"}',
      { sweep: async () => { throw err }, push: vi.fn(ok()) },
      l,
    )
    expect(res?.status).toBe(500)
    const text = await res!.text()
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('SWEEP_FAILED')
    expect(text).not.toContain('boom')
    expect(text).not.toContain('/srv/secret')
    expect(text).not.toContain(String(err.stack).split('\n')[1]?.trim() ?? 'no-stack')
    expect(l.error).toHaveBeenCalledWith('internal sweep failed', { error: 'boom at /srv/secret/path.ts' })
  })

  it('the indexer routes through it and no longer swallows handler errors', () => {
    const indexer = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-github-indexer/index.ts'), 'utf8')
    const route = indexer.slice(indexer.indexOf("app.post('/webhooks-github-indexer'"))
    expect(route).toContain('dispatchInternalIndexerRequest(')
    expect(route).toContain('if (internal) return internal;')
    expect(indexer).not.toContain('fall through to webhook handling')
    expect(route.indexOf('dispatchInternalIndexerRequest(')).toBeLessThan(route.indexOf('verifySignature('))
  })
})

const ROW: InternalPushRepoRow = {
  id: R1,
  project_id: P1,
  repo_url: 'https://github.com/Acme/Shop',
  default_branch: 'main',
  github_app_installation_id: null,
  indexing_enabled: true,
  path_globs: null,
  index_file_cap: 300,
  index_files_indexed: 10,
  index_files_eligible: 20,
  index_tree_truncated: false,
  index_coverage_state: 'filling',
}

/** Fake db: one project_repos read, then updates. */
function fakeDb(row: InternalPushRepoRow | null, opts: { readError?: boolean; updateError?: boolean } = {}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const reads: Array<Record<string, unknown>> = []
  const db = {
    from(table: string) {
      expect(table).toBe('project_repos')
      const filters: Record<string, unknown> = {}
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { filters[col] = v; return q },
        maybeSingle: async () => {
          reads.push({ ...filters })
          return opts.readError ? { data: null, error: { message: 'read failed' } } : { data: row, error: null }
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ id, patch })
            return { error: opts.updateError ? { message: 'write failed' } : null }
          },
        }),
      }
      return q
    },
  }
  return { db: db as never, updates, reads }
}

const body = (over: Record<string, unknown> = {}) => ({
  mode: 'push',
  project_id: P1,
  repo_id: R1,
  delivery_id: 'd-1',
  payload: { after: 'b'.repeat(40), repository: { owner: { login: 'acme' }, name: 'shop' } },
  ...over,
})

function deps(row: InternalPushRepoRow | null, opts: { readError?: boolean; updateError?: boolean; token?: string | null; auth?: Response | null } = {}) {
  const f = fakeDb(row, opts)
  const indexPush = vi.fn(async () => ({ status: 200, body: { ok: true, inserted: 3 } }))
  return {
    ...f,
    indexPush,
    deps: {
      db: f.db,
      requireAuth: () => opts.auth ?? null,
      resolveToken: async () => (opts.token === undefined ? 'tok' : opts.token),
      indexPush,
      nowIso: () => NOW,
    },
  }
}

const req = new Request('https://x/webhooks-github-indexer', { method: 'POST' })

describe('handleInternalPushRequest', () => {
  it('rejects a caller without internal auth before touching the db', async () => {
    const d = deps(ROW, { auth: new Response('{"ok":false}', { status: 401 }) })
    const res = await handleInternalPushRequest(req, body(), d.deps)
    expect(res.status).toBe(401)
    expect(d.reads).toEqual([])
  })

  it('400s a body without ids or a push payload', async () => {
    const d = deps(ROW)
    expect((await handleInternalPushRequest(req, body({ project_id: 'nope' }), d.deps)).status).toBe(400)
    expect((await handleInternalPushRequest(req, body({ payload: { repository: {} } }), d.deps)).status).toBe(400)
  })

  it('a project_repos read error is a 500, not an ignore', async () => {
    const d = deps(ROW, { readError: true })
    const res = await handleInternalPushRequest(req, body(), d.deps)
    expect(res.status).toBe(500)
    expect(d.indexPush).not.toHaveBeenCalled()
  })

  it('skips indexing-off rows, App-installed rows and a different repo', async () => {
    for (const [row, reason] of [
      [{ ...ROW, indexing_enabled: false }, 'indexing_not_enabled'],
      [null, 'indexing_not_enabled'],
      [{ ...ROW, github_app_installation_id: 42 }, 'app_installation_delivers_directly'],
      [{ ...ROW, repo_url: 'https://github.com/acme/other' }, 'repo_mismatch'],
    ] as const) {
      const d = deps(row)
      const res = await handleInternalPushRequest(req, body(), d.deps)
      expect(res.status).toBe(202)
      expect(((await res.json()) as { ignored: string }).ignored).toBe(reason)
      expect(d.indexPush).not.toHaveBeenCalled()
    }
  })

  it('records no_token on the row, and a failed record is a 500', async () => {
    const d = deps(ROW, { token: null })
    const res = await handleInternalPushRequest(req, body(), d.deps)
    expect(res.status).toBe(202)
    expect(d.updates).toEqual([{ id: R1, patch: { last_index_attempt_at: NOW, last_index_error: expect.stringContaining('no_token') } }])

    const bad = deps(ROW, { token: null, updateError: true })
    expect((await handleInternalPushRequest(req, body(), bad.deps)).status).toBe(500)
  })

  it('indexes with the row (cap and coverage columns) and the project token', async () => {
    const d = deps(ROW)
    const res = await handleInternalPushRequest(req, body(), d.deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, inserted: 3, via: 'pat_webhook' })
    expect(d.reads[0]).toEqual({ id: R1, project_id: P1 })
    expect(d.indexPush).toHaveBeenCalledWith(expect.objectContaining({ row: ROW, token: 'tok', owner: 'acme', repo: 'shop', deliveryId: 'd-1' }))
  })

  it('passes an indexing failure status through', async () => {
    const d = deps(ROW)
    d.indexPush.mockResolvedValueOnce({ status: 500, body: { ok: false, error: { code: 'ALL_UPSERTS_FAILED' } } } as never)
    expect((await handleInternalPushRequest(req, body(), d.deps)).status).toBe(500)
  })
})
