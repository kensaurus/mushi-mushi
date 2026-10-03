/**
 * FILE: packages/server/supabase/functions/_shared/diagram-overlay.ts
 * PURPOSE: Put a project's open bug reports and code findings on the parts of
 *          its architecture diagram (Plan 020 §10.3.2: "reports and radar
 *          findings per node, which none of the competitors can show").
 *
 * Each item carries the repo paths it touches: a report's stack-frame files
 * (matched to the tree) and the files its fix attempts changed; a finding's
 * file. An item lands on the diagram node whose path contains one of its
 * files, the most specific node only: a file under `apps/web/src/auth` counts
 * for an "Auth" node at that path, not again for a "Web app" node at
 * `apps/web`. Items no node contains are counted as unplaced.
 *
 * Pure: no I/O, no Deno globals.
 */

import { normalizeRepoPathForDigest } from './repo-digest.ts'

/** Report statuses that are closed (mirrors webhooks-github-indexer's sweep). */
export const DONE_REPORT_STATUSES = ['fixed', 'resolved', 'verified', 'dismissed'] as const

/** Per-node list size; the counts cover the rest. */
export const MAX_ITEMS_PER_NODE = 25
/** Upper bound for one part's full list ("Show all"). */
export const MAX_ITEMS_FULL_NODE = 500

/** Split ids so each PostgREST `in.()` filter keeps the URL short. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)))
  return out
}

export interface OverlayReport {
  id: string
  summary: string | null
  severity: string | null
  status: string | null
  paths: string[]
}

export interface OverlayFinding {
  id: string
  rule_id: string
  severity: string | null
  message: string
  file_path: string
  line: number | null
}

export interface NodeOverlay {
  report_count: number
  finding_count: number
  reports: Array<Omit<OverlayReport, 'paths'>>
  findings: OverlayFinding[]
}

export interface DiagramOverlay {
  nodes: Record<string, NodeOverlay>
  unplaced: { reports: number; findings: number }
}

/** The ids of the most specific nodes whose path is, or contains, `file`. */
export function nodesForPath(
  file: string,
  nodes: ReadonlyArray<{ id: string; path: string | null }>,
): string[] {
  const f = normalizeRepoPathForDigest(file)
  let best = -1
  let hits: string[] = []
  for (const n of nodes) {
    if (!n.path) continue
    const p = normalizeRepoPathForDigest(n.path)
    if (f !== p && !f.startsWith(`${p}/`)) continue
    if (p.length > best) {
      best = p.length
      hits = [n.id]
    } else if (p.length === best) {
      hits.push(n.id)
    }
  }
  return hits
}

function emptyOverlay(): NodeOverlay {
  return { report_count: 0, finding_count: 0, reports: [], findings: [] }
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const bySeverity = (a: { severity: string | null }, b: { severity: string | null }) =>
  (SEVERITY_RANK[a.severity ?? ''] ?? 4) - (SEVERITY_RANK[b.severity ?? ''] ?? 4)

export function buildDiagramOverlay(
  nodes: ReadonlyArray<{ id: string; path: string | null }>,
  reports: readonly OverlayReport[],
  findings: readonly OverlayFinding[],
  maxPerNode: number = MAX_ITEMS_PER_NODE,
): DiagramOverlay {
  const out: Record<string, NodeOverlay> = {}
  const unplaced = { reports: 0, findings: 0 }
  const slot = (id: string) => (out[id] ??= emptyOverlay())

  for (const r of reports) {
    const ids = new Set(r.paths.flatMap((p) => nodesForPath(p, nodes)))
    if (ids.size === 0) {
      unplaced.reports++
      continue
    }
    const { paths: _paths, ...summary } = r
    for (const id of ids) {
      const o = slot(id)
      o.report_count++
      o.reports.push(summary)
    }
  }

  // The same rule on the same line shows up once per gate run.
  const seen = new Set<string>()
  for (const f of findings) {
    const key = `${f.rule_id}|${normalizeRepoPathForDigest(f.file_path)}|${f.line ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const ids = nodesForPath(f.file_path, nodes)
    if (ids.length === 0) {
      unplaced.findings++
      continue
    }
    for (const id of ids) {
      const o = slot(id)
      o.finding_count++
      o.findings.push(f)
    }
  }

  for (const o of Object.values(out)) {
    o.reports = o.reports.sort(bySeverity).slice(0, maxPerNode)
    o.findings = o.findings.sort(bySeverity).slice(0, maxPerNode)
  }
  return { nodes: out, unplaced }
}
