/**
 * FILE: apps/admin/src/lib/repoUnderstanding.ts
 * PURPOSE: Shapes and pure helpers for the repo digest ("Copy digest") and
 *          the architecture diagram on /explore and report detail
 *          (Plan 020 §10.3). Mirrors api/routes/repo-digest.ts and
 *          api/routes/repo-diagram.ts; positions come from the server so the
 *          console and the public page draw the same picture.
 */

import type { Edge, Node } from '@xyflow/react'

/** Budget choices for "Copy digest", in estimated tokens. */
export const DIGEST_BUDGET_OPTIONS = [
  { tokens: 25_000, label: 'Small (~25k tokens, fits any chat)' },
  { tokens: 50_000, label: 'Medium (~50k tokens)' },
  { tokens: 100_000, label: 'Large (~100k tokens)' },
  { tokens: 200_000, label: 'Max (~200k tokens)' },
] as const

export const DEFAULT_DIGEST_BUDGET = 50_000

export interface RepoDigestResponse {
  owner: string
  repo: string
  sha: string
  ref: string
  budget_tokens: number
  total_tokens: number
  eligible_files: number
  files: Array<{ path: string; tokens: number; truncated: boolean }>
  dropped_counts: Record<string, number>
  redacted: Array<{ path: string; label: string }>
  tree_truncated: boolean
  scope: {
    kind: 'repo' | 'path' | 'report'
    label: string
    report_id?: string
    sources?: { stack_frames: number; fix_files: number; related_code: number; dependents: number }
  }
  cached: boolean
  text: string
}

export function digestPath(projectId: string, opts: { budgetTokens: number; reportId?: string | null }): string {
  const qs = new URLSearchParams({ budget: String(opts.budgetTokens) })
  if (opts.reportId) qs.set('report_id', opts.reportId)
  return `/v1/admin/projects/${projectId}/codebase/digest?${qs}`
}

/** One plain-English line for the toast after a copy. */
export function digestCopiedSummary(d: RepoDigestResponse): string {
  const parts = [
    `${d.files.length} of ${d.eligible_files} files`,
    `about ${d.total_tokens.toLocaleString('en-US')} tokens`,
    `commit ${d.sha.slice(0, 7)}`,
  ]
  if (d.redacted.length > 0) {
    const one = d.redacted.length === 1
    parts.push(`${d.redacted.length} file${one ? '' : 's'} left out because ${one ? 'it looks like a secret' : 'they look like secrets'}`)
  }
  let line = parts.join(' · ')
  if (d.scope.kind === 'report') {
    const linked = d.scope.sources
      ? d.scope.sources.stack_frames + d.scope.sources.fix_files + d.scope.sources.related_code + d.scope.sources.dependents
      : 0
    line = linked > 0
      ? `${linked} file${linked === 1 ? ' linked to this bug goes' : 's linked to this bug go'} first. ${line}`
      : `No files are linked to this bug yet, so this is the whole repo by priority. ${line}`
  }
  return line
}

