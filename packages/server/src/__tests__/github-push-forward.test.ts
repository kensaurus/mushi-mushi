/**
 * Push indexing for PAT-connected repos (gap #16b): `/v1/webhooks/github`
 * routes a `push` delivery to the indexer only for projects whose own
 * webhook secret verifies it, skips repos the GitHub App already covers,
 * and matches the repository case-insensitively without LIKE wildcards.
 * An unverified delivery gets one uniform 401, so the endpoint does not
 * reveal which repos are indexed. A failed hand-off to the indexer is
 * written to the repo row, not only logged.
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createIndexerPushForwarder,
  githubSignatureMatches,
  routePatPushWebhook,
  type PushForwardRequest,
} from '../../supabase/functions/_shared/github-push-forward.ts'

const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const R1 = '2000000a-0000-4000-8000-000000000000'
const R2 = '2000000b-0000-4000-8000-000000000000'
const R3 = '2000000c-0000-4000-8000-000000000000'

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

interface RepoRow { id: string; project_id: string; repo_url: string; indexing_enabled: boolean; github_app_installation_id: number | null }

/** Fake of the reads routePatPushWebhook makes: project_repos (ilike/eq/is/limit), project_settings, vault rpc. */
function fakeDb(repos: RepoRow[], secrets: Record<string, string | null>, opts: { repoError?: boolean } = {}) {
  const likePatterns: string[] = []
  const db = {
    from(table: string) {
      if (table === 'project_repos') {
        const filters: Array<(r: RepoRow) => boolean> = []
        const q = {
          select: () => q,
          ilike: (col: string, pattern: string) => {
            likePatterns.push(pattern)
            // Postgres ILIKE: `\` escapes, `%` any run, `_` one char.
            let re = ''
            for (let i = 0; i < pattern.length; i++) {
              const ch = pattern[i]
              if (ch === '\\') { re += pattern[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); continue }
              re += ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
            }
            const rx = new RegExp(`^${re}$`, 'i')
            filters.push((r) => rx.test(String(r[col as keyof RepoRow])))
            return q
          },
          eq: (col: string, v: unknown) => { filters.push((r) => r[col as keyof RepoRow] === v); return q },
          is: (col: string, v: null) => { filters.push((r) => r[col as keyof RepoRow] == v); return q },
          limit: async () => opts.repoError
            ? { data: null, error: { message: 'boom' } }
            : { data: repos.filter((r) => filters.every((f) => f(r))), error: null },
        }
        return q
      }
      if (table === 'project_settings') {
        let pid = ''
        const q = {
          select: () => q,
          eq: (_c: string, v: string) => { pid = v; return q },
          maybeSingle: async () => ({ data: { github_webhook_secret: secrets[pid] ?? null }, error: null }),
        }
        return q
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: async (_fn: string, args: Record<string, unknown>) => ({ data: `vault-value:${String(args.secret_name ?? args.secret_id ?? '')}`, error: null }),
  }
  return { db: db as never, likePatterns }
}

const payload = (fullName: string) =>
  JSON.stringify({
    ref: 'refs/heads/main',
    after: 'a'.repeat(40),
    repository: { full_name: fullName, name: fullName.split('/')[1], owner: { login: fullName.split('/')[0] }, default_branch: 'main' },
    commits: [{ id: 'c1', added: ['src/a.ts'], modified: [], removed: [] }],
  })

describe('githubSignatureMatches', () => {
  it('accepts the right HMAC and rejects anything else', async () => {
    const body = '{"x":1}'
    expect(await githubSignatureMatches(sign(body, 's3cret'), body, 's3cret')).toBe(true)
    expect(await githubSignatureMatches(sign(body, 'other'), body, 's3cret')).toBe(false)
    expect(await githubSignatureMatches('sha1=abc', body, 's3cret')).toBe(false)
    expect(await githubSignatureMatches(sign(body, 's3cret'), body, '')).toBe(false)
  })
})

describe('routePatPushWebhook', () => {
  const repos: RepoRow[] = [
    { id: R1, project_id: P1, repo_url: 'https://github.com/Acme/Shop', indexing_enabled: true, github_app_installation_id: null },
    { id: R2, project_id: P2, repo_url: 'https://github.com/acme/shop', indexing_enabled: true, github_app_installation_id: null },
    { id: R3, project_id: P2, repo_url: 'https://github.com/acme/app-installed', indexing_enabled: true, github_app_installation_id: 42 },
  ]

  it('forwards to the project whose secret verifies, matching the repo case-insensitively', async () => {
    const { db } = fakeDb(repos, { [P1]: 'secret-one', [P2]: 'secret-two' })
    const forward = vi.fn(async (_r: PushForwardRequest) => {})
    const body = payload('acme/shop')
    const res = await routePatPushWebhook({ body, signature: sign(body, 'secret-two'), deliveryId: 'd-1' }, { db, forward })
    expect(res.status).toBe(202)
    expect(res.outcome).toBe('accepted')
    expect(res.projectIds).toEqual([P2])
    expect(forward).toHaveBeenCalledTimes(1)
    expect(forward.mock.calls[0][0]).toMatchObject({ projectId: P2, repoId: R2, deliveryId: 'd-1' })
    expect((forward.mock.calls[0][0].payload as { after: string }).after).toBe('a'.repeat(40))
  })

  it('reads a vault:// secret through the vault rpc', async () => {
    const { db } = fakeDb(repos, { [P1]: 'vault://mushi/integration/p1/github/github_webhook_secret' })
    const forward = vi.fn(async () => {})
    const body = payload('Acme/Shop')
    const secret = 'vault-value:mushi/integration/p1/github/github_webhook_secret'
    const res = await routePatPushWebhook({ body, signature: sign(body, secret), deliveryId: null }, { db, forward })
    // The fake rpc returns `vault-value:<secret_id>`; a match proves the ref was dereferenced.
    expect(res.status).toBe(202)
    expect(res.projectIds).toEqual([P1])
    // Signing with the raw ref instead of its value must not verify.
    const forged = await routePatPushWebhook(
      { body, signature: sign(body, 'vault://mushi/integration/p1/github/github_webhook_secret'), deliveryId: null },
      { db, forward },
    )
    expect(forged.status).toBe(401)
  })

  it('fails closed: no verified project, no forward, 401', async () => {
    const { db } = fakeDb(repos, { [P1]: 'secret-one', [P2]: null })
    const forward = vi.fn(async () => {})
    const body = payload('acme/shop')
    const res = await routePatPushWebhook({ body, signature: sign(body, 'forged'), deliveryId: 'd-2' }, { db, forward })
    expect(res.status).toBe(401)
    expect(res.outcome).toBe('rejected_signature')
    expect(forward).not.toHaveBeenCalled()
  })

  it('skips a repo the GitHub App already delivers (no double indexing)', async () => {
    const { db } = fakeDb(repos, { [P2]: 'secret-two' })
    const forward = vi.fn(async () => {})
    const body = payload('acme/app-installed')
    const res = await routePatPushWebhook({ body, signature: sign(body, 'secret-two'), deliveryId: 'd-3' }, { db, forward })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ ok: true, data: { forwarded: 0, reason: 'the GitHub App indexes this repo' } })
    expect(res.auditNote).toBe('APP_DELIVERS_PUSH')
    expect(forward).not.toHaveBeenCalled()
  })

  it('tells a signed caller that indexing is off, and forwards nothing', async () => {
    const { db } = fakeDb(
      [{ id: R1, project_id: P1, repo_url: 'https://github.com/acme/quiet', indexing_enabled: false, github_app_installation_id: null }],
      { [P1]: 'secret-one' },
    )
    const forward = vi.fn(async () => {})
    const body = payload('acme/quiet')
    const res = await routePatPushWebhook({ body, signature: sign(body, 'secret-one'), deliveryId: 'd-5' }, { db, forward })
    expect(res.status).toBe(202)
    expect(res.auditNote).toBe('INDEXING_OFF')
    expect(res.projectIds).toEqual([P1])
    expect(forward).not.toHaveBeenCalled()
  })

  it('answers an unknown repo exactly like a bad signature (no repo enumeration)', async () => {
    const { db } = fakeDb(repos, { [P1]: 'secret-one', [P2]: 'secret-two' })
    const forward = vi.fn(async () => {})
    const unknownBody = payload('someone/not-a-customer')
    const unknown = await routePatPushWebhook({ body: unknownBody, signature: '', deliveryId: 'd-6' }, { db, forward })
    const knownBody = payload('acme/shop')
    const forged = await routePatPushWebhook({ body: knownBody, signature: sign(knownBody, 'forged'), deliveryId: 'd-7' }, { db, forward })
    expect(unknown.status).toBe(401)
    expect(forged.status).toBe(401)
    expect(unknown.body).toEqual(forged.body)
    expect(unknown.outcome).toBe(forged.outcome)
    // Only the audit log keeps the difference.
    expect(unknown.auditNote).toBe('NO_PROJECT_FOR_REPO')
    expect(forged.auditNote).toBe('INVALID_SIGNATURE')
    expect(forward).not.toHaveBeenCalled()
  })

  it('escapes LIKE wildcards so my_app never matches myXapp', async () => {
    const { db, likePatterns } = fakeDb(
      [{ id: R1, project_id: P1, repo_url: 'https://github.com/acme/myXapp', indexing_enabled: true, github_app_installation_id: null }],
      { [P1]: 'secret-one' },
    )
    const forward = vi.fn(async () => {})
    const body = payload('acme/my_app')
    const res = await routePatPushWebhook({ body, signature: sign(body, 'secret-one'), deliveryId: 'd-4' }, { db, forward })
    expect(likePatterns[0]).toBe('https://github.com/acme/my\\_app')
    expect(res.status).toBe(401)
    expect(res.auditNote).toBe('NO_PROJECT_FOR_REPO')
    expect(forward).not.toHaveBeenCalled()
  })

  it('answers bad JSON with 400 and a missing repository with a no-op', async () => {
    const { db } = fakeDb(repos, {})
    const forward = vi.fn(async () => {})
    expect((await routePatPushWebhook({ body: '{nope', signature: '', deliveryId: null }, { db, forward })).status).toBe(400)
    expect((await routePatPushWebhook({ body: '{}', signature: '', deliveryId: null }, { db, forward })).status).toBe(200)
    expect(forward).not.toHaveBeenCalled()
  })

  it('a lookup error is a 500, not a silent accept', async () => {
    const { db } = fakeDb(repos, {}, { repoError: true })
    const res = await routePatPushWebhook({ body: payload('acme/shop'), signature: '', deliveryId: null }, { db, forward: vi.fn() })
    expect(res.status).toBe(500)
    expect(res.outcome).toBe('error')
  })
})

