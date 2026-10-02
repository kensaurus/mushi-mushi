/**
 * FILE: apps/docs/lib/public-diagram.ts
 * PURPOSE: Pure helpers for the public architecture-diagram page
 *          (kensaur.us/mushi-mushi/r/<owner>/<repo>, Plan 020 §10.3.3).
 *          The server already validated every path and computed every
 *          position (_shared/repo-diagram.ts); this page only draws.
 */

interface PublicDiagramGroup {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface PublicDiagramNode {
  id: string
  label: string
  group: string
  path: string | null
  description: string
  x: number
  y: number
}

interface PublicDiagramEdge {
  from: string
  to: string
  label: string
}

export interface PublicDiagram {
  owner: string
  repo: string
  sha: string
  generated_at: string
  published_at?: string
  groups: PublicDiagramGroup[]
  nodes: PublicDiagramNode[]
  edges: PublicDiagramEdge[]
}

/** Same build-time API base the docs' migration-progress client uses. */
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_MUSHI_API_URL ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

/** Must match DIAGRAM_NODE_W / _H in packages/server/supabase/functions/_shared/repo-diagram.ts. */
export const NODE_W = 220
export const NODE_H = 64

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

/**
 * The repo this page shows: `/r/<owner>/<repo>` in the path (the CloudFront
 * rewrite keeps the browser URL), else `?repo=<owner>/<repo>`.
 */
export function parseRepoFromLocation(pathname: string, search: string): { owner: string; repo: string } | null {
  const fromPath = /\/r\/([^/]+)\/([^/?#]+)\/?$/.exec(pathname)
  let owner = fromPath?.[1] ?? ''
  let repo = fromPath?.[2] ?? ''
  if (!fromPath || owner === '_shell') {
    const q = new URLSearchParams(search).get('repo') ?? ''
    const parts = q.split('/')
    if (parts.length !== 2) return null
    ;[owner, repo] = parts
  }
  try {
    owner = decodeURIComponent(owner)
    repo = decodeURIComponent(repo)
  } catch {
    return null
  }
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/** Canvas size that holds every group, with a margin. */
export function canvasSize(d: Pick<PublicDiagram, 'groups' | 'nodes'>): { width: number; height: number } {
  let w = 0
  let h = 0
  for (const g of d.groups) {
    w = Math.max(w, g.x + g.w)
    h = Math.max(h, g.y + g.h)
  }
  for (const n of d.nodes) {
    w = Math.max(w, n.x + NODE_W)
    h = Math.max(h, n.y + NODE_H)
  }
  return { width: w + 32, height: h + 32 }
}

/**
 * SVG path for an edge: right side of the caller to the left side of the
 * callee as a cubic curve; same-column edges loop out to the right.
 */
export function edgePath(from: PublicDiagramNode, to: PublicDiagramNode): string {
  const sy = from.y + NODE_H / 2
  const ty = to.y + NODE_H / 2
  if (Math.abs(from.x - to.x) < 1) {
    const x = from.x + NODE_W
    const bulge = 48
    return `M ${x} ${sy} C ${x + bulge} ${sy}, ${x + bulge} ${ty}, ${x} ${ty}`
  }
  const forward = to.x > from.x
  const sx = forward ? from.x + NODE_W : from.x
  const tx = forward ? to.x : to.x + NODE_W
  const mid = (sx + tx) / 2
  return `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`
}

export function githubTreeUrl(owner: string, repo: string, sha: string, path: string): string {
  return `https://github.com/${owner}/${repo}/tree/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Sign-up link from this page. `src` names the page and repo so a sign-up
 * is attributable (signupAttribution.ts keeps `src` as signup_src); it is
 * set here, so the site's CTA decoration never overwrites it.
 */
export function diagramSignupHref(owner: string, repo: string): string {
  const tag = `diagram:${owner}/${repo}`.replace(/[^A-Za-z0-9._:\-/]/g, '').slice(0, 64)
  return `https://kensaur.us/mushi-mushi/admin/signup?src=${encodeURIComponent(tag)}`
}

/** docs/adr/0015: the product inbox (same address as the site footer). */
export const DIAGRAM_REPORT_EMAIL = 'kensaurus@gmail.com'

export interface DiagramReportTarget {
  owner: string
  repo: string
  sha: string
  /** The part being reported, when one is selected. */
  nodePath?: string | null
  nodeLabel?: string | null
}

/**
 * Private fallback when the Mushi SDK is not loaded: an email to the product
 * inbox. Never a public issue: a takedown request can itself contain what
 * someone wants removed.
 */
export function diagramReportMailto(t: DiagramReportTarget): string {
  const subject = `Wrong or unwanted diagram: ${t.owner}/${t.repo}`
  const lines = [
    `Page: https://kensaur.us/mushi-mushi/r/${t.owner}/${t.repo}`,
    `Commit: ${t.sha}`,
    ...(t.nodeLabel || t.nodePath ? [`Part: ${t.nodeLabel ?? ''}${t.nodePath ? ` (${t.nodePath})` : ''}`] : []),
    '',
    'What is wrong, or why it should not be public:',
    '',
  ]
  return `mailto:${DIAGRAM_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
}

/** The slice of the Mushi SDK this needs (MushiSiteAnalytics' getLoadedMushi). */
export interface DiagramReportSdk {
  setMetadata: (key: string, value: unknown) => void
  report: (options?: { category?: string }) => void
}

/**
 * Report a wrong or unwanted diagram privately. With the SDK loaded, the
 * report goes into Mushi's own queue (category `other`) carrying the repo,
 * commit and part as metadata, and the visitor describes the problem in the
 * widget. Without it, the caller opens the returned mailto.
 */
export function reportWrongDiagram(
  t: DiagramReportTarget,
  sdk: DiagramReportSdk | null,
): { via: 'sdk' } | { via: 'email'; href: string } {
  if (!sdk) return { via: 'email', href: diagramReportMailto(t) }
  sdk.setMetadata('public_diagram', {
    repo: `${t.owner}/${t.repo}`,
    sha: t.sha,
    node_path: t.nodePath ?? null,
    node_label: t.nodeLabel ?? null,
    page: `https://kensaur.us/mushi-mushi/r/${t.owner}/${t.repo}`,
  })
  sdk.report({ category: 'other' })
  return { via: 'sdk' }
}