interface DiagramGroup {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

interface DiagramNode {
  id: string
  label: string
  group: string
  path: string | null
  path_invalid?: boolean
  description: string
  x: number
  y: number
}

interface DiagramEdge {
  from: string
  to: string
  label: string
}

export interface DiagramGraph {
  groups: DiagramGroup[]
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

interface DiagramRow {
  id: string
  commit_sha: string
  repo_owner: string
  repo_name: string
  graph: DiagramGraph
  stats: { invalid_paths?: string[]; ref?: string; nodes?: number }
  model: string | null
  updated_at: string
}

export type DiagramPublication =
  | { published: false }
  | {
      published: true
      url: string
      /** The page's Markdown twin, for agents and answer engines. */
      markdown_url?: string
      /** A README badge linking to the page. */
      badge_markdown?: string
      commit_sha: string
      repo_private: boolean
      published_at: string
      outdated: boolean
    }

export interface DiagramResponse {
  diagram: DiagramRow | null
  publication: DiagramPublication
  reused?: boolean
}

export interface DiagramPublishPreview {
  diagram_id: string
  repo_private: boolean
  payload: { owner: string; repo: string; sha: string; nodes: DiagramNode[]; groups: DiagramGroup[]; edges: DiagramEdge[] }
  payload_hash: string
  url: string
  /** Project owner/admin AND write access to the repo on GitHub. */
  can_publish: boolean
  /** Plain-English reason when can_publish is false. */
  publish_blocked_reason: string | null
}

interface DiagramNodeOverlay {
  report_count: number
  finding_count: number
  reports: Array<{ id: string; summary: string | null; severity: string | null; status: string | null }>
  findings: Array<{ id: string; rule_id: string; severity: string | null; message: string; file_path: string; line: number | null }>
}

/** GET …/codebase/diagram/overlay — open reports and code findings per part. */
export interface DiagramOverlayResponse {
  diagram_id: string
  nodes: Record<string, DiagramNodeOverlay>
  unplaced: { reports: number; findings: number }
  /** False when GitHub could not be read, so stack frames were not placed. */
  frames_matched: boolean
  considered: { reports: number; findings: number; findings_days: number }
}

/** Whether the crawlable static page was written (or removed) alongside the publish. */
export type StaticPageStatus = 'written' | 'deleted' | 'not_configured' | 'failed'

/** Toast after a publish: plain English about the search-friendly page. */
export function publishToast(staticPage: StaticPageStatus | undefined): { tone: 'success' | 'warn'; title: string; description: string } {
  if (staticPage === 'failed') {
    return {
      tone: 'warn',
      title: 'Public page is live, but not yet for search engines',
      description: 'The search-friendly version could not be saved. Publish again to retry.',
    }
  }
  if (staticPage === 'not_configured') {
    return {
      tone: 'success',
      title: 'Public page is live',
      description: 'Search engines will see it once the page store is set up (docs/operators/public-diagram-pages.md).',
    }
  }
  return { tone: 'success', title: 'Public page is live', description: 'Search engines can find it, and a Markdown copy is published too.' }
}

/** Must match DIAGRAM_NODE_W / _H in _shared/repo-diagram.ts. */
const DIAGRAM_NODE_W = 220
const DIAGRAM_NODE_H = 64

export interface DiagramFlowData extends Record<string, unknown> {
  kind: 'group' | 'component'
  label: string
  description?: string
  path?: string | null
  pathInvalid?: boolean
  selected?: boolean
  /** Open bug reports on this part. */
  reportCount?: number
  /** Code findings on this part. */
  findingCount?: number
}

/** React Flow nodes and edges from the server's laid-out graph. Groups render behind their components. */
export function diagramToFlow(
  graph: DiagramGraph,
  selectedId: string | null,
  overlay: DiagramOverlayResponse | null = null,
): { nodes: Node<DiagramFlowData>[]; edges: Edge[] } {
  const groupNodes: Node<DiagramFlowData>[] = graph.groups.map((g) => ({
    id: `group:${g.id}`,
    type: 'diagramGroup',
    position: { x: g.x, y: g.y },
    data: { kind: 'group', label: g.label },
    style: { width: g.w, height: g.h },
    draggable: false,
    selectable: false,
    zIndex: 0,
  }))
  const componentNodes: Node<DiagramFlowData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'diagramComponent',
    position: { x: n.x, y: n.y },
    data: {
      kind: 'component',
      label: n.label,
      description: n.description,
      path: n.path,
      pathInvalid: n.path_invalid === true,
      selected: n.id === selectedId,
      reportCount: overlay?.nodes[n.id]?.report_count ?? 0,
      findingCount: overlay?.nodes[n.id]?.finding_count ?? 0,
    },
    style: { width: DIAGRAM_NODE_W, height: DIAGRAM_NODE_H },
    draggable: false,
    zIndex: 1,
  }))
  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    animated: selectedId !== null && (e.from === selectedId || e.to === selectedId),
  }))
  return { nodes: [...groupNodes, ...componentNodes], edges }
}

/** A link to the file or folder on GitHub at the diagram's commit. */
export function githubPathUrl(owner: string, repo: string, sha: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${repo}/tree/${sha}/${encoded}`
}

/** Copy text from an async source without losing the click's user activation. */
export async function copyTextFrom(load: () => Promise<string>): Promise<void> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!clip) throw new Error('Clipboard is not available in this browser')
  // ClipboardItem with a promise keeps the click's permission while the
  // digest is built (that can take a few seconds); writeText after an await
  // is refused by some browsers.
  if (typeof ClipboardItem !== 'undefined' && typeof clip.write === 'function') {
    const blob = load().then((text) => new Blob([text], { type: 'text/plain' }))
    try {
      await clip.write([new ClipboardItem({ 'text/plain': blob })])
      return
    } catch (err) {
      // A browser without promise support in ClipboardItem: fall through once
      // the text is ready. A failed load re-throws here.
      const text = await blob.then((b) => b.text())
      if (!text) throw err
      await clip.writeText(text)
      return
    }
  }
  await clip.writeText(await load())
}
