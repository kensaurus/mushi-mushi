/**
 * One source of truth for "checked" on the recipe (console finding B22): an
 * element can never read OK while it was never checked, and its "Checked …"
 * line comes from the same read its state was judged from.
 *
 *   - Env names: OK came with `lastCheckedAt: null` ("Env names OK … Never
 *     checked"); it now carries the time GitHub was really listed, and a
 *     cache hit keeps that first read time instead of "now".
 *   - Integrations: one integration checked 13 minutes ago and another never
 *     checked read "never health-checked · Checked 13 minutes ago"; the card
 *     time is now the oldest check, null while any was never checked.
 *   - Deploy: a release publish date is not a check.
 *   - summary(): an `ok` with no check time is "Not checked yet".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
})

const NOW = new Date('2026-10-03T12:00:00Z')
const MIN = 60_000
const repo = { ref: { owner: 'kensaurus', repo: 'app' }, token: 't', repoUrl: 'https://github.com/kensaurus/app', defaultBranchHint: 'main' }

function deps(now: Date, names: string[] = ['NEXT_PUBLIC_MUSHI_PROJECT_ID']) {
  return {
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'head1' })),
    fetchWorkflowRun: vi.fn(async () => ({ status: 'completed', conclusion: 'success', updatedAt: '2026-09-20T00:00:00Z', name: 'ci', htmlUrl: 'https://github.com/kensaurus/app/actions/runs/1' })),
    listActionsNames: vi.fn(async () => names),
    requiredEnvNames: () => ['NEXT_PUBLIC_MUSHI_PROJECT_ID'],
    now: () => now,
  }
}

function seed(pid: string, extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeFakeDb({
    projects: [{ id: pid, slug: 'app', organization_id: null }],
    project_settings: [{ project_id: pid, sentry_dsn: 'https://x@sentry.io/1', slack_channel_id: 'C1' }],
    ...extra,
  })
}

describe('env: OK always carries the time GitHub was listed', () => {
  it('a listed, complete env reads ok with a real check time, never "ok + never checked"', async () => {
    const pid = '20000001-0000-4000-8000-000000000001'
    const { response } = await compose.composeRecipe(seed(pid) as never, deps(NOW) as never, pid)
    expect(response.elements.env.state).toBe('ok')
    expect(response.elements.env.lastCheckedAt).toBe(NOW.toISOString())
  })

  it('a cache hit keeps the first read time, not "now"', async () => {
    const pid = '20000001-0000-4000-8000-000000000002'
    await compose.composeRecipe(seed(pid) as never, deps(NOW) as never, pid)
    const later = new Date(NOW.getTime() + 2 * MIN)
    const d = deps(later)
    const { response } = await compose.composeRecipe(seed(pid) as never, d as never, pid)
    expect(d.listActionsNames).not.toHaveBeenCalled()
    expect(response.elements.env.lastCheckedAt).toBe(NOW.toISOString())
    // CI is judged from the same cached read, so it carries that time too, not the run's own date.
    expect(response.elements.ci.lastCheckedAt).toBe(NOW.toISOString())
  })

  it('without a repo, env is not set up and has no check time', async () => {
    const pid = '20000001-0000-4000-8000-000000000003'
    const d = { ...deps(NOW), resolveRepo: vi.fn(async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'no repo' })) }
    const { response } = await compose.composeRecipe(seed(pid) as never, d as never, pid)
    expect(response.elements.env).toMatchObject({ state: 'not_connected', lastCheckedAt: null })
  })
})

describe('integrations: the reason and the check time agree', () => {
  it('one checked, one never checked: "Not checked yet: slack" and no check time', async () => {
    const pid = '20000001-0000-4000-8000-000000000004'
    const db = seed(pid, {
      integration_health_history: [{ project_id: pid, kind: 'sentry', status: 'ok', checked_at: new Date(NOW.getTime() - 13 * MIN).toISOString() }],
    })
    const { response } = await compose.composeRecipe(db as never, deps(NOW) as never, pid)
    const el = response.elements.integrations
    expect(el.state).toBe('unknown')
    expect(el.reason).toMatch(/^Not checked yet: slack\./)
    expect(el.reason).not.toMatch(/never been health-checked/)
    expect(el.lastCheckedAt).toBeNull()
  })

  it('both checked: ok, and the card time is the OLDEST check', async () => {
    const pid = '20000001-0000-4000-8000-000000000005'
    const older = new Date(NOW.getTime() - 50 * MIN).toISOString()
    const db = seed(pid, {
      integration_health_history: [
        { project_id: pid, kind: 'sentry', status: 'ok', checked_at: new Date(NOW.getTime() - 13 * MIN).toISOString() },
        { project_id: pid, kind: 'slack', status: 'ok', checked_at: older },
      ],
    })
    const { response } = await compose.composeRecipe(db as never, deps(NOW) as never, pid)
    expect(response.elements.integrations).toMatchObject({ state: 'ok', lastCheckedAt: older })
  })

  it('integrationsCheckedAt is null for an empty list or any never-checked entry', () => {
    expect(compose.integrationsCheckedAt([])).toBeNull()
    expect(compose.integrationsCheckedAt([{ checkedAt: '2026-10-03T00:00:00Z' }, { checkedAt: null }])).toBeNull()
    expect(compose.integrationsCheckedAt([{ checkedAt: '2026-10-03T00:00:00Z' }, { checkedAt: '2026-10-01T00:00:00Z' }])).toBe('2026-10-01T00:00:00Z')
  })
})

describe('deploy: a release date is not a check', () => {
  it('releases but no declared target: no check time', async () => {
    const pid = '20000001-0000-4000-8000-000000000006'
    const db = seed(pid, { releases: [{ project_id: pid, version: '1.2.0', status: 'published', published_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }] })
    const { response } = await compose.composeRecipe(db as never, deps(NOW) as never, pid)
    expect(response.elements.deploy.state).not.toBe('ok')
    expect(response.elements.deploy.lastCheckedAt).toBeNull()
  })
})

describe('invariant: a reason that says "Not checked" never comes with a check time', () => {
  const ids = (n: number) => `20000002-0000-4000-8000-00000000000${n}`
  const cases: Array<[string, () => { db: unknown; d: unknown; pid: string }]> = [
    ['repo connected, nothing else', () => ({ pid: ids(1), db: seed(ids(1)), d: deps(NOW) })],
    ['env listing refused', () => ({ pid: ids(2), db: seed(ids(2)), d: { ...deps(NOW), listActionsNames: vi.fn(async () => { throw new Error('403') }) } })],
    ['CI read fails', () => ({ pid: ids(3), db: seed(ids(3)), d: { ...deps(NOW), getDefaultHead: vi.fn(async () => { throw new Error('502') }) } })],
    ['no CI run for the head commit', () => ({ pid: ids(4), db: seed(ids(4)), d: { ...deps(NOW), fetchWorkflowRun: vi.fn(async () => null) } })],
    ['recipe file read, no manifest', () => ({
      pid: ids(5),
      db: seed(ids(5), { app_recipe_snapshots: [{ id: 's', project_id: ids(5), is_current: true, captured_at: '2026-10-01T00:00:00Z', manifest: null, tokens: null, validation_errors: [], commit_sha: 'c', tokens_hash: null }] }),
      d: deps(NOW),
    })],
    ['one integration checked, one never', () => ({
      pid: ids(6),
      db: seed(ids(6), { integration_health_history: [{ project_id: ids(6), kind: 'sentry', status: 'ok', checked_at: '2026-10-03T11:47:00Z' }] }),
      d: deps(NOW),
    })],
  ]
  it.each(cases)('%s', async (_name, make) => {
    const { db, d, pid } = make()
    const { response } = await compose.composeRecipe(db as never, d as never, pid)
    for (const el of Object.values(response.elements)) {
      if (/^Not checked/.test(el.reason)) expect({ key: el.key, lastCheckedAt: el.lastCheckedAt }).toEqual({ key: el.key, lastCheckedAt: null })
      // ok always carries the time it was checked.
      if (el.state === 'ok') expect(el.lastCheckedAt).not.toBeNull()
    }
  })

  it('a successful CI read with no run for the head commit is still a check (time set, not a pass)', async () => {
    const pid = ids(7)
    const { response } = await compose.composeRecipe(seed(pid) as never, { ...deps(NOW), fetchWorkflowRun: vi.fn(async () => null) } as never, pid)
    expect(response.elements.ci).toMatchObject({ state: 'unknown', lastCheckedAt: NOW.toISOString() })
  })
})

describe('summary(): never ok without a check', () => {
  it('downgrades ok with no check time to "Not checked yet"', () => {
    const s = compose.summary('gates', { state: 'ok', reason: 'Every automated check passed on its latest run.' }, null, {}, 0, [])
    expect(s).toMatchObject({ state: 'unknown', lastCheckedAt: null })
    expect(s.reason).toMatch(/^Not checked yet/)
  })
  it('keeps ok when there is a check time, and never touches other states', () => {
    expect(compose.summary('gates', { state: 'ok', reason: 'r' }, NOW.toISOString(), {}, 0, []).state).toBe('ok')
    expect(compose.summary('gates', { state: 'drift', reason: 'r' }, null, {}, 1, []).state).toBe('drift')
  })
})
