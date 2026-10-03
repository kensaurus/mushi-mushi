/**
 * FILE: packages/server/src/__tests__/recipe-phase2-run-head.test.ts
 * PURPOSE: What report-deploy-live needs from each recipe-collector gate run
 *          (completeness gap #10 review):
 *          - `summary.head_repo`: the repo the `commit_sha` head was read from,
 *            so a head from one repo is never used to judge a fix merged into
 *            another;
 *          - `completed_at` stamped after the connectors read the head, so
 *            "completed before the merge" really means the head was read
 *            before it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/recipe-github.ts', () => ({
  resolveRecipeRepo: vi.fn(async () => ({
    ok: true,
    repo: { ref: { owner: 'acme', repo: 'app' }, token: 'gh-token', repoUrl: 'https://github.com/acme/app', defaultBranchHint: 'main' },
  })),
}))

let phase2: typeof import('../../supabase/functions/_shared/recipe-phase2.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  phase2 = await import('../../supabase/functions/_shared/recipe-phase2.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const START = Date.parse('2026-10-03T03:35:00Z')

const manifest = {
  version: 1,
  deploy: { targets: [{ id: 'web-prod', kind: 'cloudfront-s3', environment: 'production', probe: { type: 'version_json', url: 'https://app.example/version.json' }, maxLagHours: 24 }] },
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** GitHub as the connector reads it: repo, default-branch head, no workflows, no secrets. */
async function github(url: string): Promise<Response> {
  const path = new URL(url).pathname
  if (path === '/repos/acme/app') return json(200, { default_branch: 'main', permissions: { push: false } })
  if (path === '/repos/acme/app/commits/main') return json(200, { sha: HEAD, commit: { committer: { date: '2026-10-03T01:00:00Z' } } })
  if (path === '/repos/acme/app/actions/runs') return json(200, { workflow_runs: [] })
  if (path === '/repos/acme/app/actions/secrets') return json(200, { secrets: [] })
  if (path === '/repos/acme/app/actions/variables') return json(200, { variables: [] })
  return json(404, {})
}

describe('collectProjectPhase2 gate runs', () => {
  it('record the head repo beside the head commit, and complete after the head was read', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'app', slug: 'app', owner_id: 'owner', organization_id: ORG }],
      app_recipe_snapshots: [{ id: 's1', project_id: P1, is_current: true, manifest }],
    } as never, { autoId: true })
    // Each read of the clock is one second later than the last.
    let tick = 0
    const now = () => new Date(START + 1000 * tick++)

    await phase2.collectProjectPhase2(db as never, P1, {
      fetch: vi.fn(async (input: string | URL | Request) => github(String(input instanceof Request ? input.url : input))),
      now,
      probe: vi.fn(async () => ({ status: 200, text: JSON.stringify({ version: '1.0.0', commit: HEAD }) })),
    })

    const runs = db.table('gate_runs')
    const deploy = runs.find((r) => r.gate === 'deploy_drift')
    expect(deploy).toMatchObject({ commit_sha: HEAD, started_at: new Date(START).toISOString() })
    expect((deploy?.summary as { head_repo?: unknown } | undefined)?.head_repo).toBe('acme/app')
    expect(Date.parse(String(deploy?.completed_at))).toBeGreaterThan(Date.parse(String(deploy?.started_at)))
    // Every run the collector wrote carries the same head and its repo.
    for (const r of runs) {
      expect(r.commit_sha).toBe(HEAD)
      expect((r.summary as { head_repo?: unknown }).head_repo).toBe('acme/app')
    }
  })

  it('record no head repo when GitHub gave no head', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'app', slug: 'app', owner_id: 'owner', organization_id: ORG }],
      app_recipe_snapshots: [{ id: 's1', project_id: P1, is_current: true, manifest }],
    } as never, { autoId: true })
    await phase2.collectProjectPhase2(db as never, P1, {
      fetch: vi.fn(async () => json(500, {})),
      now: () => new Date(START),
      probe: vi.fn(async () => ({ status: 200, text: JSON.stringify({ version: '1.0.0', commit: HEAD }) })),
    })
    const deploy = db.table('gate_runs').find((r) => r.gate === 'deploy_drift')
    expect(deploy).toMatchObject({ commit_sha: null })
    expect((deploy?.summary as { head_repo?: unknown }).head_repo).toBeNull()
  })
})
