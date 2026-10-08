/**
 * FILE: skills-catalog-routes.test.ts
 * PURPOSE: /skills console QA group C, against the real skills route module.
 *
 *   #23   The same slug from two sources (two projects added kensaurus/skills)
 *         made every `.maybeSingle()` slug lookup fail: detail 404, pipeline
 *         start "not found, run skill sync", catalog listed each skill twice.
 *         The fake DB runs with `strictSingle`, so a regression to
 *         `.maybeSingle()` fails here the way PostgREST does.
 *   #24   Cancel only flipped the run row; a Cursor Cloud agent kept running.
 *         Cancel now stops each step's agent and says which it could not stop.
 *   #105  A check-in on a cancelled run must not reopen it.
 *   #245  A failed sync lost skill-sync's reason ("Sync didn't start").
 *   #246  A skill source could not be removed.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import {
  dedupeSkillsBySlug,
  pickSkillRow,
  withRankColumns,
} from '../../supabase/functions/_shared/skill-catalog.ts'
import { unwrapUpstreamError } from '../../supabase/functions/_shared/upstream-error.ts'

const P = '1000000c-0000-4000-8000-000000000000'
const OTHER = '1000000c-0000-4000-8000-0000000000ff'
const USER = '2000000c-0000-4000-8000-000000000000'
const SRC_MINE = '3000000c-0000-4000-8000-000000000001'
const SRC_OTHER = '3000000c-0000-4000-8000-000000000002'
const RUN = '4000000c-0000-4000-8000-000000000001'

let db: FakeDb
const stopAgent = vi.fn(async (..._args: unknown[]): Promise<string> => 'stopped')

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/api/middleware/auth.ts', () => ({
  requireAuthOrApiKey: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  },
}))
vi.mock('../../supabase/functions/api/middleware/project.ts', () => ({
  checkProjectAccessIfNamed: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/project-access.ts', () => ({
  accessibleProjectIds: async () => [P],
}))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({
  claimTenantRateLimit: async () => ({ allowed: true }),
  logTenantContext: () => {},
  tenantContextFromHono: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/rag.ts', () => ({ getRelevantCode: async () => [] }))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEvent: async () => {} }))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  stopCursorAgentLatestRun: (...args: unknown[]) => stopAgent(...args),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  assertCallerProjectScope: () => null,
  assertTargetProjectAccess: async (_c: unknown, _db: unknown, _u: string, projectId: string) =>
    projectId === P
      ? { ok: true }
      : { ok: false, response: new Response(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN' } }), { status: 403 }) },
}))

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => 'http://fake' } }
  const { registerSkillsRoutes } = await import('../../supabase/functions/api/routes/skills.ts')
  app = new Hono()
  registerSkillsRoutes(app as never)
})

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }))
beforeEach(() => {
  stopAgent.mockReset()
  stopAgent.mockResolvedValue('stopped')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function skill(source: string, slug: string, updated: string, extra: Row = {}): Row {
  return {
    id: `${source}-${slug}`,
    source_id: source,
    slug,
    category: 'workflow',
    title: `${slug} (${source === SRC_MINE ? 'mine' : 'theirs'})`,
    description: 'd',
    body_md: `# ${slug}`,
    chain_slugs: [],
    is_active: true,
    updated_at: updated,
    ...extra,
  }
}

function seed(tables: Record<string, Row[]> = {}) {
  db = makeFakeDb(
    {
      skill_sources: [
        { id: SRC_MINE, project_id: P, repo_slug: 'kensaurus/skills', enabled: true },
        { id: SRC_OTHER, project_id: OTHER, repo_slug: 'kensaurus/skills', enabled: true },
      ],
      agent_skills: [
        skill(SRC_OTHER, 'workflow-fix-and-ship', '2026-10-03T00:00:00Z'),
        skill(SRC_MINE, 'workflow-fix-and-ship', '2026-10-01T00:00:00Z'),
        skill(SRC_OTHER, 'debug-error', '2026-10-03T00:00:00Z'),
        skill(SRC_MINE, 'debug-error', '2026-10-02T00:00:00Z'),
      ],
      skill_pipeline_runs: [],
      skill_pipeline_step_runs: [],
      reports: [],
      ...tables,
    },
    { strictSingle: true, autoId: true },
  )
}

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-mushi-project-id': P },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('skill-catalog rule', () => {
  it('keeps one row per slug, preferring the caller project source, then the newest', () => {
    const rows = [
      { slug: 'a', source_id: 'x', updated_at: '2026-10-03', id: '1' },
      { slug: 'a', source_id: 'mine', updated_at: '2026-10-01', id: '2' },
      { slug: 'b', source_id: 'x', updated_at: '2026-10-01', id: '3' },
      { slug: 'b', source_id: 'y', updated_at: '2026-10-05', id: '4' },
    ]
    expect(dedupeSkillsBySlug(rows, ['mine']).map((r) => r.id)).toEqual(['2', '4'])
    expect(pickSkillRow(rows.slice(0, 2))?.id).toBe('1')
    expect(pickSkillRow([])).toBeNull()
  })

  it('adds the columns the rule needs without duplicating them', () => {
    expect(withRankColumns('slug, title')).toBe('slug, title, source_id, updated_at, id')
    expect(withRankColumns('*')).toBe('*')
  })
})

describe('unwrapUpstreamError', () => {
  const fb = { code: 'FALLBACK', message: 'fallback' }
  it('reads a string error, a nested error object and a bare body', () => {
    expect(unwrapUpstreamError({ ok: false, error: 'Run not found or already taken' }, fb)).toEqual({
      code: 'FALLBACK',
      message: 'Run not found or already taken',
    })
    expect(unwrapUpstreamError({ ok: false, error: { code: 'NO_KEY', message: 'Add an Anthropic key' } }, fb)).toEqual({
      code: 'NO_KEY',
      message: 'Add an Anthropic key',
    })
    expect(unwrapUpstreamError({ error: { code: 'X' } }, fb)).toEqual({ code: 'X', message: 'fallback' })
    expect(unwrapUpstreamError(null, fb)).toEqual(fb)
  })
})

describe('#23 duplicate slugs across sources', () => {
  beforeEach(() => seed())

  it('lists each skill once and counts it once', async () => {
    const list = await call('GET', '/v1/admin/skills?limit=200')
    expect(list.status).toBe(200)
    expect(list.json.data.map((s: Row) => s.slug).sort()).toEqual(['debug-error', 'workflow-fix-and-ship'])
    expect(list.json.total).toBe(2)
    // The caller's own source wins over a newer copy from another project.
    expect(list.json.data.every((s: Row) => s.source_id === SRC_MINE)).toBe(true)

    const stats = await call('GET', `/v1/admin/skills/stats?project_id=${P}`)
    expect(stats.json.data.catalogTotal).toBe(2)
  })

  it('reports the oldest step waiting for check-in', async () => {
    seed({
      skill_pipeline_runs: [{ id: RUN, project_id: P, mode: 'handoff', status: 'running', root_skill_slug: 'debug-error' }],
      skill_pipeline_step_runs: [
        { id: 's2', run_id: RUN, step_index: 1, status: 'pending', created_at: '2026-10-05T00:00:00Z' },
        { id: 's1', run_id: RUN, step_index: 0, status: 'pending', created_at: '2026-10-01T00:00:00Z' },
        { id: 's0', run_id: RUN, step_index: 2, status: 'passed', created_at: '2026-09-01T00:00:00Z' },
      ],
    })
    const stats = await call('GET', `/v1/admin/skills/stats?project_id=${P}`)
    expect(stats.json.data.awaitingCheckin).toBe(2)
    expect(stats.json.data.oldestAwaitingCheckinAt).toBe('2026-10-01T00:00:00Z')
  })

  it('opens the skill detail instead of a 404', async () => {
    const res = await call('GET', '/v1/admin/skills/workflow-fix-and-ship')
    expect(res.status).toBe(200)
    expect(res.json.data.source_id).toBe(SRC_MINE)
  })

  it('starts a pipeline instead of "not found, run skill sync"', async () => {
    const res = await call('POST', '/v1/admin/skills/pipelines', {
      project_id: P,
      root_skill_slug: 'workflow-fix-and-ship',
      mode: 'handoff',
    })
    expect(res.status).toBe(201)
    expect(res.json.data.root_skill_slug).toBe('workflow-fix-and-ship')
  })
})

describe('#23 catalog reads past the PostgREST row ceiling', () => {
  it('lists and counts every skill when one request returns only a few rows', async () => {
    const many = Array.from({ length: 7 }, (_, i) => [
      skill(SRC_MINE, `skill-${i}`, '2026-10-01T00:00:00Z', { id: `m${i}` }),
      skill(SRC_OTHER, `skill-${i}`, '2026-10-02T00:00:00Z', { id: `o${i}` }),
    ]).flat()
    db = makeFakeDb(
      {
        skill_sources: [
          { id: SRC_MINE, project_id: P, repo_slug: 'kensaurus/skills', enabled: true },
          { id: SRC_OTHER, project_id: OTHER, repo_slug: 'kensaurus/skills', enabled: true },
        ],
        agent_skills: many,
        skill_pipeline_runs: [],
      },
      // Stand-in for Supabase's 1,000-row max_rows.
      { maxRows: 3 },
    )
    const list = await call('GET', '/v1/admin/skills?limit=200')
    expect(list.json.total).toBe(7)
    expect(list.json.data).toHaveLength(7)
    const stats = await call('GET', `/v1/admin/skills/stats?project_id=${P}`)
    expect(stats.json.data.catalogTotal).toBe(7)
  })
})

describe('#24 cancel stops the cloud agent', () => {
  function seedRun(mode: 'cloud' | 'handoff') {
    seed({
      skill_pipeline_runs: [{ id: RUN, project_id: P, mode, status: 'running', root_skill_slug: 'debug-error' }],
      skill_pipeline_step_runs: [
        { id: 's0', run_id: RUN, step_index: 0, status: 'passed', agent_ref: 'bc-done' },
        { id: 's1', run_id: RUN, step_index: 1, status: 'running', agent_ref: 'bc-live' },
        { id: 's2', run_id: RUN, step_index: 2, status: 'pending', agent_ref: null },
      ],
    })
  }

  it('cancels the running Cursor agent and closes the open steps', async () => {
    seedRun('cloud')
    const res = await call('DELETE', `/v1/admin/skills/pipelines/${RUN}`)
    expect(res.status).toBe(200)
    expect(stopAgent).toHaveBeenCalledTimes(1)
    expect(stopAgent.mock.calls[0]?.[1]).toBe(P)
    expect(stopAgent.mock.calls[0]?.[2]).toBe('bc-live')
    expect(res.json.data).toMatchObject({ stopped: 1, stillRunning: 0 })
    expect(db.tables.skill_pipeline_runs[0]?.status).toBe('aborted')
    const statuses = db.tables.skill_pipeline_step_runs.map((s) => s.status)
    expect(statuses).toEqual(['passed', 'skipped', 'skipped'])
  })

  it('says when an agent could not be stopped', async () => {
    seedRun('cloud')
    stopAgent.mockResolvedValue('failed')
    const res = await call('DELETE', `/v1/admin/skills/pipelines/${RUN}`)
    expect(res.json.data).toMatchObject({ stopped: 0, stillRunning: 1 })
    expect(res.json.data.agents[0]).toMatchObject({ stepIndex: 1, outcome: 'failed' })
  })

  it('never calls the agent API for a handoff run', async () => {
    seedRun('handoff')
    const res = await call('DELETE', `/v1/admin/skills/pipelines/${RUN}`)
    expect(res.status).toBe(200)
    expect(stopAgent).not.toHaveBeenCalled()
  })

  it('answers 409 for a run that already finished', async () => {
    seed({ skill_pipeline_runs: [{ id: RUN, project_id: P, mode: 'cloud', status: 'completed' }] })
    const res = await call('DELETE', `/v1/admin/skills/pipelines/${RUN}`)
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('RUN_CLOSED')
  })

  it('#105 refuses a check-in on a cancelled run', async () => {
    seed({
      skill_pipeline_runs: [{ id: RUN, project_id: P, mode: 'cloud', status: 'aborted' }],
      skill_pipeline_step_runs: [{ id: 's1', run_id: RUN, step_index: 1, status: 'skipped' }],
    })
    const res = await call('POST', `/v1/admin/skills/pipelines/${RUN}/steps/1/checkin`, { status: 'passed' })
    expect(res.status).toBe(409)
    expect(db.tables.skill_pipeline_step_runs[0]?.status).toBe('skipped')
  })

  it('#105 checks in a step of an open handoff run', async () => {
    seed({
      skill_pipeline_runs: [{ id: RUN, project_id: P, mode: 'handoff', status: 'running' }],
      skill_pipeline_step_runs: [{ id: 's0', run_id: RUN, step_index: 0, status: 'pending' }],
    })
    const res = await call('POST', `/v1/admin/skills/pipelines/${RUN}/steps/0/checkin`, { status: 'passed' })
    expect(res.status).toBe(200)
    expect(db.tables.skill_pipeline_runs[0]?.status).toBe('completed')
  })
})

describe('#245 sync failures keep their reason', () => {
  it('passes skill-sync’s own message through', async () => {
    seed()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'GitHub returned 404 for kensaurus/skils' }), { status: 502 }),
    )
    const res = await call('POST', `/v1/admin/skills/sources/${SRC_MINE}/sync`, { force: false })
    expect(res.status).toBe(502)
    expect(res.json.error.message).toBe('GitHub returned 404 for kensaurus/skils')
  })
})

describe('#246 remove a skill source', () => {
  beforeEach(() => seed())

  it('removes the source and takes its skills out of the catalog', async () => {
    const res = await call('DELETE', `/v1/admin/skills/sources/${SRC_MINE}`)
    expect(res.status).toBe(200)
    expect(db.tables.skill_sources.map((s) => s.id)).toEqual([SRC_OTHER])
    const mine = db.tables.agent_skills.filter((s) => s.source_id === SRC_MINE)
    expect(mine.every((s) => s.is_active === false)).toBe(true)
    const theirs = db.tables.agent_skills.filter((s) => s.source_id === SRC_OTHER)
    expect(theirs.every((s) => s.is_active === true)).toBe(true)
  })

  it('refuses another project’s source', async () => {
    const res = await call('DELETE', `/v1/admin/skills/sources/${SRC_OTHER}`)
    expect(res.status).toBe(403)
    expect(db.tables.skill_sources).toHaveLength(2)
  })
})
