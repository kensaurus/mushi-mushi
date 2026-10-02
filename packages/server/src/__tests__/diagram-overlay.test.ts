/**
 * FILE: packages/server/src/__tests__/diagram-overlay.test.ts
 * PURPOSE: Open reports and code findings land on the most specific diagram
 *          part that contains their files, are counted once per part, are
 *          capped per part, and anything no part contains is counted as
 *          unplaced instead of disappearing.
 */

import { describe, expect, it } from 'vitest'
import {
  buildDiagramOverlay,
  MAX_ITEMS_PER_NODE,
  nodesForPath,
  type OverlayFinding,
  type OverlayReport,
} from '../../supabase/functions/_shared/diagram-overlay.ts'

const NODES = [
  { id: 'web', path: 'apps/web' },
  { id: 'auth', path: 'apps/web/src/auth' },
  { id: 'api', path: 'apps/api/src/server.ts' },
  { id: 'stripe', path: null },
]

function report(id: string, paths: string[], severity = 'medium'): OverlayReport {
  return { id, summary: `report ${id}`, severity, status: 'new', paths }
}

function finding(id: string, file_path: string, line: number | null = 1, rule_id = 'dead-handler'): OverlayFinding {
  return { id, rule_id, severity: 'high', message: 'msg', file_path, line }
}

describe('nodesForPath', () => {
  it('picks the most specific containing node', () => {
    expect(nodesForPath('apps/web/src/auth/login.ts', NODES)).toEqual(['auth'])
    expect(nodesForPath('apps/web/src/App.tsx', NODES)).toEqual(['web'])
    expect(nodesForPath('apps/api/src/server.ts', NODES)).toEqual(['api'])
  })
  it('matches whole path segments only', () => {
    expect(nodesForPath('apps/website/x.ts', NODES)).toEqual([])
    expect(nodesForPath('./apps/web/a.ts', NODES)).toEqual(['web'])
  })
})

describe('buildDiagramOverlay', () => {
  it('counts each report once per part even when several of its files are there', () => {
    const overlay = buildDiagramOverlay(
      NODES,
      [report('r1', ['apps/web/src/auth/login.ts', 'apps/web/src/auth/session.ts']), report('r2', ['apps/web/src/App.tsx', 'apps/api/src/server.ts'])],
      [],
    )
    expect(overlay.nodes.auth.report_count).toBe(1)
    expect(overlay.nodes.web.report_count).toBe(1)
    expect(overlay.nodes.api.report_count).toBe(1)
    expect(overlay.nodes.web.reports[0]).toEqual({ id: 'r2', summary: 'report r2', severity: 'medium', status: 'new' })
    expect(overlay.unplaced).toEqual({ reports: 0, findings: 0 })
  })

  it('dedupes the same finding repeated across gate runs and counts the unplaced', () => {
    const overlay = buildDiagramOverlay(
      NODES,
      [report('r3', ['docs/readme.md']), report('r4', [])],
      [finding('f1', 'apps/web/src/auth/login.ts', 10), finding('f2', 'apps/web/src/auth/login.ts', 10), finding('f3', 'scripts/x.mjs')],
    )
    expect(overlay.nodes.auth.finding_count).toBe(1)
    expect(overlay.unplaced).toEqual({ reports: 2, findings: 1 })
  })

  it('caps each list but keeps the full counts, most severe first', () => {
    const many = Array.from({ length: MAX_ITEMS_PER_NODE + 10 }, (_, i) => report(`r${i}`, ['apps/web/a.ts'], i === 30 ? 'critical' : 'low'))
    const overlay = buildDiagramOverlay(NODES, many, [])
    expect(overlay.nodes.web.report_count).toBe(MAX_ITEMS_PER_NODE + 10)
    expect(overlay.nodes.web.reports).toHaveLength(MAX_ITEMS_PER_NODE)
    expect(overlay.nodes.web.reports[0].id).toBe('r30')
  })

  it('leaves parts with nothing out of the map', () => {
    const overlay = buildDiagramOverlay(NODES, [], [])
    expect(overlay.nodes).toEqual({})
  })
})
