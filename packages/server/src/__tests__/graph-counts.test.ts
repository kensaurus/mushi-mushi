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

// linkReportToAction stores the report id as the node label and metadata.report_id.
// buildReportGraph stores the group id as the label. Both must read as a title.
const GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REPORT_ID = '6f6a3044-f1b6-4abc-8def-111111111111'
const REPORT_NODE = 'cb7ca884-d2be-4abc-8def-222222222222'

describe('reportGroupNames', () => {
  it('names a group-id node from the group title and leaves the stored label alone', async () => {
    const node = {
      id: 'n-group',
      node_type: 'report_group',
      label: GROUP_ID,
      metadata: { reportId: REPORT_ID },
    }
    const untitled = {
      id: 'n-untitled',
      node_type: 'report_group',
      label: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      metadata: { reportId: REPORT_ID },
    }
    const db = makeFakeDb({
      report_groups: [
        { id: GROUP_ID, title: 'Login button does nothing', report_count: 3, canonical_report_id: REPORT_ID },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: null, report_count: 1, canonical_report_id: null },
      ],
      reports: [{ id: REPORT_ID, title: 'Crash on start', summary: 'unused', description: null, report_group_id: GROUP_ID }],
    })
    const names = await graph.reportGroupNames(db as never, [node, untitled])
    expect(names.get('n-group')).toBe('Login button does nothing (3 reports)')
    expect(names.get('n-untitled')).toBe('Crash on start')
    expect(node.label).toBe(GROUP_ID)
  })

  it('names a report-id node (metadata.report_id) from its group, else the report', async () => {
    const linked = {
      id: 'n-report',
      node_type: 'report_group',
      label: REPORT_NODE,
      metadata: { kind: 'report', report_id: REPORT_NODE },
    }
    const orphan = {
      id: 'n-orphan',
      node_type: 'report_group',
      label: REPORT_ID,
      metadata: { kind: 'report', report_id: REPORT_ID },
    }
    const db = makeFakeDb({
      report_groups: [{ id: GROUP_ID, title: 'Checkout crashes', report_count: 4, canonical_report_id: REPORT_NODE }],
      reports: [
        { id: REPORT_NODE, title: null, summary: 'Receipt upload fails', description: null, report_group_id: GROUP_ID },
        { id: REPORT_ID, title: null, summary: 'Crash on start', description: null, report_group_id: null },
      ],
    })
    const names = await graph.reportGroupNames(db as never, [linked, orphan, { id: 'n-page', node_type: 'page', label: '/checkout', metadata: null }])
    expect(names.get('n-report')).toBe('Checkout crashes (4 reports)')
    expect(names.get('n-orphan')).toBe('Crash on start')
    expect(names.has('n-page')).toBe(false)
    expect(linked.label).toBe(REPORT_NODE)
  })
})
