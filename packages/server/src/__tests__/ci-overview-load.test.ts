/**
 * FILE: ci-overview-load.test.ts
 * PURPOSE: GET /v1/admin/ci/overview's ci_jobs read stays an index range
 *          per project. One `project_id IN (...) ORDER BY gh_created_at`
 *          sorted the whole window, detoasted `steps`, and Postgres cancelled
 *          it (57014: ci_jobs read failed: canceling statement due to statement
 *          timeout). The newest 1,000 finished jobs across projects are kept,
 *          and `steps` is loaded only for those rows.
 */

import { describe, expect, it } from 'vitest'
import { loadCiOverviewRows } from '../../supabase/functions/_shared/ci-overview.ts'

const P1 = '1000000a-0000-4000-8000-000000000001'
const P2 = '1000000b-0000-4000-8000-000000000002'
const NOW = Date.parse('2026-10-21T09:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const FROM = new Date(NOW - 7 * DAY)

type Row = Record<string, unknown>

interface Call {
  table: string
  select: string
  ops: string[]
}

/**
 * Records each PostgREST call. A ci_jobs read that filters `project_id` with
 * IN, or that orders by time while selecting `steps`, answers with the
 * statement timeout the overview was hitting.
 */
function fakeDb(tables: Record<string, Row[]>, opts?: { timeoutProject?: string }) {
  const calls: Call[] = []
  const from = (table: string) => {
    const ops: string[] = []
    let select = '*'
    let projectEq: string | null = null
    const filters: Array<(row: Row) => boolean> = []
    const order: Array<{ key: string; asc: boolean }> = []
    let limit: number | null = null
    const query = {
      select(cols: string) {
        select = cols
        return query
      },
      eq(key: string, value: unknown) {
        ops.push(`eq:${key}=${String(value)}`)
        if (key === 'project_id') projectEq = String(value)
        filters.push((row) => row[key] === value)
        return query
      },
      neq(key: string, value: unknown) {
        ops.push(`neq:${key}=${String(value)}`)
        filters.push((row) => row[key] !== value)
        return query
      },
      in(key: string, values: unknown[]) {
        ops.push(`in:${key}:${values.length}`)
        filters.push((row) => values.includes(row[key]))
        return query
      },
      gte(key: string, value: unknown) {
        ops.push(`gte:${key}`)
        filters.push((row) => String(row[key]) >= String(value))
        return query
      },
      order(key: string, o?: { ascending?: boolean }) {
        ops.push(`order:${key}`)
        order.push({ key, asc: o?.ascending !== false })
        return query
      },
      limit(n: number) {
        limit = n
        return query
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (err: unknown) => unknown) {
        calls.push({ table, select, ops: [...ops] })
        const timedOut =
          table === 'ci_jobs' &&
          (ops.some((op) => op.startsWith('in:project_id')) ||
            (select.includes('steps') && ops.includes('order:gh_created_at')) ||
            (opts?.timeoutProject != null && projectEq === opts.timeoutProject))
        const run = () => {
          if (timedOut) return { data: null, error: { message: 'canceling statement due to statement timeout' } }
          let rows = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)))
          if (order.length > 0) {
            rows = [...rows].sort((a, b) => {
              for (const { key, asc } of order) {
                const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
                if (cmp !== 0) return asc ? cmp : -cmp
              }
              return 0
            })
          }
          if (limit != null) rows = rows.slice(0, limit)
          const cols = select.split(',').map((col) => col.trim())
          return {
            data: rows.map((row) => {
              const picked: Row = {}
              for (const col of cols) picked[col] = row[col] ?? null
              return picked
            }),
            error: null,
          }
        }
        return Promise.resolve(run()).then(onFulfilled, onRejected)
      },
    }
    return query
  }
  return { from, calls }
}

function job(over: Row): Row {
  return {
    id: 'job',
    project_id: P1,
    repo: 'kensaurus/glot.it',
    run_id: 1,
    run_attempt: 1,
    job_id: 1,
    workflow_name: 'CI',
    job_name: 'test',
    head_branch: 'master',
    pr_number: null,
    status: 'completed',
    conclusion: 'success',
    ci_kind: 'passed',
    infra: false,
    infra_detail: null,
    runner_name: null,
    runner_kind: 'github_hosted',
    runner_group_name: 'GitHub Actions',
    runner_labels: [],
    queue_seconds: 1,
    duration_seconds: 2,
    gh_created_at: at(0),
    started_at: null,
    completed_at: null,
    html_url: null,
    steps: [{ name: 'run', conclusion: 'success', seconds: 2 }],
    ...over,
  }
}

