/**
 * FILE: packages/server/supabase/functions/_shared/repo-housekeeping-github.ts
 * PURPOSE: The GitHub calls the repo clean-up makes (ADR 0051), each with a
 *          timeout and an injectable fetch. Reads page through lists with a
 *          cap; the writes are the four the acts need:
 *            - delete a branch only if it still points at a commit
 *              (GraphQL `updateRefs` with `beforeOid`: GitHub checks it), or,
 *              where that mutation is not available, read then DELETE;
 *            - recreate a branch at a commit (Restore);
 *            - turn on "Automatically delete head branches".
 *          Closing a pull request goes through _shared/fix-close.ts.
 */

import type { GhBranch, GhPull } from './repo-housekeeping.ts'

const API = 'https://api.github.com'
const TIMEOUT_MS = 15_000
export const ZERO_OID = '0000000000000000000000000000000000000000'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface Gh {
  fetch: FetchLike
  token: string
  /** Lowest x-ratelimit-remaining seen so far (Infinity until a response carries one). */
  remaining: number
}

export function ghClient(fetchImpl: FetchLike, token: string): Gh {
  return { fetch: fetchImpl, token, remaining: Number.POSITIVE_INFINITY }
}

/** A branch name in a URL path: each segment encoded, the slashes kept. */
export function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

async function call(gh: Gh, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await gh.fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${gh.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mushi-mushi-repo-cleanup',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    })
    const left = Number(res.headers.get('x-ratelimit-remaining'))
    if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(left)) gh.remaining = Math.min(gh.remaining, left)
    const text = res.status === 204 ? '' : await res.text()
    let body: any = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    return { status: res.status, body }
  } catch {
    return { status: 0, body: null }
  } finally {
    clearTimeout(timer)
  }
}

export interface RepoInfo {
  defaultBranch: string
  nodeId: string | null
  deleteBranchOnMerge: boolean
  /** The token can change repo settings (GitHub's `permissions.admin`). */
  canAdmin: boolean
  /** The token can push (needed to delete or create a branch). */
  canPush: boolean
}

export async function readRepo(gh: Gh, repo: string): Promise<{ status: number; info: RepoInfo | null }> {
  const r = await call(gh, `/repos/${repo}`)
  if (r.status !== 200 || !r.body || typeof r.body.default_branch !== 'string') return { status: r.status, info: null }
  const perms = (r.body.permissions ?? {}) as Record<string, boolean>
  return {
    status: 200,
    info: {
      defaultBranch: r.body.default_branch,
      nodeId: typeof r.body.node_id === 'string' ? r.body.node_id : null,
      deleteBranchOnMerge: r.body.delete_branch_on_merge === true,
      canAdmin: perms.admin === true,
      canPush: perms.push === true || perms.admin === true,
    },
  }
}

/** Every branch with its tip and protection, up to `maxPages` pages of 100. */
export async function listBranches(gh: Gh, repo: string, maxPages = 10): Promise<{ ok: boolean; branches: GhBranch[]; truncated: boolean }> {
  const out: GhBranch[] = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await call(gh, `/repos/${repo}/branches?per_page=100&page=${page}`)
    if (r.status !== 200 || !Array.isArray(r.body)) return { ok: false, branches: out, truncated: true }
    for (const b of r.body) {
      if (typeof b?.name === 'string' && typeof b?.commit?.sha === 'string') out.push({ name: b.name, sha: b.commit.sha, protected: b.protected === true })
    }
    if (r.body.length < 100) return { ok: true, branches: out, truncated: false }
  }
  return { ok: true, branches: out, truncated: true }
}

export function toPull(p: any): GhPull | null {
  if (!p || typeof p.number !== 'number' || typeof p?.head?.ref !== 'string' || typeof p?.head?.sha !== 'string') return null
  return {
    number: p.number,
    state: p.state === 'open' ? 'open' : 'closed',
    merged: !!p.merged_at || p.merged === true,
    draft: p.draft === true,
    headRef: p.head.ref,
    headRepo: typeof p.head.repo?.full_name === 'string' ? p.head.repo.full_name.toLowerCase() : null,
    headSha: p.head.sha,
    baseRef: typeof p?.base?.ref === 'string' ? p.base.ref : '',
    closedAt: typeof p.closed_at === 'string' ? p.closed_at : null,
    mergedAt: typeof p.merged_at === 'string' ? p.merged_at : null,
  }
}

/** Pull requests in one state, newest update first, up to `maxPages` pages of 100. */
export async function listPulls(gh: Gh, repo: string, state: 'open' | 'closed', maxPages: number): Promise<{ ok: boolean; pulls: GhPull[]; truncated: boolean }> {
  const out: GhPull[] = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await call(gh, `/repos/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`)
    if (r.status !== 200 || !Array.isArray(r.body)) return { ok: false, pulls: out, truncated: true }
    for (const p of r.body) {
      const pull = toPull(p)
      if (pull) out.push(pull)
    }
    if (r.body.length < 100) return { ok: true, pulls: out, truncated: false }
  }
  return { ok: true, pulls: out, truncated: true }
}

