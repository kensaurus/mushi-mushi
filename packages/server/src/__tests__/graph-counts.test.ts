/**
 * /graph counts.
 *
 * - The Graph backend card's "Unsynced nodes/edges" read `.count` off the
 *   `data` of a head:true count query, which is always null, so both rows
 *   always showed "—".
 * - The header Nodes/Edges stat was the length of a select capped at
 *   500/1000, so large projects saturated and disagreed with the canvas.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let synthetic: typeof import('../../supabase/functions/api/routes/intelligence-synthetic.ts')
let graph: typeof import('../../supabase/functions/api/routes/graph-query.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  synthetic = await import('../../supabase/functions/api/routes/intelligence-synthetic.ts')
  graph = await import('../../supabase/functions/api/routes/graph-query.ts')
})

describe('countUnsyncedGraphRows', () => {
  it('returns real numbers from head count queries', async () => {
    const db = makeFakeDb({
      graph_nodes: [
        { id: 'n1', project_id: 'p1', age_synced_at: null },
        { id: 'n2', project_id: 'p1', age_synced_at: '2026-10-01T00:00:00Z' },
        { id: 'n3', project_id: 'p1', age_synced_at: null },
        { id: 'n4', project_id: 'other', age_synced_at: null },
      ],
      graph_edges: [{ id: 'e1', project_id: 'p1', age_synced_at: '2026-10-01T00:00:00Z' }],
    })
    expect(await synthetic.countUnsyncedGraphRows(db as never, 'p1')).toEqual({ nodes: 2, edges: 0 })
  })

  it('reports null (not checked), never 0, when a count fails', async () => {
    const db = makeFakeDb({ graph_nodes: [], graph_edges: [] }, { failRead: (t) => (t === 'graph_edges' ? 'boom' : null) })
    expect(await synthetic.countUnsyncedGraphRows(db as never, 'p1')).toEqual({ nodes: 0, edges: null })
  })
})

describe('graphTotal', () => {
  it('uses the exact count over the capped sample length', () => {
    expect(graph.graphTotal(2000, 500)).toBe(2000)
  })

  it('falls back to what was returned when no count came back', () => {
    expect(graph.graphTotal(null, 120)).toBe(120)
    expect(graph.graphTotal(undefined, 0)).toBe(0)
  })

  it('canvas caps stay at the documented sizes', () => {
    expect(graph.GRAPH_CANVAS_NODE_LIMIT).toBe(200)
    expect(graph.GRAPH_CANVAS_EDGE_LIMIT).toBe(500)
  })
})

// Report 4659acc8: bug groups on the map read "6f6a3044-f1b6-…".
describe('reportGroupDisplayLabel', () => {
  it('names a group by its title, else its first report, with the report count', () => {
    expect(graph.reportGroupDisplayLabel({ groupTitle: 'Login button does nothing', reportCount: 3 })).toBe('Login button does nothing (3 reports)')
    expect(graph.reportGroupDisplayLabel({ groupTitle: null, report: { title: 'Crash on start' }, reportCount: 1 })).toBe('Crash on start')
    expect(graph.reportGroupDisplayLabel({ report: { title: null, summary: '  The   receipt upload fails after a save  ' } })).toBe('The receipt upload fails after a save')
  })

  it('cuts a long name at 60 characters and gives null when there is nothing to show', () => {
    const name = graph.reportGroupDisplayLabel({ report: { description: 'x'.repeat(200) }, reportCount: 2 })!
    expect(name.startsWith(`${'x'.repeat(59)}…`)).toBe(true)
    expect(name.endsWith('(2 reports)')).toBe(true)
    expect(graph.reportGroupDisplayLabel({ report: { title: '', summary: null } })).toBeNull()
  })
})

// The map stores a UUID on purpose (dedupe key). Two shapes reach the canvas:
// the group id, and the report id with metadata.report_id (linkReportToAction).
const GROUP_ID = '6f6a3044-f1b6-4000-8000-000000000001'
const REPORT_ID = 'cb7ca884-d2be-4000-8000-000000000002'

describe('reportGroupNames', () => {
  it('names a group-id node from the group title, and a report-id node from the report', async () => {
    const db = makeFakeDb({
      report_groups: [
        { id: GROUP_ID, title: 'Lesson rail crashes on open', report_count: 3, canonical_report_id: REPORT_ID },
      ],
      reports: [
        {
          id: REPORT_ID,
          title: null,
          summary: null,
          description: 'Lesson rail crashes on open',
          report_group_id: GROUP_ID,
        },
      ],
    })
    const names = await graph.reportGroupNames(db as never, [
      { id: 'node-group', node_type: 'report_group', label: GROUP_ID, metadata: { reportId: REPORT_ID } },
      { id: 'node-report', node_type: 'report_group', label: REPORT_ID, metadata: { kind: 'report', report_id: REPORT_ID } },
      { id: 'node-page', node_type: 'page', label: '/lesson', metadata: null },
    ])
    expect(names.get('node-group')).toBe('Lesson rail crashes on open (3 reports)')
    expect(names.get('node-report')).toBe('Lesson rail crashes on open (3 reports)')
    expect(names.has('node-page')).toBe(false)
    expect([...names.values()].join(' ')).not.toMatch(/6f6a3044|cb7ca884/)

    // The report id is not a group id; the group is reached through the report row.
    const onlyReport = await graph.reportGroupNames(db as never, [
      { id: 'node-report', node_type: 'report_group', label: REPORT_ID, metadata: { kind: 'report', report_id: REPORT_ID } },
    ])
    expect(onlyReport.get('node-report')).toBe('Lesson rail crashes on open (3 reports)')
  })

  it('uses the canonical report when the group has no title and the node only stores the group id', async () => {
    const db = makeFakeDb({
      report_groups: [{ id: GROUP_ID, title: null, report_count: 1, canonical_report_id: REPORT_ID }],
      reports: [
        { id: REPORT_ID, title: null, summary: 'Checkout total shows NaN', description: null, report_group_id: GROUP_ID },
      ],
    })
    const names = await graph.reportGroupNames(db as never, [
      { id: 'node-group', node_type: 'report_group', label: GROUP_ID, metadata: {} },
    ])
    expect(names.get('node-group')).toBe('Checkout total shows NaN')
  })
})
