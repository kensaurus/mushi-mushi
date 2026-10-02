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

/** Anyone can flag a wrong or unwanted diagram; the issue reaches the maintainers. */
export function reportDiagramHref(owner: string, repo: string, sha: string): string {
  const title = `Wrong or unwanted public diagram: ${owner}/${repo}`
  const body = `The public diagram at https://kensaur.us/mushi-mushi/r/${owner}/${repo} (commit ${sha.slice(0, 7)}) is wrong or should not be public.\n\nWhat is wrong:\n`
  return `https://github.com/kensaurus/mushi-mushi/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}
