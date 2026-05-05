/**
 * Inventory grounding for v2 Triage (whitepaper §4.7).
 *
 * Given a report's `nearestTestid` + `route` + projectId, return the
 * (small) set of Action nodes whose Page.path matches the route AND whose
 * Element.testid matches the captured testid. The classify-report stage
 * then injects these as candidate node ids into the system prompt and
 * the LLM picks one — making the report → Action mapping deterministic
 * when the SDK delivered the hints, and fuzzy-matched only as fallback.
 *
 * After classification, the caller links the report to the chosen Action
 * via `linkReportToAction` (a `reports_against` edge in graph_edges).
 *
 * IMPORTANT: this helper performs NO LLM call. The LLM is the existing
 * Stage 2 model — we only widen the prompt context.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { createEdge } from './knowledge-graph.ts'

export interface InventoryCandidate {
  actionNodeId: string
  actionLabel: string
  pagePath: string | null
  pageId: string | null
  elementTestid: string | null
  elementType: string | null
  status: string
}

interface NodeRow {
  id: string
  node_type: string
  label: string
  metadata: Record<string, unknown> | null
}

interface EdgeRow {
  source_node_id: string
  target_node_id: string
  edge_type: string
}

/**
 * Find candidate Action nodes for a report.
 *
 * Resolution order:
 *   1. If `nearestTestid` is provided AND `route` is provided, return the
 *      Action whose Element.testid matches AND whose containing Page.path
 *      matches. This is the unambiguous case — usually exactly one match.
 *   2. If only `nearestTestid` is provided, return every Action whose
 *      Element has that testid. Multiple pages can share a testid for the
 *      same component (Buy Pro CTA on landing + dashboard); the LLM picks.
 *   3. If only `route` is provided, return every Action on that page —
 *      bounded at 12 to keep the prompt small.
 *   4. If neither, return [] — the LLM falls back to text-only classification.
 *
 * One round trip via two queries (graph_nodes + graph_edges); a 4-way
 * join would be cleaner in raw SQL but PostgREST's relational shape is
 * verbose enough that the in-process join is more readable.
 */
export async function findInventoryCandidates(
  db: SupabaseClient,
  projectId: string,
  hints: { route?: string | null; nearestTestid?: string | null },
): Promise<InventoryCandidate[]> {
  const route = hints.route ?? null
  const testid = hints.nearestTestid ?? null
  if (!route && !testid) return []

  // Pull every relevant node in one shot. Bound at 5000 — safe for any
  // realistic inventory (the largest design-partner inventory is ~3000).
  const { data: nodes } = await db
    .from('graph_nodes')
    .select('id, node_type, label, metadata')
    .eq('project_id', projectId)
    .in('node_type', ['page_v2', 'element', 'action'])
    .limit(5000)
    .returns<NodeRow[]>()
  if (!nodes || nodes.length === 0) return []

  const pages = nodes.filter((n) => n.node_type === 'page_v2')
  const elements = nodes.filter((n) => n.node_type === 'element')
  const actions = nodes.filter((n) => n.node_type === 'action')
  if (actions.length === 0) return []

  const { data: edges } = await db
    .from('graph_edges')
    .select('source_node_id, target_node_id, edge_type')
    .eq('project_id', projectId)
    .in('edge_type', ['contains', 'triggers'])
    .returns<EdgeRow[]>()

  // Build adjacency.
  const elementByAction = new Map<string, string>() // action → element
  for (const e of edges ?? []) {
    if (e.edge_type !== 'triggers') continue
    elementByAction.set(e.target_node_id, e.source_node_id)
  }
  const pageByElement = new Map<string, string>() // element → page
  for (const e of edges ?? []) {
    if (e.edge_type !== 'contains') continue
    // page_v2 → element OR element → action; we only want page_v2 → element
    // (which we identify by checking the source is a page_v2 node).
    pageByElement.set(e.target_node_id, e.source_node_id)
  }
  const pageById = new Map<string, NodeRow>()
  for (const p of pages) pageById.set(p.id, p)
  const elementById = new Map<string, NodeRow>()
  for (const e of elements) elementById.set(e.id, e)

  const out: InventoryCandidate[] = []
  for (const action of actions) {
    const elementId = elementByAction.get(action.id)
    if (!elementId) continue
    const element = elementById.get(elementId)
    if (!element) continue
    const pageId = pageByElement.get(elementId)
    const page = pageId ? pageById.get(pageId) : null
    const elementMeta = element.metadata as Record<string, unknown> | null
    const pageMeta = page?.metadata as Record<string, unknown> | null
    const elementTestid = (elementMeta?.['testid'] as string | undefined) ?? null
    const pagePath = (pageMeta?.['path'] as string | undefined) ?? null
    const elementType = (elementMeta?.['type'] as string | undefined) ?? null
    const status = (action.metadata?.['status'] as string | undefined) ?? 'unknown'

    // Match logic.
    //
    // `route` carries the **concrete** pathname captured in the browser
    // (`window.location.pathname` — e.g. `/practice/abc-123`), but the
    // inventory stores Page.path as a **template** (`/practice/[id]`,
    // `/[lang]/posts/[slug]`, `/docs/[...slug]`). A naive `===` match
    // (the previous behaviour) silently dropped grounding for every
    // dynamic route — exactly the pages where Action mapping helps
    // most. We compare via `pagePathMatchesRoute` which:
    //   - accepts `[param]` and `[...catchall]` template segments
    //   - normalises trailing slashes
    //   - falls back to literal equality for fully-static paths
    let match = false
    if (testid && route) {
      match = elementTestid === testid && pagePathMatchesRoute(pagePath, route)
    } else if (testid) {
      match = elementTestid === testid
    } else if (route) {
      match = pagePathMatchesRoute(pagePath, route)
    }
    if (!match) continue

    out.push({
      actionNodeId: action.id,
      actionLabel: action.label,
      pagePath,
      pageId: (pageMeta?.['page_id'] as string | undefined) ?? null,
      elementTestid,
      elementType,
      status,
    })
    if (out.length >= 12) break
  }

  return out
}

