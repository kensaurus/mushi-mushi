/**
 * FILE: packages/server/supabase/functions/_shared/recipe-github.ts
 * PURPOSE: Read-only GitHub access for the App Recipe (Plan 019 decision 7):
 *          the project's primary repo and token, the default-branch head, a
 *          file at a pinned SHA, the recursive tree, and batched blob reads
 *          over GraphQL. Mushi never clones a repo.
 *
 * Every function either returns data or throws `RecipeGithubError`; a
 * "not found" is data (`absent`), never an error, and an error is never
 * reported as "absent".
 */

import type { getServiceClient } from './db.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken, type GithubRepoRef } from './github.ts'
import { fetchWithTimeout } from './http.ts'
import { normalizeRepoPath } from './recipe-glob.ts'

type Db = ReturnType<typeof getServiceClient>

export class RecipeGithubError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = 'RecipeGithubError'
  }
}

export interface RecipeRepo {
  ref: GithubRepoRef
  token: string
  repoUrl: string
  /** project_repos.default_branch; the API answer wins when they differ. */
  defaultBranchHint: string
}

export type RecipeRepoResolution =
  | { ok: true; repo: RecipeRepo }
  | { ok: false; repoConnected: boolean; tokenAvailable: boolean; reason: string }

export async function resolveRecipeRepo(db: Db, projectId: string): Promise<RecipeRepoResolution> {
  const { data: repoRow, error } = await db
    .from('project_repos')
    .select('repo_url, default_branch, github_app_installation_id')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()
  if (error) throw new RecipeGithubError(`could not read project_repos: ${error.message}`)
  const row = repoRow as { repo_url?: string; default_branch?: string; github_app_installation_id?: number | null } | null
  const ref = parseGithubRepoUrl(row?.repo_url ?? null)
  if (!row || !ref) {
    return { ok: false, repoConnected: false, tokenAvailable: false, reason: 'No primary GitHub repo is connected to this project.' }
  }
  const token = await resolveProjectGithubToken(db, projectId, row.github_app_installation_id ?? null)
  if (!token) {
    return { ok: false, repoConnected: true, tokenAvailable: false, reason: 'No GitHub token is stored for this project.' }
  }
  return { ok: true, repo: { ref, token, repoUrl: row.repo_url!, defaultBranchHint: row.default_branch || 'main' } }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-mushi/1.0',
  }
}

