/**
 * FILE: packages/server/supabase/functions/_shared/fix-verify-github.ts
 * PURPOSE: Verified fixes (ADR 0035): the GitHub reads and writes the
 *          fix-verifier worker and the verify routes need: a commit's check
 *          runs with their output (the **Mushi verify** result is JSON in
 *          `output.text`), whether the host has the mushi-verify workflow,
 *          the compare that decides revert safety, the revert PR, and the PR
 *          that adds the workflow.
 *
 * Every call takes the token the caller resolved; nothing here picks a token
 * or logs one.
 */

import { fetchWithTimeout } from './http.ts'
import { createPrFromFiles, ghFetch, openPullRequestForBranch } from './github-pr.ts'
import type { GithubRepoRef } from './github.ts'
import {
  revertBranchName,
  revertPrBody,
  VERIFY_WORKFLOW_PATH,
  type CompareSummary,
  type RegressionSignal,
  type VerifyCheckRunLike,
} from './fix-verify.ts'

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi/1.0',
  }
}

const api = (ref: GithubRepoRef) => `https://api.github.com/repos/${ref.owner}/${ref.repo}`

/** A path for the contents API: each segment encoded, the slashes kept. */
function contentsPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Every check run on a commit (two pages of 100 at most), with `output`.
 * Null when GitHub cannot be read: callers treat that as "not known yet".
 */
export async function listCheckRunsWithOutput(token: string, ref: GithubRepoRef, sha: string): Promise<VerifyCheckRunLike[] | null> {
  const out: VerifyCheckRunLike[] = []
  for (let page = 1; page <= 2; page++) {
    const res = await fetchWithTimeout(`${api(ref)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100&page=${page}`, { headers: headers(token) })
    if (!res.ok) return page === 1 ? null : out
    const body = (await res.json().catch(() => null)) as { check_runs?: VerifyCheckRunLike[]; total_count?: number } | null
    const runs = Array.isArray(body?.check_runs) ? body!.check_runs! : []
    out.push(...runs)
    if (runs.length < 100) break
  }
  return out
}

/** Does the repo have .github/workflows/mushi-verify.yml (on `branch`, else the default branch)? Null when unknown. */
export async function verifyWorkflowInstalled(token: string, ref: GithubRepoRef, branch: string | null): Promise<boolean | null> {
  try {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : ''
    const res = await fetchWithTimeout(`${api(ref)}/contents/${contentsPath(VERIFY_WORKFLOW_PATH)}${q}`, { headers: headers(token) })
    if (res.status === 404) return false
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { type?: string } | null
    return body?.type === 'file'
  } catch {
    return null
  }
}

/** GitHub's compare of `base...head` as revert safety reads it. Null when it cannot be read. */
export async function compareCommits(token: string, ref: GithubRepoRef, base: string, head: string): Promise<CompareSummary | null> {
  try {
    const res = await fetchWithTimeout(
      `${api(ref)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`,
      { headers: headers(token) },
    )
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as {
      status?: string
      total_commits?: number
      commits?: unknown[]
      files?: Array<{ filename?: string; previous_filename?: string }>
    } | null
    if (!body || typeof body.status !== 'string') return null
    return {
      status: body.status,
      totalCommits: typeof body.total_commits === 'number' ? body.total_commits : 0,
      commitsListed: Array.isArray(body.commits) ? body.commits.length : 0,
      files: (body.files ?? [])
        .filter((f) => typeof f.filename === 'string')
        .map((f) => ({ filename: f.filename!, previous_filename: f.previous_filename ?? null })),
    }
  } catch {
    return null
  }
}

/** The repo's default branch as GitHub names it now. */
export async function fetchDefaultBranch(token: string, ref: GithubRepoRef): Promise<string | null> {
  const res = await fetchWithTimeout(api(ref), { headers: headers(token) })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { default_branch?: string } | null
  return typeof body?.default_branch === 'string' ? body.default_branch : null
}

type TreeEntry = { path: string; mode: string; type: 'blob'; sha: string | null }

/**
 * One tree entry per file, set to its state at `parentSha`: the parent's
 * blob, or a deletion when the fix added the file. A file whose state cannot
 * be read throws, so a revert is never built from a guess.
 */
