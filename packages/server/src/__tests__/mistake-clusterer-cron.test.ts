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
import { createFakeDb, eqValue, findQueries } from './__stubs__/fake-query-recorder.ts'
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

describe('coherence judge without a model key', () => {
  it('skips the project instead of failing the judge', () => {
    // projectLlmKey returns null when nothing is configured and when the
    // monthly budget is spent. Either used to throw "No Anthropic key for
    // this project", which the outer catch logged as a judge failure.
    expect(source).toMatch(/reason: skipReason/)
    expect(source).toMatch(/'no_llm_key'/)
    expect(source).toMatch(/'budget_exhausted'/)
    expect(source).toMatch(/coherence judge skipped/)
    expect(source).toMatch(/skippedNoKey\.add\(projectId\)/)
    expect(source).not.toMatch(/No Anthropic key for this project/)
    expect(source).toMatch(/log\.error\('coherence judge failed'/)
  })

  it('keeps the unreachable result check as a type guard', () => {
    expect(source).toMatch(/if \(!result\) continue/)
    expect(source).toMatch(/Type guard only/)
  })
})

describe('coherence judge skip path', () => {
  beforeEach(() => {
    judge.claude.length = 0
    judge.key = null
    vi.spyOn(log, 'info').mockImplementation(() => {})
    vi.spyOn(log, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
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
    // The second cluster of the skipped project is not resolved again.
    expect(calls.filter((c) => c.startsWith(`${NO_KEY}:`))).toEqual([
      `${NO_KEY}:anthropic`,
      `${NO_KEY}:openai`,
    ])
    expect(calls).toContain(`${KEYED}:anthropic`)
    expect(judge.claude).toHaveLength(1)
    const updates = findQueries(queries, 'mistake_clusters', 'update')
    expect(updates.map((q) => eqValue(q, 'id'))).toEqual(['c-keyed'])
    expect(updates[0]?.payload).toMatchObject({ judge_coherence_score: 0.9, name: 'same-bug' })
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
    const updates = findQueries(queries, 'mistake_clusters', 'update')
    expect(updates.map((q) => eqValue(q, 'id'))).toEqual(['c-keyed'])
  })
})
