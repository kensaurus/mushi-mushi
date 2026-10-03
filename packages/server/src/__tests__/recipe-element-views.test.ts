/**
 * Per-element recipe views (gap #17): the schema table list and its diff, CI
 * runs with estimated minutes, deploy expected vs observed per target, and
 * the env environment × variable matrix. Never observed is never ok, and a
 * location whose names could not be listed is "not checked", never "missing".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let detail: typeof import('../../supabase/functions/_shared/recipe-detail.ts')
let github: typeof import('../../supabase/functions/_shared/connectors/github.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  detail = await import('../../supabase/functions/_shared/recipe-detail.ts')
  github = await import('../../supabase/functions/_shared/connectors/github.ts')
})

describe('schemaView', () => {
  const col = (name: string) => ({ name, type: 'text', nullable: true })
  const before = [
    { name: 'profiles', schema: 'public', rls_enabled: true, columns: [col('id'), col('name')] },
    { name: 'legacy', schema: 'public', rls_enabled: true, columns: [col('id')] },
    { name: 'orders', schema: 'public', rls_enabled: true, columns: [col('id')] },
  ]
  const after = [
    { name: 'profiles', schema: 'public', rls_enabled: true, columns: [col('id'), col('display_name')] },
    { name: 'orders', schema: 'public', rls_enabled: false, columns: [col('id')] },
    { name: 'events', schema: 'public', rls_enabled: true, columns: [col('id'), col('at')] },
  ]

  it('lists the newest tables and diffs them against the snapshot before', () => {
    const v = detail.schemaView({ capturedAt: '2026-10-02T03:05:00Z', tables: after, source: 'drift_scanner' }, { capturedAt: '2026-10-01T03:05:00Z', tables: before })
    expect(v.tables.map((t) => [t.name, t.rls, t.columns])).toEqual([['events', true, 2], ['orders', false, 1], ['profiles', true, 2]])
    expect(v.totalTables).toBe(3)
    expect(v.diff).toEqual({
      previousCapturedAt: '2026-10-01T03:05:00Z',
      added: ['public.events'],
      removed: ['public.legacy'],
      changed: [
        { name: 'public.orders', addedColumns: [], removedColumns: [], rls: { from: true, to: false } },
        { name: 'public.profiles', addedColumns: ['display_name'], removedColumns: ['name'], rls: null },
      ],
    })
  })

  it('reads the Supabase connector’s table list (no columns) and says nothing exists yet when there is no snapshot', () => {
    const v = detail.schemaView({ capturedAt: 'x', tables: [{ name: 'profiles', rls: true }, { nope: 1 }], source: 'supabase_connector' }, null)
    expect(v).toEqual({ source: 'supabase_connector', capturedAt: 'x', tables: [{ name: 'profiles', schema: null, rls: true, columns: null }], totalTables: 1, diff: null })
    expect(detail.schemaView(null, null)).toEqual({ source: null, capturedAt: null, tables: [], totalTables: 0, diff: null })
  })
})

describe('ciView', () => {
  it('lists recent runs with estimated minutes, totals only what was estimated, and keeps https links only', () => {
    const v = detail.ciView([
      { run_id: 3, name: 'CI', event: 'push', head_branch: 'main', head_sha: 'abc', status: 'completed', conclusion: 'success', started_at: 'a', completed_at: 'b', est_billable_minutes: '4.25', html_url: 'https://github.com/k/r/actions/runs/3' },
      { run_id: 2, name: 'CI', status: 'completed', conclusion: 'failure', est_billable_minutes: 12, html_url: 'javascript:alert(1)' },
      { run_id: 1, name: 'Deploy', status: 'in_progress', conclusion: null, est_billable_minutes: null },
    ])
    expect(v.runs.map((r) => [r.runId, r.estMinutes, r.url])).toEqual([[3, 4.3, 'https://github.com/k/r/actions/runs/3'], [2, 12, null], [1, null, null]])
    expect(v).toMatchObject({ estMinutesTotal: 16.3, estimatedRuns: 2 })
    expect(detail.ciView([])).toMatchObject({ runs: [], estMinutesTotal: null, estimatedRuns: 0 })
  })
})

describe('deployView', () => {
  const manifest = {
    deploy: {
      targets: [
        { id: 'web', kind: 'vercel', environment: 'production', probe: { type: 'version_json', url: 'https://x/version.json' } },
        { id: 'staging', kind: 'vercel', probe: { type: 'version_json' } },
        { id: 'android', kind: 'play', probe: { type: 'sdk_heartbeat' } },
        { id: 'ios', kind: 'app-store' },
        { id: 'api', kind: 'fly', probe: { type: 'version_json' } },
      ],
    },
  }
  const obs = (target_id: string, extra: Record<string, unknown>) => ({ target_id, ok: true, error: null, observed_at: '2026-10-02T10:00:00Z', observed_version: '1.4.0', observed_commit: null, source: 'version_json', ...extra })

  it('compares each declared target with the default-branch head, and never calls an unobserved target live', () => {
    const v = detail.deployView({
      manifest,
      expectedCommit: 'abcdef1234567890',
      expectedVersion: '1.4.0',
      observations: [
        obs('web', { observed_commit: 'abcdef1' }),
        obs('web', { observed_commit: '0000000', observed_at: '2026-10-01T00:00:00Z' }),
        obs('staging', { observed_commit: '9999999aaaa' }),
        obs('android', { observed_commit: null, source: 'sdk_heartbeat' }),
        obs('api', { ok: false, error: 'HTTP 503' }),
        obs('old-target', {}),
      ],
    })
    expect(v.targets.map((t) => [t.id, t.status])).toEqual([['web', 'live'], ['staging', 'behind'], ['android', 'not_comparable'], ['ios', 'unobserved'], ['api', 'probe_failed']])
    expect(v.targets[0]).toMatchObject({ environment: 'production', probe: 'version_json', expected: { commit: 'abcdef1234567890', version: '1.4.0' }, observed: { commit: 'abcdef1', at: '2026-10-02T10:00:00Z' } })
    expect(v.targets[3]).toMatchObject({ observed: null, reason: expect.stringMatching(/No probe/) })
    expect(v.targets[4].reason).toMatch(/HTTP 503/)
    expect(v.undeclared).toEqual(['old-target'])
  })

  it('without a known head nothing is compared, and without targets there are no rows', () => {
    const v = detail.deployView({ manifest, expectedCommit: null, expectedVersion: null, observations: [obs('web', { observed_commit: 'abcdef1' })] })
    expect(v.targets[0]).toMatchObject({ status: 'not_comparable', reason: expect.stringMatching(/head is not known/) })
    expect(detail.deployView({ manifest: null, expectedCommit: 'a', expectedVersion: null, observations: [] }).targets).toEqual([])
  })
})

describe('envView', () => {
  const manifest = {
    env: {
      required: [
        { name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID' },
        { name: 'SENTRY_AUTH_TOKEN', in: ['github-actions', 'github-environment:production'] },
        { name: 'DATABASE_URL', in: ['runtime', 'github-environment:staging'] },
      ],
    },
  }

  it('builds the environment × variable matrix from what was actually listed', () => {
    const v = detail.envView({
      manifest,
      fallbackRequired: [],
      present: {
        'github-actions': ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'STRIPE_KEY', 'GITHUB_TOKEN'],
        'github-environment:production': ['SENTRY_AUTH_TOKEN'],
        'github-environment:preview': [],
      },
    })
    expect(v.columns).toEqual([
      { key: 'github-actions', label: 'GitHub Actions (repo)', checked: true },
      { key: 'github-environment:preview', label: 'GitHub env: preview', checked: true },
      { key: 'github-environment:production', label: 'GitHub env: production', checked: true },
      { key: 'github-environment:staging', label: 'GitHub env: staging', checked: false },
      { key: 'runtime', label: 'Runtime', checked: false },
    ])
    const row = (n: string) => v.rows.find((r) => r.name === n)!
    expect(row('NEXT_PUBLIC_MUSHI_PROJECT_ID').cells).toMatchObject({ 'github-actions': 'present', 'github-environment:production': 'not_required' })
    expect(row('SENTRY_AUTH_TOKEN').cells).toMatchObject({ 'github-actions': 'missing', 'github-environment:production': 'present' })
    // Declared where nothing could be listed: not checked, never missing.
    expect(row('DATABASE_URL').cells).toMatchObject({ 'github-environment:staging': 'not_checked', runtime: 'not_checked', 'github-actions': 'not_required' })
    // Found but undeclared; platform names are not listed.
    expect(row('STRIPE_KEY')).toMatchObject({ declared: false, cells: { 'github-actions': 'extra' } })
    expect(v.rows.some((r) => r.name === 'GITHUB_TOKEN')).toBe(false)
    expect(v.truncated).toBe(false)
  })

  it('a repo whose Actions names were refused shows the column as not checked', () => {
    const v = detail.envView({ manifest: null, fallbackRequired: ['NEXT_PUBLIC_MUSHI_API_KEY'], present: {} })
    expect(v.columns).toEqual([{ key: 'github-actions', label: 'GitHub Actions (repo)', checked: false }])
    expect(v.rows).toEqual([{ name: 'NEXT_PUBLIC_MUSHI_API_KEY', declared: true, cells: { 'github-actions': 'not_checked' } }])
  })

  it('presentEnvNames leaves out a location whose lists were refused', () => {
    expect(detail.presentEnvNames({ actionsNames: [], actionsNamesComplete: false, environmentNames: { production: ['A'] } })).toEqual({ 'github-environment:production': ['A'] })
    expect(detail.presentEnvNames({ actionsNames: ['B'] })).toEqual({ 'github-actions': ['B'] })
  })
})

describe('GitHub connector: env names per environment', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  function ctx(secrets403: boolean) {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/k/glot')) return json(200, { default_branch: 'main', permissions: { push: true } })
      if (url.includes('/commits/main')) return json(200, { sha: 'abc1234def', commit: { committer: { date: '2026-10-01T00:00:00Z' } } })
      if (url.includes('/environments?')) return json(200, { environments: [{ name: 'production' }, { name: 'staging' }, { name: '../bad' }] })
      if (url.includes('/environments/production/secrets')) return json(200, { secrets: [{ name: 'SENTRY_AUTH_TOKEN' }] })
      if (url.includes('/environments/production/variables')) return json(200, { variables: [{ name: 'APP_ENV' }] })
      if (url.includes('/environments/staging/')) return json(403, {})
      if (url.includes('/repos/k/glot/actions/secrets')) return secrets403 ? json(403, {}) : json(200, { secrets: [{ name: 'NEXT_PUBLIC_MUSHI_API_KEY' }] })
      if (url.includes('/repos/k/glot/actions/variables')) return json(200, { variables: [] })
      return json(404, {})
    })
    return { db: {} as never, organizationId: 'o', projectId: 'p', readCredential: 'ghp_x', writeCredential: null, config: { owner: 'k', repo: 'glot' }, fetch, now: () => new Date('2026-10-02T12:00:00Z') }
  }
  const manifest = { version: 1, env: { required: [{ name: 'NEXT_PUBLIC_MUSHI_API_KEY' }, { name: 'SENTRY_AUTH_TOKEN', in: ['github-environment:production'] }, { name: 'STAGING_DSN', in: ['github-environment:staging'] }, { name: 'APP_ENV', in: ['github-environment:production'] }] } }

  it('records the names of each environment it could read and leaves out the refused one', async () => {
    const snap = await github.githubConnector.snapshot(ctx(false) as never, [])
    expect(snap.facts).toMatchObject({ actionsNames: ['NEXT_PUBLIC_MUSHI_API_KEY'], actionsNamesComplete: true, environmentNames: { production: ['SENTRY_AUTH_TOKEN', 'APP_ENV'] } })
    const env = github.githubConnector.detectDrift!(null, snap, manifest).filter((f) => f.ruleId === 'env_missing')
    expect(env).toEqual([])
  })

  it('a refused repo list is not checked: no env_missing for every declared name', async () => {
    const snap = await github.githubConnector.snapshot(ctx(true) as never, [])
    expect(snap.facts).toMatchObject({ actionsNames: [], actionsNamesComplete: false })
    const missing = github.githubConnector.detectDrift!(null, snap, { version: 1, env: { required: [{ name: 'NEXT_PUBLIC_MUSHI_API_KEY' }, { name: 'NOT_THERE', in: ['github-environment:production'] }] } }).filter((f) => f.ruleId === 'env_missing')
    expect(missing.map((f) => f.message)).toEqual([expect.stringMatching(/^NOT_THERE .*"production" environment/)])
  })
})