/** Fake db for the forwarder: records project_repos updates. */
function updatesDb(opts: { updateError?: boolean } = {}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const db = {
    from(table: string) {
      expect(table).toBe('project_repos')
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ id, patch })
            return { error: opts.updateError ? { message: 'write failed' } : null }
          },
        }),
      }
    },
  }
  return { db: db as never, updates }
}

const NOW = '2026-10-03T12:00:00.000Z'
const REQ: PushForwardRequest = { projectId: P1, repoId: R1, deliveryId: 'd-9', payload: { after: 'a'.repeat(40) } }

function forwarderWith(fetchImpl: typeof fetch, extra: { supabaseUrl?: string; updateError?: boolean } = {}) {
  const { db, updates } = updatesDb({ updateError: extra.updateError })
  const tasks: Promise<unknown>[] = []
  const log = { warn: vi.fn(), error: vi.fn() }
  const forward = createIndexerPushForwarder({
    db,
    supabaseUrl: 'supabaseUrl' in extra ? extra.supabaseUrl : 'https://x.supabase.co',
    internalSecret: 'internal',
    background: (t) => { tasks.push(t) },
    log,
    fetchImpl,
    nowIso: () => NOW,
  })
  return { forward, updates, log, settle: () => Promise.all(tasks) }
}

