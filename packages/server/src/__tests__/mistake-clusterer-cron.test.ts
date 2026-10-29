/**
 * mistake-clusterer is scheduled, and its first read works.
 *
 * Until 2026-10-07 no migration scheduled it (cron.job had no row), so 44
 * report embeddings had 0 cluster memberships. Its read also passed a query
 * builder to `.not('report_id', 'in', …)`, which supabase-js stringifies into
 * the filter `not.in.[object Object]`: a scheduled run would have 500'd.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, eqValue, findQueries, hasFilter } from './__stubs__/fake-query-recorder.ts'
import { log } from '../../supabase/functions/_shared/logger.ts'
import { handleMistakeClusterer } from '../../supabase/functions/mistake-clusterer/index.ts'

const judge = vi.hoisted(() => ({
  claude: [] as string[],
  key: null as
    | null
    | ((
        projectId: string,
        provider: string,
        onMiss?: (reason: 'unconfigured' | 'budget_exhausted') => void,
      ) => Promise<{ key: string; source: 'byok'; hint: string } | null>),
}))

vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  requireServiceRoleAuth: () => null,
}))

vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({
  recordLlmUsage: () => Promise.resolve({ error: null }),
}))

vi.mock('../../supabase/functions/_shared/claude-messages.ts', () => ({
  claudeGenerateObject: async (args: { prompt: string }) => {
    judge.claude.push(args.prompt)
    return {
      object: {
        coherence_score: 0.9,
        cluster_name: 'same-bug',
        cluster_summary: 'The same inset bug.',
        suggested_rule: 'Do not pad twice.',
        severity: 'warn',
      },
      usage: { promptTokens: 1, completionTokens: 1 },
    }
  },
}))

vi.mock('../../supabase/functions/_shared/project-llm-key.ts', () => ({
  projectLlmKey: async (
    _db: unknown,
    projectId: string,
    provider: string,
    onMiss?: (reason: 'unconfigured' | 'budget_exhausted') => void,
  ) => {
    if (!judge.key) throw new Error('projectLlmKey stub not set')
    return judge.key(projectId, provider, onMiss)
  },
}))

const NO_KEY = 'project-no-key'
const KEYED = 'project-keyed'
const BUDGET = 'project-budget'

function candidateRows(projects: Array<{ id: string; projectId: string }>) {
  return projects.map((p) => ({
    id: p.id,
    project_id: p.projectId,
    cluster_size: 3,
    severity_distribution: { warn: 3 },
    name: null,
  }))
}

function coherenceDb(rows: Array<Record<string, unknown>>) {
  return createFakeDb((q) => {
    if (q.op === 'rpc') return { data: [] }
    if (q.table === 'mistake_clusters' && q.op === 'select') return { data: rows }
    if (q.table === 'report_cluster_membership') {
      return {
        data: [{
          report_id: 'r1',
          distance: 0.01,
          reports: { title: 'Back', description: 'Inset', category: 'layout', severity: 'warn' },
        }],
      }
    }
    return { data: null }
  })
}

function coherenceRequest() {
  return new Request('https://x.test/functions/v1/mistake-clusterer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runCoherence: true }),
  })
}

type Recorded = ReturnType<typeof createFakeDb>['queries']

/** Updates that stamp updated_at so a skipped project leaves the front of the queue. */
function deferUpdates(queries: Recorded) {
  return findQueries(queries, 'mistake_clusters', 'update').filter((q) => {
    const payload = q.payload as { updated_at?: unknown } | undefined
    return typeof payload?.updated_at === 'string' && hasFilter(q, 'eq', 'project_id')
  })
}

function rowMatches(
  row: Record<string, unknown>,
  filters: Array<{ method: string; args: unknown[] }>,
): boolean {
  for (const f of filters) {
    if (f.method === 'eq' && row[String(f.args[0])] !== f.args[1]) return false
    if (f.method === 'gte' && Number(row[String(f.args[0])]) < Number(f.args[1])) return false
    if (f.method === 'in') {
      const list = f.args[1]
      if (!Array.isArray(list) || !list.includes(row[String(f.args[0])])) return false
    }
  }
  return true
}

/**
 * Applies the candidate select's order and limit, and a skip's updated_at
 * stamp, the way Postgres would. Rows stay in the caller's array.
 */