describe('loadCiOverviewRows ci_jobs', () => {
  it('reads each project with an equality filter and keeps the newest 1,000 finished jobs, with steps loaded afterwards', async () => {
    const p2Steps = [{ name: 'only-on-second-read', conclusion: 'success', seconds: 9 }]
    const queuedSteps = [{ name: 'queue-step', conclusion: null, seconds: null }]
    const ciJobs = [
      ...Array.from({ length: 1001 }, (_, i) => job({ id: `p1-${i}`, job_id: i, gh_created_at: at(i * 1000) })),
      job({ id: 'p2-mid', project_id: P2, repo: 'kensaurus/yen-yen', job_id: 7, gh_created_at: at(500), steps: p2Steps }),
      job({ id: 'p1-old', job_id: 8, gh_created_at: at(8 * DAY), steps: [{ name: 'stale', conclusion: 'success', seconds: 1 }] }),
      job({ id: 'p1-queued', job_id: 9, status: 'queued', conclusion: null, ci_kind: 'queued', gh_created_at: at(30_000), steps: queuedSteps }),
    ]
    const db = fakeDb({
      projects: [
        { id: P1, name: 'glot', organization_id: null },
        { id: P2, name: 'yen', organization_id: null },
      ],
      ci_jobs: ciJobs,
    })

    const rows = await loadCiOverviewRows(db as never, [P1, P2], FROM)

    const ordered = db.calls.filter((call) => call.table === 'ci_jobs' && call.ops.includes('order:gh_created_at'))
    expect(ordered).toHaveLength(4)
    for (const call of ordered) {
      expect(call.select).not.toContain('steps')
      expect(call.ops.some((op) => op.startsWith('in:project_id'))).toBe(false)
      expect(call.ops.some((op) => op.startsWith('eq:project_id='))).toBe(true)
    }
    expect(ordered.some((call) => call.ops.includes(`eq:project_id=${P1}`) && call.ops.includes('neq:status=completed'))).toBe(true)
    expect(ordered.some((call) => call.ops.includes(`eq:project_id=${P1}`) && call.ops.includes('eq:status=completed'))).toBe(true)
    expect(ordered.some((call) => call.ops.includes(`eq:project_id=${P2}`))).toBe(true)
    expect(db.calls.some((call) => call.table === 'ci_jobs' && call.select === 'id, steps')).toBe(true)

    expect(rows.finished).toHaveLength(1000)
    expect(rows.finished[0]?.id).toBe('p1-0')
    expect(rows.finished.map((row) => row.id)).toContain('p2-mid')
    expect(rows.finished.map((row) => row.id)).not.toContain('p1-999')
    expect(rows.finished.map((row) => row.id)).not.toContain('p1-1000')
    expect(rows.finished.map((row) => row.id)).not.toContain('p1-old')
    expect(rows.finished.find((row) => row.id === 'p2-mid')?.steps).toEqual(p2Steps)
    expect(rows.unfinished.map((row) => row.id)).toEqual(['p1-queued'])
    expect(rows.unfinished[0]?.steps).toEqual(queuedSteps)
  })

  it('queries a repeated project id once, so its jobs are not counted twice', async () => {
    const db = fakeDb({
      projects: [{ id: P1, name: 'glot', organization_id: null }],
      ci_jobs: [job({ id: 'only' })],
    })
    const rows = await loadCiOverviewRows(db as never, [P1, P1], FROM)
    expect(rows.finished.map((row) => row.id)).toEqual(['only'])
    const finishedReads = db.calls.filter((call) => call.table === 'ci_jobs' && call.ops.includes('eq:status=completed'))
    expect(finishedReads).toHaveLength(1)
  })

  it('does not read ci_jobs when the caller has no projects', async () => {
    const db = fakeDb({})
    const rows = await loadCiOverviewRows(db as never, [], FROM)
    expect(rows.finished).toEqual([])
    expect(rows.unfinished).toEqual([])
    expect(db.calls.filter((call) => call.table === 'ci_jobs')).toEqual([])
  })

  it('still reports a per-project statement timeout instead of an empty CI view', async () => {
    const db = fakeDb({ projects: [{ id: P1, name: 'glot', organization_id: null }], ci_jobs: [] }, { timeoutProject: P1 })
    await expect(loadCiOverviewRows(db as never, [P1], FROM)).rejects.toThrow(
      'ci_jobs read failed: canceling statement due to statement timeout',
    )
  })
})