describe('createIndexerPushForwarder', () => {
  it('posts mode push with internal auth and records nothing on success', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const f = forwarderWith(fetchImpl as unknown as typeof fetch)
    await f.forward(REQ)
    await f.settle()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.supabase.co/functions/v1/webhooks-github-indexer')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer internal')
    expect(JSON.parse(String(init.body))).toMatchObject({ mode: 'push', project_id: P1, repo_id: R1, delivery_id: 'd-9' })
    expect(f.updates).toEqual([])
  })

  it('writes a non-2xx indexer answer to the repo row', async () => {
    const f = forwarderWith((async () => new Response('{"error":{"code":"PUSH_INDEX_FAILED"}}', { status: 500 })) as unknown as typeof fetch)
    await f.forward(REQ)
    await f.settle()
    expect(f.updates).toHaveLength(1)
    expect(f.updates[0].id).toBe(R1)
    expect(f.updates[0].patch.last_index_attempt_at).toBe(NOW)
    expect(String(f.updates[0].patch.last_index_error)).toContain('HTTP 500')
    expect(String(f.updates[0].patch.last_index_error)).toContain('PUSH_INDEX_FAILED')
  })

  it('writes a failed request and a timeout to the repo row, worded apart', async () => {
    const boom = forwarderWith((async () => { throw new Error('connection reset') }) as unknown as typeof fetch)
    await boom.forward(REQ)
    await boom.settle()
    expect(String(boom.updates[0].patch.last_index_error)).toContain('request failed: connection reset')

    const slow = forwarderWith((async () => {
      throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
    }) as unknown as typeof fetch)
    await slow.forward(REQ)
    await slow.settle()
    expect(String(slow.updates[0].patch.last_index_error)).toContain('did not answer within 150 s')
  })

  it('a failed bookkeeping write is logged as an error', async () => {
    const f = forwarderWith((async () => new Response('', { status: 502 })) as unknown as typeof fetch, { updateError: true })
    await f.forward(REQ)
    await f.settle()
    expect(f.log.error).toHaveBeenCalled()
  })

  it('missing configuration is recorded on the row and thrown (the route answers 500)', async () => {
    const fetchImpl = vi.fn()
    const f = forwarderWith(fetchImpl as unknown as typeof fetch, { supabaseUrl: undefined })
    await expect(f.forward(REQ)).rejects.toThrow('not configured')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(String(f.updates[0].patch.last_index_error)).toContain('not configured')
  })
})