export async function readPull(gh: Gh, repo: string, n: number): Promise<{ status: number; pull: GhPull | null }> {
  const r = await call(gh, `/repos/${repo}/pulls/${n}`)
  return { status: r.status, pull: r.status === 200 ? toPull(r.body) : null }
}

/** One branch: its tip and protection; null on 404 (gone). */
export async function readBranch(gh: Gh, repo: string, branch: string): Promise<{ status: number; branch: GhBranch | null }> {
  const r = await call(gh, `/repos/${repo}/branches/${refPath(branch)}`)
  if (r.status !== 200 || typeof r.body?.commit?.sha !== 'string') return { status: r.status, branch: null }
  return { status: 200, branch: { name: branch, sha: r.body.commit.sha, protected: r.body.protected === true } }
}

/** The commit a branch ref points at; null on 404. */
export async function readRefSha(gh: Gh, repo: string, branch: string): Promise<{ status: number; sha: string | null }> {
  const r = await call(gh, `/repos/${repo}/git/ref/heads/${refPath(branch)}`)
  return { status: r.status, sha: r.status === 200 && typeof r.body?.object?.sha === 'string' ? r.body.object.sha : null }
}

/**
 * The head commit date of each open pull request, in one GraphQL query
 * (aliased, ≤ 50 numbers). A number GitHub does not answer maps to null.
 */
export async function headCommitDates(gh: Gh, repo: string, numbers: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  const list = [...new Set(numbers)].filter((n) => Number.isInteger(n) && n > 0).slice(0, 50)
  if (list.length === 0) return out
  const [owner, name] = repo.split('/')
  const fields = list.map((n) => `p${n}: pullRequest(number: ${n}) { commits(last: 1) { nodes { commit { committedDate } } } }`).join(' ')
  const r = await call(gh, '/graphql', {
    method: 'POST',
    body: JSON.stringify({ query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } }),
  })
  const repoNode = r.status === 200 ? r.body?.data?.repository : null
  for (const n of list) {
    const at = repoNode?.[`p${n}`]?.commits?.nodes?.[0]?.commit?.committedDate
    out.set(n, typeof at === 'string' ? at : null)
  }
  return out
}

export type CasDelete =
  | { kind: 'deleted' }
  /** GitHub refused: the ref moved, a ruleset blocks it, or the token cannot. */
  | { kind: 'refused'; message: string }
  /** The mutation is not available to this token or host: fall back to read-then-delete. */
  | { kind: 'unavailable'; message: string }

/**
 * Delete refs/heads/<branch> only if it points at `beforeOid`, in one
 * GraphQL `updateRefs` call (atomic, one ref per call).
 */
export async function deleteRefIfAt(gh: Gh, repoNodeId: string, branch: string, beforeOid: string): Promise<CasDelete> {
  const r = await call(gh, '/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }',
      variables: { input: { repositoryId: repoNodeId, refUpdates: [{ name: `refs/heads/${branch}`, beforeOid, afterOid: ZERO_OID }] } },
    }),
  })
  if (r.status === 401 || r.status === 403) return { kind: 'refused', message: 'GitHub refused the token for this change.' }
  if (r.status !== 200) return { kind: 'unavailable', message: `GitHub answered ${r.status || 'nothing'} to the checked delete.` }
  const errors = Array.isArray(r.body?.errors) ? (r.body.errors as Array<{ message?: string; type?: string }>) : []
  if (errors.length === 0) return { kind: 'deleted' }
  const text = errors.map((e) => e.message ?? '').join('; ').slice(0, 300)
  if (errors.some((e) => /doesn't exist on type|undefinedField|Field 'updateRefs'/i.test(`${e.message ?? ''} ${e.type ?? ''}`))) {
    return { kind: 'unavailable', message: text }
  }
  return { kind: 'refused', message: text || 'GitHub refused the delete.' }
}

/** REST DELETE of a branch ref. 204 deleted, 404/422 gone or protected. */
export async function deleteRefRest(gh: Gh, repo: string, branch: string): Promise<number> {
  return (await call(gh, `/repos/${repo}/git/refs/heads/${refPath(branch)}`, { method: 'DELETE' })).status
}

/** Create refs/heads/<branch> at `sha` (Restore). 201 created, 422 exists or the commit is gone. */
export async function createRef(gh: Gh, repo: string, branch: string, sha: string): Promise<number> {
  return (await call(gh, `/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) })).status
}

/** Close a pull request (used through fix-close.ts's closeFixPullRequest). */
export async function closePull(gh: Gh, repo: string, n: number): Promise<boolean> {
  const r = await call(gh, `/repos/${repo}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
  return r.status === 200
}

/** Turn on "Automatically delete head branches"; the value GitHub reports after, or null. */
export async function enableDeleteBranchOnMerge(gh: Gh, repo: string): Promise<{ status: number; value: boolean | null }> {
  const r = await call(gh, `/repos/${repo}`, { method: 'PATCH', body: JSON.stringify({ delete_branch_on_merge: true }) })
  return { status: r.status, value: r.status === 200 ? r.body?.delete_branch_on_merge === true : null }
}