function queueDb(rows: Array<Record<string, unknown> & { id: string; updated_at: string }>) {
  return createFakeDb((q) => {
    if (q.op === 'rpc') return { data: [] }
    if (q.table === 'mistake_clusters' && q.op === 'select') {
      const selected = rows.filter((r) => rowMatches(r, q.filters)).map((r) => ({ ...r }))
      const order = q.filters.find((f) => f.method === 'order' && f.args[0] === 'updated_at')
      if (order) {
        const ascending = (order.args[1] as { ascending?: boolean } | undefined)?.ascending !== false
        selected.sort((a, b) => {
          const cmp = String(a.updated_at).localeCompare(String(b.updated_at))
          return ascending ? cmp : -cmp
        })
      }
      const limit = q.filters.find((f) => f.method === 'limit')
      const n = typeof limit?.args[0] === 'number' ? limit.args[0] : selected.length
      return { data: selected.slice(0, n) }
    }
    if (q.table === 'mistake_clusters' && q.op === 'update') {
      const stamp = (q.payload as { updated_at?: unknown } | undefined)?.updated_at
      if (typeof stamp === 'string') {
        for (const row of rows) {
          if (rowMatches(row, q.filters)) row.updated_at = stamp
        }
      }
      return { data: null }
    }
    if (q.table === 'report_cluster_membership') {
      return {
        data: [{
          report_id: 'r1',
          distance: 0.01,
          reports: { title: 'Back', description: 'Inset', category: 'layout', severity: 'warn' },
        }],
      }
    }
    return { data: null }
  })
}

const serverRoot = resolve(__dirname, '../..')
const migration = readFileSync(
  join(serverRoot, 'supabase/migrations/20261007142000_mistake_clusterer_cron.sql'),
  'utf-8',
)
const helmCopy = readFileSync(
  resolve(serverRoot, '../../deploy/helm/migrations/20261007142000_mistake_clusterer_cron.sql'),
  'utf-8',
)
const source = readFileSync(join(serverRoot, 'supabase/functions/mistake-clusterer/index.ts'), 'utf-8')

describe('mistake-clusterer schedule', () => {
  it('runs hourly through cron_http_post, so the 6-hourly coherence window fires once', () => {
    expect(migration).toMatch(
      /cron\.schedule\(\s*'mushi-mistake-clusterer-hourly',\s*'43 \* \* \* \*',\s*\$cmd\$select mushi\.cron_http_post\('mistake-clusterer', jsonb_build_object\('trigger', 'cron'\), 60000\);\$cmd\$/,
    )
    // The judge runs when the UTC hour is a multiple of 6; an hourly cron hits that once.
    expect(source).toMatch(/return h % 6 === 0/)
  })

  it('skips the schedule when pg_cron is absent', () => {
    expect(migration).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_namespace WHERE nspname = 'cron'\)/)
  })

  it('ships an identical Helm copy', () => {
    expect(helmCopy).toBe(migration)
  })
})

describe('mistake_clusterer_unclustered()', () => {
  it('reads embeddings with no membership row, one per report, oldest first, capped', () => {
    expect(migration).toMatch(/create or replace function public\.mistake_clusterer_unclustered\(p_limit integer default 200\)/)
    expect(migration).toMatch(/where not exists \(\s*select 1\s*from public\.report_cluster_membership m\s*where m\.report_id = re\.report_id\s*\)/)
    expect(migration).toMatch(/select distinct on \(re\.report_id\)/)
    expect(migration).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 200\), 1000\)\)/)
  })

  it('is callable by service_role only', () => {
    expect(migration).toMatch(/security invoker/)
    expect(migration).toMatch(
      /revoke all on function public\.mistake_clusterer_unclustered\(integer\) from public, anon, authenticated;/,
    )
    expect(migration).toMatch(/grant execute on function public\.mistake_clusterer_unclustered\(integer\) to service_role;/)
  })

  it('is what the function reads, instead of a query builder inside .not()', () => {
    expect(source).toMatch(/\.rpc\('mistake_clusterer_unclustered', \{ p_limit: MAX_REPORTS_PER_RUN \}\)/)
    expect(source).not.toMatch(/\.not\(\s*'report_id',\s*'in',\s*\n?\s*db\.from/)
  })
})