describe('wiring', () => {
  const FN = resolve(__dirname, '../../supabase/functions')
  const publicRoutes = readFileSync(resolve(FN, 'api/routes/public.ts'), 'utf8')
  const indexer = readFileSync(resolve(FN, 'webhooks-github-indexer/index.ts'), 'utf8')

  it('/v1/webhooks/github handles push before the check-run filter and forwards with internal auth', () => {
    const route = publicRoutes.slice(publicRoutes.indexOf("app.post('/v1/webhooks/github'"))
    expect(route.indexOf("if (event === 'push')")).toBeGreaterThan(-1)
    expect(route.indexOf("if (event === 'push')")).toBeLessThan(route.indexOf("if (event !== 'check_run' && event !== 'check_suite')"))
    expect(route).toContain('createIndexerPushForwarder({')
    expect(route).toContain("Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET')")
    // The audit row keeps why a delivery was rejected.
    expect(route).toContain('pushed.auditNote')
  })

  it("the indexer's internal push mode goes through the shared handler and the App push path", () => {
    const handler = indexer.slice(indexer.indexOf('function handleInternalPush('), indexer.indexOf("app.post('/webhooks-github-indexer'"))
    expect(handler).toContain('handleInternalPushRequest<PushPayload>(req, body, {')
    expect(handler).toContain('requireAuth: requireServiceRoleAuth')
    expect(handler).toContain('indexPushForProject(db, {')
    const appPath = indexer.slice(indexer.indexOf("app.post('/webhooks-github-indexer'"))
    expect(appPath).toContain('indexPushForProject(db, {')
    expect(appPath).toContain('dispatchInternalIndexerRequest(')
  })
})
