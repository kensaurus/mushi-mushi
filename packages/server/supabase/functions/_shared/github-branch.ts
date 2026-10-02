/**
 * FILE: packages/server/supabase/functions/_shared/github-branch.ts
 * PURPOSE: Keep `project_repos.default_branch` true to GitHub.
 *
 * REGRESSION HISTORY (2026-10-02): every repo-connect path stored 'main' when
 * the console sent its pre-filled default, but kensaurus/mushi-mushi branches
 * from 'master'. The indexer then failed with "tree fetch 404" on every sweep
 * from 2026-06-20, the fix-worker lost its code context, and it wrote
 * apps/docs/app/layout.tsx blind (PR #424). See fix-file-guard.ts.
 *
 * Pure: `fetch` is injected and there are no Deno globals, so the vitest suite
 * can drive it with a fake.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-mushi/1.0',
  }
}

/** The repo's GitHub default branch, or the HTTP status that prevented reading it. */
export async function lookupGithubDefaultBranch(
  token: string,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; branch: string } | { ok: false; status: number }> {
  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: headers(token),
  })
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => null)) as { default_branch?: unknown } | null
  return typeof body?.default_branch === 'string' && body.default_branch.length > 0
    ? { ok: true, branch: body.default_branch }
    : { ok: false, status: 0 }
}

/**
 * The branch to store for a newly connected repo.
 *
 * The console pre-fills "main" and always sends it, so a supplied branch is
 * not proof of intent. Keep it only when it exists on GitHub; otherwise use
 * the repo's real default. When GitHub cannot be asked (no token, network,
 * no access) fall back to the supplied value or 'main'; the indexer's own
 * fallback heals the row on its first sweep.
 */
export async function resolveBranchForConnect(opts: {
  token: string | null
  owner: string
  repo: string
  requested?: string | null
  fetchImpl?: FetchLike
}): Promise<{ branch: string; source: 'requested' | 'github_default' | 'unverified' }> {
  const requested = opts.requested?.trim() || null
  const unverified = { branch: requested ?? 'main', source: 'unverified' as const }
  if (!opts.token) return unverified
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const lookup = await lookupGithubDefaultBranch(opts.token, opts.owner, opts.repo, fetchImpl)
    if (!lookup.ok) return unverified
    if (!requested || requested === lookup.branch) {
      return { branch: lookup.branch, source: 'github_default' }
    }
    const branchRes = await fetchImpl(
      `https://api.github.com/repos/${opts.owner}/${opts.repo}/branches/${encodeURIComponent(requested)}`,
      { headers: headers(opts.token) },
    )
    if (branchRes.ok) return { branch: requested, source: 'requested' }
    if (branchRes.status === 404) return { branch: lookup.branch, source: 'github_default' }
    return unverified
  } catch {
    return unverified
  }
}

export interface RepoTree {
  tree?: Array<{ path: string; type: string }>
  truncated?: boolean
}

/**
 * Fetch the recursive git tree for `branch`. When the configured branch 404s,
 * ask GitHub for the repo's default branch once and retry with it.
 * `correctedFrom` is set when the retry succeeded, so the caller can persist
 * the real branch alongside its success update.
 *
 * Error messages keep the `tree fetch <status>` prefix that
 * classifyIndexerError and the console already read, and name both branches.
 */
export async function fetchRepoTreeWithBranchFallback(opts: {
  token: string
  owner: string
  repo: string
  branch: string
  fetchImpl?: FetchLike
}): Promise<{ tree: RepoTree; branch: string; correctedFrom: string | null }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const treeUrl = (b: string) =>
    `https://api.github.com/repos/${opts.owner}/${opts.repo}/git/trees/${encodeURIComponent(b)}?recursive=1`

  const first = await fetchImpl(treeUrl(opts.branch), { headers: headers(opts.token) })
  if (first.ok) {
    return { tree: (await first.json()) as RepoTree, branch: opts.branch, correctedFrom: null }
  }
  if (first.status !== 404) throw new Error(`tree fetch ${first.status}`)

  const lookup = await lookupGithubDefaultBranch(opts.token, opts.owner, opts.repo, fetchImpl)
  if (!lookup.ok) {
    throw new Error(
      lookup.status === 404
        ? `tree fetch 404: repository ${opts.owner}/${opts.repo} is not accessible with this token`
        : `tree fetch 404 for branch '${opts.branch}'; default-branch lookup failed (${lookup.status})`,
    )
  }
  if (lookup.branch === opts.branch) {
    throw new Error(`tree fetch 404 for branch '${opts.branch}' (the repo's GitHub default)`)
  }

  const retry = await fetchImpl(treeUrl(lookup.branch), { headers: headers(opts.token) })
  if (!retry.ok) {
    throw new Error(
      `tree fetch ${retry.status} for GitHub default branch '${lookup.branch}' ` +
        `(configured branch '${opts.branch}' returned 404)`,
    )
  }
  return { tree: (await retry.json()) as RepoTree, branch: lookup.branch, correctedFrom: opts.branch }
}