async function revertEntries(token: string, ref: GithubRepoRef, parentSha: string, paths: readonly string[]): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  for (const path of paths) {
    const res = await fetchWithTimeout(`${api(ref)}/contents/${contentsPath(path)}?ref=${encodeURIComponent(parentSha)}`, { headers: headers(token) })
    if (res.status === 404) {
      entries.push({ path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    if (!res.ok) throw new Error(`could not read ${path} before the merge (${res.status})`)
    const body = (await res.json().catch(() => null)) as { type?: string; sha?: string } | null
    if (!body || Array.isArray(body) || typeof body.sha !== 'string') throw new Error(`${path} is not a file before the merge`)
    // The contents API does not say whether a file was executable; 100644
    // is right for the source and test files a fix changes.
    entries.push({ path, mode: body.type === 'symlink' ? '120000' : '100644', type: 'blob', sha: body.sha })
  }
  return entries
}

/**
 * Open a revert PR for a Mushi merge that regressed (ADR 0035): branch
 * `mushi/revert-<short>` from the default branch's tip with one commit that
 * restores every file the fix changed to the merge commit's parent (deleting
 * files the fix added), then a PR whose body names the signal. The caller
 * has checked that no later commit touched those files. Built with the Git
 * Data API rather than `createPrFromFiles`, which can neither delete a file
 * nor carry a binary one. Never merged automatically.
 */
export async function openRevertPr(input: {
  token: string
  ref: GithubRepoRef
  defaultBranch: string
  mergeSha: string
  paths: readonly string[]
  title: string
  signal: RegressionSignal
  detail: string | null
  prUrl: string | null
}): Promise<{ url: string; number: number; branch: string }> {
  const { token, ref } = input
  const h = headers(token)
  const merge = (await ghFetch(`${api(ref)}/git/commits/${input.mergeSha}`, { headers: h })) as { parents?: Array<{ sha: string }> }
  const parentSha = merge.parents?.[0]?.sha
  if (!parentSha) throw new Error('the merge commit has no parent')
  const entries = await revertEntries(token, ref, parentSha, input.paths)

  const tip = (await ghFetch(`${api(ref)}/git/refs/heads/${encodeURIComponent(input.defaultBranch)}`, { headers: h })) as { object: { sha: string } }
  const tipCommit = (await ghFetch(`${api(ref)}/git/commits/${tip.object.sha}`, { headers: h })) as { tree: { sha: string } }
  const tree = (await ghFetch(`${api(ref)}/git/trees`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ base_tree: tipCommit.tree.sha, tree: entries }),
  })) as { sha: string }
  const commit = (await ghFetch(`${api(ref)}/git/commits`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ message: `Revert "${input.title}"\n\nThis reverts the files of commit ${input.mergeSha}.`, tree: tree.sha, parents: [tip.object.sha] }),
  })) as { sha: string }

  const branch = revertBranchName(input.mergeSha)
  try {
    await ghFetch(`${api(ref)}/git/refs`, { method: 'POST', headers: h, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('Reference already exists')) throw err
    await ghFetch(`${api(ref)}/git/refs/heads/${branch}`, { method: 'PATCH', headers: h, body: JSON.stringify({ sha: commit.sha, force: true }) })
  }
  const pr = await openPullRequestForBranch({
    token,
    owner: ref.owner,
    repo: ref.repo,
    base: input.defaultBranch,
    branch,
    title: `Revert "${input.title.slice(0, 200)}"`,
    body: revertPrBody({ signal: input.signal, detail: input.detail, prUrl: input.prUrl, mergeSha: input.mergeSha }),
    labels: ['mushi-revert'],
    markReady: true,
    headSha: commit.sha,
  })
  return { url: pr.url, number: pr.number, branch }
}

/** Open a PR that adds the filled-in mushi-verify workflow to the repo. */
export async function openVerifyWorkflowPr(input: {
  token: string
  ref: GithubRepoRef
  defaultBranch: string
  yaml: string
  now: Date
}): Promise<{ url: string; number: number; branch: string }> {
  const branch = `mushi/verify-workflow-${input.now.toISOString().slice(0, 10)}-${input.now.getTime().toString(36)}`
  const pr = await createPrFromFiles({
    token: input.token,
    owner: input.ref.owner,
    repo: input.ref.repo,
    defaultBranch: input.defaultBranch,
    branch,
    title: 'ci: add Mushi verify (proves agent fixes with a failing-then-passing test)',
    body: [
      'Adds `.github/workflows/mushi-verify.yml`.',
      '',
      'On pull requests from coding-agent branches (`cursor/`, `mushi/`, `copilot/`) it runs the tests the PR adds or changes twice: on the PR, where they must pass, and on the base branch\'s code, where they must fail. The result is a check run named **Mushi verify**. Mushi merges an agent PR on its own only when that proof passes and its other checks agree (ADR 0035).',
      '',
      'The workflow needs no Mushi secret. Add your toolchain setup (install step) where the comment says, as your CI does.',
    ].join('\n'),
    files: [{ path: VERIFY_WORKFLOW_PATH, contents: input.yaml, reason: 'add the Mushi verify workflow' }],
    markReady: true,
  })
  return { url: pr.url, number: pr.number, branch: pr.branch }
}