/**
 * Test whether a concrete browser pathname (`/practice/abc-123`) belongs
 * to an inventory page template (`/practice/[id]`).
 *
 * Rules:
 *   - `[param]`        → matches any single non-slash segment.
 *   - `[...catchall]`  → matches one or more segments greedily.
 *   - Trailing slash on either side is ignored.
 *   - Segment count must match exactly unless a catch-all is present.
 *   - Static paths fall back to literal equality.
 *
 * Exported for unit testing.
 */
export function pagePathMatchesRoute(
  template: string | null,
  concrete: string | null,
): boolean {
  if (!template || !concrete) return false
  const t = stripTrailingSlash(template)
  const c = stripTrailingSlash(concrete)
  if (t === c) return true
  // Fast path: no template syntax, just literal compare.
  if (!t.includes('[')) return false

  const tSegs = t.split('/')
  const cSegs = c.split('/')

  for (let i = 0; i < tSegs.length; i++) {
    const seg = tSegs[i]
    // Catch-all: `[...slug]` consumes the rest of the path.
    if (seg.startsWith('[...') && seg.endsWith(']')) {
      // Need at least one concrete segment to consume.
      return cSegs.length > i
    }
    // Optional catch-all: `[[...slug]]` — also matches zero segments.
    if (seg.startsWith('[[...') && seg.endsWith(']]')) {
      return true
    }
    if (i >= cSegs.length) return false
    // Dynamic segment: `[id]` matches any single non-empty segment.
    if (seg.startsWith('[') && seg.endsWith(']')) {
      if (cSegs[i] === '') return false
      continue
    }
    // Literal segment must match exactly (case-sensitive, like browsers).
    if (seg !== cSegs[i]) return false
  }
  // No catch-all consumed the tail — segment counts must match.
  return tSegs.length === cSegs.length
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1)
  return p
}

/**
 * Format candidates for inclusion in the Stage 2 prompt. The LLM is asked
 * to either pick one candidate (return its `nodeId`) or `none` if no
 * candidate matches.
 */
export function formatCandidatesForPrompt(candidates: InventoryCandidate[]): string {
  if (candidates.length === 0) return ''
  const lines = candidates.map((c, i) => {
    const tid = c.elementTestid ? ` testid=${c.elementTestid}` : ''
    const path = c.pagePath ? ` path=${c.pagePath}` : ''
    return `  ${i + 1}. nodeId=${c.actionNodeId} status=${c.status}${path}${tid} → ${c.actionLabel}`
  })
  return `\n## Inventory candidates (Mushi v2 §4.7)
The reporter's environment carried inventory hints. Pick the matching Action node id, or "none":
${lines.join('\n')}\n`
}

/**
 * After classification, link the report to the chosen Action with a
 * `reports_against` edge (whitepaper §3.2). Idempotent — uses
 * createEdge's existing dedupe path. Fire-and-forget at the call site.
 */
export async function linkReportToAction(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  actionNodeId: string,
): Promise<void> {
  // Find or create the report node — every classified report gets a
  // graph node so the bidirectional graph can show both halves.
  const { data: existing } = await db
    .from('graph_nodes')
    .select('id')
    .eq('project_id', projectId)
    .eq('node_type', 'report_group')
    .eq('label', reportId)
    .maybeSingle()
  let reportNodeId: string
  if (existing) {
    reportNodeId = existing.id as string
  } else {
    const { data: created, error } = await db
      .from('graph_nodes')
      .insert({
        project_id: projectId,
        node_type: 'report_group',
        label: reportId,
        metadata: { kind: 'report', report_id: reportId },
      })
      .select('id')
      .single()
    if (error || !created) return
    reportNodeId = created.id as string
  }
  await createEdge(db, projectId, reportNodeId, actionNodeId, 'reports_against')
}