async function ghGet(token: string, url: string): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetchWithTimeout(url, { headers: headers(token) })
  } catch (err) {
    throw new RecipeGithubError(`GitHub request failed: ${String(err).slice(0, 160)}`)
  }
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function api(ref: GithubRepoRef, tail: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${tail}`
}

/** The default branch name and its head commit SHA. */
export async function getDefaultHead(repo: RecipeRepo): Promise<{ branch: string; sha: string }> {
  const info = await ghGet(repo.token, api(repo.ref, ''))
  if (info.status === 401 || info.status === 403) throw new RecipeGithubError('the stored GitHub token cannot read this repo', info.status)
  if (info.status === 404) throw new RecipeGithubError('the repo was not found, or the token cannot see it', 404)
  if (info.status !== 200) throw new RecipeGithubError(`GitHub answered ${info.status} for the repo`, info.status)
  const branch = (info.body as { default_branch?: string })?.default_branch || repo.defaultBranchHint
  const head = await ghGet(repo.token, api(repo.ref, `/commits/${encodeURIComponent(branch)}`))
  const sha = (head.body as { sha?: string } | null)?.sha
  if (head.status !== 200 || !sha) throw new RecipeGithubError(`could not resolve the head of ${branch} (${head.status})`, head.status)
  return { branch, sha }
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export type RepoFile =
  | { kind: 'file'; path: string; text: string; sha: string; size: number }
  | { kind: 'absent'; path: string }
  | { kind: 'too_large'; path: string; size: number }

/**
 * Read one file at a pinned ref. Directories, symlinks and submodules are
 * refused (the Contents API `type` must be `file`).
 */
export async function readRepoFile(repo: RecipeRepo, ref: string, rawPath: string, maxBytes: number): Promise<RepoFile> {
  const path = normalizeRepoPath(rawPath)
  if (!path) throw new RecipeGithubError(`"${rawPath}" is not a safe repo path`)
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await ghGet(repo.token, api(repo.ref, `/contents/${encoded}?ref=${encodeURIComponent(ref)}`))
  if (res.status === 404) return { kind: 'absent', path }
  if (res.status !== 200) throw new RecipeGithubError(`GitHub answered ${res.status} for ${path}`, res.status)
  if (Array.isArray(res.body)) throw new RecipeGithubError(`${path} is a directory, not a file`)
  const body = res.body as { type?: string; content?: string; encoding?: string; sha?: string; size?: number }
  if (body.type !== 'file') throw new RecipeGithubError(`${path} is a ${body.type ?? 'non-file'}, not a file`)
  const size = body.size ?? 0
  if (size > maxBytes) return { kind: 'too_large', path, size }
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new RecipeGithubError(`${path} came back without inline content`)
  }
  return { kind: 'file', path, text: decodeBase64Utf8(body.content), sha: body.sha ?? '', size }
}

export interface TreeEntry {
  path: string
  size: number
  sha: string
}

/** Every blob in the tree at `sha` (GitHub truncates very large trees). */
export async function listTree(repo: RecipeRepo, sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const res = await ghGet(repo.token, api(repo.ref, `/git/trees/${encodeURIComponent(sha)}?recursive=1`))
  if (res.status !== 200) throw new RecipeGithubError(`could not list the repo tree (${res.status})`, res.status)
  const body = res.body as { tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>; truncated?: boolean }
  const entries = (body.tree ?? [])
    .filter((e) => e.type === 'blob' && typeof e.path === 'string')
    .map((e) => ({ path: e.path as string, size: e.size ?? 0, sha: e.sha ?? '' }))
  return { entries, truncated: body.truncated === true }
}

const GRAPHQL_BATCH = 40

/**
 * Read many text files at one commit in batches of 40 per GraphQL query
 * (`object(expression: "<sha>:<path>")`). Binary or oversized blobs come back
 * as null text. A failed batch throws: a partial scan must not look complete.
 */
export async function readBlobsGraphql(repo: RecipeRepo, sha: string, paths: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (let i = 0; i < paths.length; i += GRAPHQL_BATCH) {
    const batch = paths.slice(i, i + GRAPHQL_BATCH)
    const fields = batch
      .map((p, k) => `f${k}: object(expression: ${JSON.stringify(`${sha}:${p}`)}) { ... on Blob { text isBinary isTruncated } }`)
      .join('\n')
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
    let res: Response
    try {
      res = await fetchWithTimeout('https://api.github.com/graphql', {
        method: 'POST',
        headers: { ...headers(repo.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { owner: repo.ref.owner, name: repo.ref.repo } }),
      }, 30_000)
    } catch (err) {
      throw new RecipeGithubError(`GitHub GraphQL request failed: ${String(err).slice(0, 160)}`)
    }
    const body = await res.json().catch(() => null) as { data?: { repository?: Record<string, { text?: string | null; isBinary?: boolean; isTruncated?: boolean } | null> }; errors?: Array<{ message?: string }> } | null
    if (!res.ok || !body?.data?.repository) {
      const msg = body?.errors?.[0]?.message ?? `HTTP ${res.status}`
      throw new RecipeGithubError(`GitHub GraphQL blob read failed: ${msg.slice(0, 160)}`, res.status)
    }
    batch.forEach((p, k) => {
      const blob = body.data!.repository![`f${k}`]
      out.set(p, blob && !blob.isBinary && !blob.isTruncated && typeof blob.text === 'string' ? blob.text : null)
    })
  }
  return out
}

/**
 * Names (never values) of the repo's Actions secrets and variables. A 403 is
 * an error ("cannot list"), not an empty list, so a token without the
 * secrets scope never reads as "every variable is missing".
 */
export async function listActionsNames(repo: RecipeRepo): Promise<string[]> {
  const names: string[] = []
  for (const kind of ['secrets', 'variables'] as const) {
    const res = await ghGet(repo.token, api(repo.ref, `/actions/${kind}?per_page=100`))
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new RecipeGithubError(`the token cannot list Actions ${kind} (${res.status})`, res.status)
    }
    if (res.status !== 200) throw new RecipeGithubError(`GitHub answered ${res.status} listing Actions ${kind}`, res.status)
    const list = (res.body as Record<string, Array<{ name?: string }>> | null)?.[kind] ?? []
    for (const item of list) if (typeof item.name === 'string') names.push(item.name)
  }
  return names
}