describe('coherence judge skip path', () => {
  beforeEach(() => {
    judge.claude.length = 0
    judge.key = null
    vi.spyOn(log, 'info').mockImplementation(() => {})
    vi.spyOn(log, 'warn').mockImplementation(() => {})
    vi.spyOn(log, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('skips a project with no key for either provider and still judges the rest', async () => {
    const calls: string[] = []
    judge.key = async (projectId, provider, onMiss) => {
      calls.push(`${projectId}:${provider}`)
      if (projectId === NO_KEY) {
        onMiss?.('unconfigured')
        return null
      }
      if (provider === 'anthropic') return { key: 'sk-ant-test', source: 'byok', hint: 'test' }
      onMiss?.('unconfigured')
      return null
    }

    const { db, queries } = coherenceDb(candidateRows([
      { id: 'c-no-1', projectId: NO_KEY },
      { id: 'c-no-2', projectId: NO_KEY },
      { id: 'c-keyed', projectId: KEYED },
    ]))
    const res = await handleMistakeClusterer(coherenceRequest(), db)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, promoted: 1, coherenceRan: true })
    expect(vi.mocked(log.error).mock.calls).toEqual([])
    expect(vi.mocked(log.info).mock.calls).toEqual([
      ['coherence judge skipped', { scope: 'mistake-clusterer', projectId: NO_KEY, reason: 'no_llm_key' }],
    ])
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['coherence judge skipped projects', { scope: 'mistake-clusterer', skippedProjects: 1 }],
    ])
    const candidateSelect = findQueries(queries, 'mistake_clusters', 'select')
      .find((q) => hasFilter(q, 'gte', 'cluster_size'))
    expect(candidateSelect?.filters).toEqual(expect.arrayContaining([
      { method: 'order', args: ['updated_at', { ascending: true }] },
      { method: 'limit', args: [20] },
    ]))
    // Every judgeable candidate of the skipped project, not just this row.
    expect(deferUpdates(queries).map((q) => eqValue(q, 'project_id'))).toEqual([NO_KEY])
    expect(deferUpdates(queries)[0]?.filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'candidate'] },
      { method: 'gte', args: ['cluster_size', 3] },
    ]))
    // The second cluster of the skipped project is not resolved again.
    expect(calls.filter((c) => c.startsWith(`${NO_KEY}:`))).toEqual([
      `${NO_KEY}:anthropic`,
      `${NO_KEY}:openai`,
    ])
    expect(calls).toContain(`${KEYED}:anthropic`)
    expect(judge.claude).toHaveLength(1)
    const updates = findQueries(queries, 'mistake_clusters', 'update')
    const judged = updates.filter((q) => hasFilter(q, 'eq', 'id'))
    expect(judged.map((q) => eqValue(q, 'id'))).toEqual(['c-keyed'])
    expect(judged[0]?.payload).toMatchObject({ judge_coherence_score: 0.9, name: 'same-bug' })
  })

  it('logs budget_exhausted for a spent monthly budget and still judges the rest', async () => {
    judge.key = async (projectId, provider, onMiss) => {
      if (projectId === BUDGET) {
        // Anthropic reports the spent budget; OpenAI then reports nothing
        // configured. The spent budget is the reason that is logged.
        onMiss?.(provider === 'anthropic' ? 'budget_exhausted' : 'unconfigured')
        return null
      }
      return { key: 'sk-ant-test', source: 'byok', hint: 'test' }
    }

    const { db, queries } = coherenceDb(candidateRows([
      { id: 'c-budget', projectId: BUDGET },
      { id: 'c-keyed', projectId: KEYED },
    ]))
    const res = await handleMistakeClusterer(coherenceRequest(), db)

    expect(res.status).toBe(200)
    expect(vi.mocked(log.error).mock.calls).toEqual([])
    expect(vi.mocked(log.info).mock.calls).toEqual([
      ['coherence judge skipped', { scope: 'mistake-clusterer', projectId: BUDGET, reason: 'budget_exhausted' }],
    ])
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['coherence judge skipped projects', { scope: 'mistake-clusterer', skippedProjects: 1 }],
    ])
    expect(deferUpdates(queries).map((q) => eqValue(q, 'project_id'))).toEqual([BUDGET])
    const updates = findQueries(queries, 'mistake_clusters', 'update')
    expect(updates.filter((q) => hasFilter(q, 'eq', 'id')).map((q) => eqValue(q, 'id'))).toEqual(['c-keyed'])
  })

  it('warns once per run with the number of skipped projects', async () => {
    const other = 'project-no-key-2'
    judge.key = async (projectId, provider, onMiss) => {
      if (projectId === NO_KEY || projectId === other) {
        onMiss?.('unconfigured')
        return null
      }
      if (provider === 'anthropic') return { key: 'sk-ant-test', source: 'byok', hint: 'test' }
      onMiss?.('unconfigured')
      return null
    }

    const { db, queries } = coherenceDb(candidateRows([
      { id: 'c-no-1', projectId: NO_KEY },
      { id: 'c-no-2', projectId: NO_KEY },
      { id: 'c-other', projectId: other },
      { id: 'c-keyed', projectId: KEYED },
    ]))
    const res = await handleMistakeClusterer(coherenceRequest(), db)

    expect(res.status).toBe(200)
    expect(vi.mocked(log.error).mock.calls).toEqual([])
    expect(vi.mocked(log.info).mock.calls).toEqual([
      ['coherence judge skipped', { scope: 'mistake-clusterer', projectId: NO_KEY, reason: 'no_llm_key' }],
      ['coherence judge skipped', { scope: 'mistake-clusterer', projectId: other, reason: 'no_llm_key' }],
    ])
    // One summary, not one warning per cluster or per project.
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['coherence judge skipped projects', { scope: 'mistake-clusterer', skippedProjects: 2 }],
    ])
    expect(deferUpdates(queries).map((q) => eqValue(q, 'project_id'))).toEqual([NO_KEY, other])
  })

  it('does not warn when every candidate has a key', async () => {
    judge.key = async () => ({ key: 'sk-ant-test', source: 'byok', hint: 'test' })
    const { db, queries } = coherenceDb(candidateRows([{ id: 'c-keyed', projectId: KEYED }]))
    const res = await handleMistakeClusterer(coherenceRequest(), db)

    expect(res.status).toBe(200)
    expect(vi.mocked(log.warn).mock.calls).toEqual([])
    expect(vi.mocked(log.info).mock.calls).toEqual([])
    expect(deferUpdates(queries)).toEqual([])
  })

  it('judges a keyed project on the next run when keyless candidates fill this page', async () => {
    // Forty keyless clusters are older than the keyed one. A page of 20
    // that only stamps the rows it saw still leaves 20 keyless clusters
    // in front, so the keyed project never reaches the limit.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    const keyless = Array.from({ length: 40 }, (_, i) => ({
      id: `c-no-${i}`,
      project_id: NO_KEY,
      status: 'candidate',
      cluster_size: 3,
      severity_distribution: { warn: 3 },
      name: null,
      updated_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }))
    const rows = [
      ...keyless,
      {
        id: 'c-keyed',
        project_id: KEYED,
        status: 'candidate',
        cluster_size: 3,
        severity_distribution: { warn: 3 },
        name: null,
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ]
    judge.key = async (projectId, provider, onMiss) => {
      if (projectId === NO_KEY) {
        onMiss?.('unconfigured')
        return null
      }
      if (provider === 'anthropic') return { key: 'sk-ant-test', source: 'byok', hint: 'test' }
      onMiss?.('unconfigured')
      return null
    }

    const { db, queries } = queueDb(rows)
    const first = await handleMistakeClusterer(coherenceRequest(), db)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, promoted: 0, coherenceRan: true })
    expect(judge.claude).toHaveLength(0)
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['coherence judge skipped projects', { scope: 'mistake-clusterer', skippedProjects: 1 }],
    ])
    // The whole keyless project moved behind the keyed cluster.
    expect(rows.filter((r) => r.project_id === NO_KEY).every((r) => r.updated_at === '2026-06-01T00:00:00.000Z')).toBe(true)
    expect(rows.find((r) => r.id === 'c-keyed')?.updated_at).toBe('2026-01-02T00:00:00.000Z')

    const second = await handleMistakeClusterer(coherenceRequest(), db)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true, promoted: 1, coherenceRan: true })
    expect(judge.claude).toHaveLength(1)
    expect(vi.mocked(log.error).mock.calls).toEqual([])
    const judged = findQueries(queries, 'mistake_clusters', 'update').filter((q) => hasFilter(q, 'eq', 'id'))
    expect(judged.map((q) => eqValue(q, 'id'))).toEqual(['c-keyed'])
  })
})
