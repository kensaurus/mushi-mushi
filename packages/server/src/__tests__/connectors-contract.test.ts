/**
 * Connector contract suite (Plan 019 §2b): every registered connector, with
 * recorded fixtures and no network.
 *
 *   - probe() never throws; no credential → not_connected (public_probe is
 *     always connected); a rejected credential → ok:false, never ok;
 *   - a network failure during snapshot → `error`, never `connected`;
 *   - a recorded snapshot validates against the Zod schema;
 *   - act() without a matching approval hash is refused;
 *   - proposeChange() never returns a denied path;
 *   - App Store Connect's unaccepted agreement → `blocked`, with the step.
 */
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

type Registry = typeof import('../../supabase/functions/_shared/connectors/index.ts')
let registry: Registry
let schema: typeof import('../../supabase/functions/_shared/connectors/schema.ts')
let runtime: typeof import('../../supabase/functions/_shared/connectors/runtime.ts')
let canonical: typeof import('../../supabase/functions/_shared/connectors/canonical.ts')
let jwt: typeof import('../../supabase/functions/_shared/connectors/jwt.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  registry = await import('../../supabase/functions/_shared/connectors/index.ts')
  schema = await import('../../supabase/functions/_shared/connectors/schema.ts')
  runtime = await import('../../supabase/functions/_shared/connectors/runtime.ts')
  canonical = await import('../../supabase/functions/_shared/connectors/canonical.ts')
  jwt = await import('../../supabase/functions/_shared/connectors/jwt.ts')
})

const NOW = new Date('2026-10-02T12:00:00Z')
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

/** A credential and config that make each connector try the network. */
const SETUP: Record<string, { credential: string; config: Record<string, unknown>; bindings?: Array<{ projectId: string; externalId: string; role: string }> }> = {
  github: { credential: 'ghp_test', config: { owner: 'kensaurus', repo: 'glot.it' } },
  supabase: { credential: 'sbp_test', config: { projectRef: 'abcdefghijklmnopqrst' } },
  sentry: { credential: 'sntrys_test', config: { orgSlug: 'kensaurus', projectSlug: 'glot' } },
  http: { credential: 'whsec_test', config: { endpoint: 'https://legacy.example.com/mushi' } },
  public_probe: { credential: '', config: { manifest: null } },
  app_store_connect: { credential: JSON.stringify({ keyId: 'ABC123', issuerId: 'iss', privateKey: ec }), config: {}, bindings: [{ projectId: 'p1', externalId: '6761582648', role: 'ios' }] },
  play_console: { credential: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: rsa }), config: { package: 'com.glotit.app' }, bindings: [{ projectId: 'p1', externalId: 'com.glotit.app', role: 'android' }] },
  llm_usage: { credential: 'sk-admin-test', config: { provider: 'openai' }, bindings: [{ projectId: 'p1', externalId: 'proj_abc', role: 'spend' }] },
  revenuecat: { credential: 'sk_rc_test', config: {}, bindings: [{ projectId: 'p1', externalId: 'proj1a2b3c', role: 'billing' }] },
}

function ctx(kind: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, withCredential = true) {
  const s = SETUP[kind]
  return {
    db: makeFakeDb({}) as never,
    organizationId: 'org-1',
    projectId: 'p1',
    readCredential: withCredential && s.credential ? s.credential : null,
    writeCredential: withCredential && s.credential ? s.credential : null,
    config: s.config,
    fetch: fetchImpl,
    now: () => NOW,
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const always = (status: number, body: unknown = {}) => vi.fn(async () => json(status, body))
const offline = vi.fn(async () => { throw new TypeError('fetch failed') })

/** Recorded vendor answers keyed by URL fragment. */
function recorded(url: string, init?: RequestInit): Response {
  if (url.includes('oauth2.googleapis.com/token')) return json(200, { access_token: 'ya29.test' })
  if (url.includes('api.github.com')) {
    if (url.endsWith('/repos/kensaurus/glot.it')) return json(200, { default_branch: 'main', permissions: { push: true } })
    if (url.includes('/commits/main')) return json(200, { sha: 'abc1234def', commit: { committer: { date: '2026-10-01T00:00:00Z' } } })
    if (url.includes('/contents/.github/workflows?')) return json(200, [{ type: 'file', path: '.github/workflows/ci.yml', name: 'ci.yml' }])
    if (url.includes('/contents/.github/workflows/ci.yml')) return json(200, { content: btoa('on: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []\n') })
    if (url.includes('/actions/runs?')) return json(200, { workflow_runs: [{ id: 1, path: '.github/workflows/ci.yml', name: 'CI', event: 'push', head_branch: 'main', head_sha: 'abc1234def', status: 'completed', conclusion: 'failure', run_started_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:05:00Z' }] })
    if (url.includes('/jobs')) return json(200, { jobs: [{ started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:04:30Z', labels: ['ubuntu-latest'] }] })
    if (url.includes('/actions/secrets')) return json(200, { secrets: [{ name: 'NEXT_PUBLIC_MUSHI_API_KEY' }] })
    if (url.includes('/actions/variables')) return json(200, { variables: [] })
    if (url.includes('/contents/supabase/config.toml')) return json(200, { content: btoa('[auth]\nsite_url = "https://glot.it"\n[auth.external.google]\nenabled = true\nsecret = "s3cr3t"\n') })
  }
  if (url.includes('mcp.supabase.com')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { params?: { name?: string; arguments?: { query?: string } } }
    const name = body.params?.name
    const text = name === 'list_tables' ? JSON.stringify([{ name: 'profiles', rls_enabled: true }])
      : name === 'execute_sql' ? `<untrusted-data-1a>\n${JSON.stringify(body.params?.arguments?.query?.includes('schema_migrations') ? [{ version: '20261001000000' }] : [])}\n</untrusted-data-1a>`
      : '[]'
    return json(200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } })
  }
  if (url.includes('sentry.io')) {
    if (url.includes('/releases/')) return json(200, [{ version: '1.102.0' }])
    return json(200, [{ slug: 'glot' }])
  }
  if (url.includes('legacy.example.com')) {
    return json(200, { observedAt: NOW.toISOString(), elements: { deploy: { summary: { version: '3.1.0' } } }, resources: [], facts: { findings: [] } })
  }
  if (url.includes('api.appstoreconnect.apple.com')) {
    if (url.includes('/appStoreVersions')) return json(200, { data: [{ attributes: { versionString: '1.102.0', appVersionState: 'READY_FOR_DISTRIBUTION', createdDate: '2026-09-20T00:00:00Z' } }] })
    if (url.includes('/builds')) return json(200, { data: [{ attributes: { version: '412', processingState: 'VALID', uploadedDate: '2026-09-19T00:00:00Z' } }] })
    return json(200, { data: [] })
  }
  if (url.includes('androidpublisher.googleapis.com')) {
    if (init?.method === 'POST' && url.endsWith('/edits')) return json(200, { id: 'edit-1' })
    if (url.endsWith('/tracks')) return json(200, { tracks: [{ track: 'production', releases: [{ name: '1.102.0', versionCodes: ['412'], status: 'completed' }] }] })
    return json(200, {})
  }
  if (url.includes('api.openai.com')) return json(200, { data: [{ start_time: 1759276800, results: [{ amount: { value: 1.25 }, project_id: 'proj_abc' }] }] })
  if (url.includes('api.revenuecat.com')) {
    if (url.includes('/entitlements')) return json(200, { items: [{ lookup_key: 'pro', display_name: 'Pro' }] })
    if (url.includes('/offerings')) return json(200, { items: [{ lookup_key: 'default', is_current: true }] })
    if (url.includes('/apps')) return json(200, { items: [{ type: 'app_store', app_store: { bundle_id: 'com.glotit.app' } }] })
    return json(200, { items: [] })
  }
  if (url.includes('rdap.org') || url.includes('crt.sh') || url.includes('itunes.apple.com') || url.includes('play.google.com')) return json(404, {})
  return json(404, {})
}

describe('connector contract', () => {
  it('every registered kind has a connector, and planned kinds are not faked', () => {
    const kinds = registry.listConnectors().map((c) => c.kind).sort()
    expect(kinds).toEqual(['app_store_connect', 'github', 'http', 'llm_usage', 'play_console', 'public_probe', 'revenuecat', 'sentry', 'supabase'])
    for (const k of registry.plannedKinds()) expect(() => registry.getConnector(k)).toThrow(registry.UnknownConnectorKind)
    expect(() => registry.getConnector('nope')).toThrow(registry.UnknownConnectorKind)
  })

  for (const kind of ['github', 'supabase', 'sentry', 'http', 'public_probe', 'app_store_connect', 'play_console', 'llm_usage', 'revenuecat']) {
    describe(kind, () => {
      it('probe without a credential is not_connected (or connected for public checks), never a throw', async () => {
        const c = registry.getConnector(kind)
        const r = await c.probe(ctx(kind, always(500), false) as never)
        if (kind === 'public_probe') expect(r.status).toBe('connected')
        else expect(r).toMatchObject({ ok: false, status: 'not_connected' })
        if (!r.ok) expect(r.reason).toBeTruthy()
      })

      if (kind !== 'public_probe') {
        it('a rejected credential is ok:false, never ok', async () => {
          const r = await registry.getConnector(kind).probe(ctx(kind, always(401, { errors: [{ code: 'NOT_AUTHORIZED' }] })) as never)
          expect(r.ok).toBe(false)
          expect(['error', 'blocked']).toContain(r.status)
        })

        it('a network failure during snapshot is error, never connected', async () => {
          const entry = { connector: registry.getConnector(kind), instanceId: 'i1', bindings: SETUP[kind].bindings ?? [], ctx: { ...ctx(kind, offline), db: makeFakeDb({}) as never } }
          const res = await runtime.runConnector(makeFakeDb({}) as never, entry as never, null)
          expect(res.status).toBe('error')
          expect(res.snapshot).toBeNull()
        })
      }

      it('a recorded snapshot validates against the schema', async () => {
        const c = registry.getConnector(kind)
        const snap = await c.snapshot(ctx(kind, async (u, i) => recorded(u, i)) as never, SETUP[kind].bindings ?? [])
        const v = schema.validateSnapshot(snap)
        expect(v.ok, v.ok ? '' : v.error).toBe(true)
        if (c.detectDrift) expect(Array.isArray(c.detectDrift(null, snap, null))).toBe(true)
      })

      it('act refuses a payload that does not match the approved hash', async () => {
        const c = registry.getConnector(kind)
        if (!c.act) return
        const payload = { package: 'com.glotit.app', track: 'production', userFraction: 0.2, versionCodes: ['412'] }
        const r = await c.act(ctx(kind, async (u, i) => recorded(u, i)) as never, { id: 'a1', action: 'set_rollout', payload, payloadSha256: 'f'.repeat(64) })
        expect(r.ok).toBe(false)
        expect(r.detail).toMatch(/does not match/)
      })
    })
  }
})

describe('connector specifics', () => {
  it('GitHub reads the login settings declared in supabase/config.toml, without secret values', async () => {
    const snap = await registry.getConnector('github').snapshot(ctx('github', async (u, i) => recorded(u, i)) as never, [])
    const auth = (snap.facts as { supabaseAuth?: unknown }).supabaseAuth
    expect(auth).toEqual({ path: 'kensaurus/glot.it/supabase/config.toml', settings: { siteUrl: 'https://glot.it', providers: ['email', 'google'] } })
    expect(JSON.stringify(snap)).not.toContain('s3cr3t')
  })

  it('App Store Connect reads an unaccepted agreement as blocked, with the step to take', async () => {
    const c = registry.getConnector('app_store_connect')
    const r = await c.probe(ctx('app_store_connect', always(403, { errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED', title: 'A required agreement is missing or has expired.' }] })) as never)
    expect(r).toMatchObject({ ok: false, status: 'blocked' })
    expect(r.reason).toMatch(/Agreements/)
  })

  it('a probe says why it failed: 401 is credential_rejected with nothing missing, only a 403 names a missing scope', async () => {
    const play = registry.getConnector('play_console')
    expect(await play.probe(ctx('play_console', always(401, { error: 'invalid_grant' })) as never)).toMatchObject({ ok: false, failure: 'credential_rejected', missing: [] })
    const denied = await play.probe(ctx('play_console', async (u) => (u.includes('oauth2') ? json(200, { access_token: 't' }) : json(403, {}))) as never)
    expect(denied).toMatchObject({ ok: false, failure: 'permission_missing', missing: ['View app information (read-only)'] })
    expect((await play.probe(ctx('play_console', offline) as never)).missing).toEqual([])
    const asc = await registry.getConnector('app_store_connect').probe(ctx('app_store_connect', always(403, { errors: [{ code: 'FORBIDDEN_ERROR' }] })) as never)
    expect(asc).toMatchObject({ ok: false, failure: 'permission_missing' })
    expect(asc.missing).toHaveLength(1)
    expect(await registry.getConnector('sentry').probe(ctx('sentry', always(401)) as never)).toMatchObject({ failure: 'credential_rejected' })
  })

  it('a failed snapshot stores why it failed (error_kind) for the radar', async () => {
    const db = makeFakeDb({})
    const entry = { connector: registry.getConnector('revenuecat'), instanceId: 'i1', bindings: SETUP.revenuecat.bindings, ctx: { ...ctx('revenuecat', always(401)), db } }
    const res = await runtime.runConnector(db as never, entry as never, null)
    expect(res.status).toBe('error')
    expect(db.table('connector_snapshots')[0]).toMatchObject({ ok: false, error_kind: 'credential_rejected' })
  })

  it('a snapshot that could not be stored is an error with the reason, never connected or a silent drop', async () => {
    const base = makeFakeDb({})
    const failed = { data: null, error: { message: 'column "error_kind" does not exist' } }
    const chain: unknown = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
    const db = new Proxy(base, { get: (t, prop, r) => (prop === 'from' ? (name: string) => (name === 'connector_snapshots' ? chain : t.from(name)) : Reflect.get(t, prop, r)) })
    // The vendor answers fine; only the write fails.
    const okEntry = { connector: registry.getConnector('revenuecat'), instanceId: 'i1', bindings: SETUP.revenuecat.bindings, ctx: { ...ctx('revenuecat', vi.fn(async (u: string, i?: RequestInit) => recorded(u, i))), db } }
    const stored = await runtime.runConnector(db as never, okEntry as never, null)
    expect(stored.status).toBe('error')
    expect(stored.reason).toMatch(/Could not store the .* snapshot: column "error_kind" does not exist/)
    // The vendor said no and that failure could not be written either: the result still says both.
    const badEntry = { ...okEntry, ctx: { ...okEntry.ctx, fetch: always(401) } }
    const denied = await runtime.runConnector(db as never, badEntry as never, null)
    expect(denied.status).toBe('error')
    expect(denied.reason).toMatch(/error_kind/)
  })

  it('GitHub proposeChange drops workflow, env and out-of-allowlist paths', async () => {
    const c = registry.getConnector('github')
    const manifest = { version: 1, change: { allowPaths: ['mushi.recipe.json', 'tokens/**'] } }
    const edits = await c.proposeChange!(ctx('github', always(200)) as never, {
      element: 'design',
      intent: { manifest, edits: [
        { path: 'tokens/a.json', content: '{}' },
        { path: '.github/workflows/ci.yml', content: 'x' },
        { path: '.env', content: 'SECRET=1' },
        { path: 'src/app.ts', content: 'x' },
        { path: '../escape', content: 'x' },
      ] },
    })
    expect(edits.map((e) => e.path)).toEqual(['tokens/a.json'])
  })

  it('the HTTP connector signs in the plugin-sdk format and refuses an invalid snapshot', async () => {
    const c = registry.getConnector('http')
    const seen: Array<{ url: string; sig: string | null; body: string }> = []
    const bad = await c.snapshot(ctx('http', async (url, init) => {
      seen.push({ url, sig: new Headers(init?.headers).get('X-Mushi-Signature'), body: String(init?.body) })
      return json(200, { observedAt: 'yesterday', elements: {}, resources: [] })
    }) as never, []).catch((e: Error) => e)
    expect(bad).toBeInstanceOf(Error)
    expect(String((bad as Error).message)).toMatch(/cannot read/)
    const { body, sig } = seen[0]
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig ?? '')
    expect(m).not.toBeNull()
    expect(m![2]).toBe(await jwt.hmacSha256Hex('whsec_test', `${m![1]}.${body}`))
  })

  it('the HTTP connector refuses a private endpoint before sending anything', async () => {
    const c = registry.getConnector('http')
    const f = vi.fn(async () => json(200, {}))
    const r = await c.probe({ ...ctx('http', f), config: { endpoint: 'https://169.254.169.254/latest' } } as never)
    expect(r.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('Play act commits only with the exact approved payload, through one edit', async () => {
    const c = registry.getConnector('play_console')
    const payload = { package: 'com.glotit.app', track: 'production', userFraction: 0.2, versionCodes: ['412'] }
    const calls: string[] = []
    const r = await c.act(ctx('play_console', async (u, i) => { calls.push(`${i?.method ?? 'GET'} ${u.replace(/^https:\/\/[^/]+/, '')}`); return recorded(u, i) }) as never, {
      id: 'a1', action: 'set_rollout', payload, payloadSha256: await jwt.sha256Hex(canonical.canonicalJson(payload)),
    })
    expect(r.ok).toBe(true)
    expect(calls.some((x) => x.startsWith('PUT') && x.endsWith('/tracks/production'))).toBe(true)
    expect(calls.some((x) => x.includes(':commit'))).toBe(true)
  })

  it('llm usage attributes spend by binding and flags unattributed spend', async () => {
    const c = registry.getConnector('llm_usage')
    const snap = await c.snapshot(ctx('llm_usage', async (u, i) => recorded(u, i)) as never, [])
    expect(snap.facts).toMatchObject({ unattributedUsd: 1.25, totalUsd: 1.25 })
    expect(c.detectDrift!(null, snap, null)[0]).toMatchObject({ ruleId: 'key_shared_across_apps', severity: 'info' })
    const bound = await c.snapshot(ctx('llm_usage', async (u, i) => recorded(u, i)) as never, SETUP.llm_usage.bindings!)
    expect(bound.facts).toMatchObject({ perProject: { p1: 1.25 }, unattributedUsd: 0 })
  })
})
