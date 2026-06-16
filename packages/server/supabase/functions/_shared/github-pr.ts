/**
 * FILE: packages/server/supabase/functions/_shared/github-pr.ts
 * PURPOSE: Generic GitHub branch + commit + draft-PR helpers shared between
 *          `fix-worker` and `sdk-upgrade-worker`.
 *
 * Why not Octokit: Deno edge bundles ship 40 kB of plain code; Octokit weighs
 * ~350 kB transitively and pulls Node polyfills that don't run in the edge
 * runtime. These three REST calls are straightforward to hand-roll.
 */

import { markPullRequestReady } from './github.ts'

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

export async function ghFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub ${init.method ?? 'GET'} ${url} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function ghFetchOptional(url: string, init: RequestInit): Promise<unknown | null> {
  const res = await fetch(url, init)
  if (res.status === 404) return null
  if (!res.ok) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// PR creation
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string
  contents: string
  reason: string
}

export interface CreatePrOptions {
  token: string
  owner: string
  repo: string
  defaultBranch: string
  branch: string
  title: string
  body: string
  files: FileChange[]
  labels?: string[]
}

export interface PrResult {
  url: string
  number: number
  branch: string
  commitSha: string
}

type SimpleLogger = {
  info: (msg: string, ctx?: unknown) => void
  warn: (msg: string, ctx?: unknown) => void
}

const noopLog: SimpleLogger = {
  info: () => {},
  warn: () => {},
}

/**
 * Create a GitHub branch, commit the given files, open a draft PR, and
 * immediately mark it ready-for-review so CI can run.
 *
 * Returns the PR URL, number, branch, and last commit SHA.
 */
export async function createPrFromFiles(
  opts: CreatePrOptions,
  log: SimpleLogger = noopLog,
): Promise<PrResult> {
  const { token, owner, repo, defaultBranch, branch, title, body, files, labels = [] } = opts

  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi/1.0',
  }

  // Fetch the SHA of the default branch tip so we can branch from it.
  const refRes = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
    { headers: baseHeaders },
  )
  const baseSha = (refRes as { object: { sha: string } }).object.sha

  // Create the new branch (idempotent — retry-safe).
  try {
    await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('Reference already exists')) throw err
    log.info('github-pr: branch already exists, continuing', { branch })
  }

  // Commit each file sequentially. Sequential is intentional: keeps the
  // git log readable and avoids racing the GitHub rate limit.
  let lastCommitSha = baseSha
  for (const file of files) {
    const existing = await ghFetchOptional(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(branch)}`,
      { headers: baseHeaders },
    )
    const existingSha =
      existing && typeof (existing as Record<string, unknown>).sha === 'string'
        ? (existing as { sha: string }).sha
        : undefined

    const putRes = (await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}`,
      {
        method: 'PUT',
        headers: baseHeaders,
        body: JSON.stringify({
          message: `mushi: ${file.reason}`,
          content: btoa(unescape(encodeURIComponent(file.contents))),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    )) as { commit: { sha: string } }
    lastCommitSha = putRes.commit.sha
  }

  // Open the draft PR.
  const prRes = (await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ title, head: branch, base: defaultBranch, draft: true, body }),
  })) as { number: number; html_url: string }

  // Lift draft gate so CI runs and the console merge API works.
  const readyResult = await markPullRequestReady(token, { owner, repo }, prRes.number)
  if (!readyResult.ok) {
    log.warn('github-pr: could not mark PR ready for review', {
      prNumber: prRes.number,
      message: readyResult.message,
    })
  } else if (!readyResult.alreadyReady) {
    log.info('github-pr: marked draft PR ready for review', { prNumber: prRes.number })
  }

  // Best-effort labels.
  if (labels.length > 0) {
    await ghFetchOptional(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prRes.number}/labels`,
      {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({ labels }),
      },
    )
  }

  return {
    url: prRes.html_url,
    number: prRes.number,
    branch,
    commitSha: lastCommitSha,
  }
}

/**
 * Generate a branch name for a fix-worker PR from a template or fall back to
 * the legacy `mushi/fix-{shortId}-{ts36}` scheme.
 * Tokens: {date}, {category}, {shortId}.
 */
export function generateFixBranchName(
  reportId: string,
  template?: string | null,
  category?: string | null,
): string {
  const effectiveTemplate = template && template.trim().length > 0 ? template.trim() : null
  if (!effectiveTemplate) {
    return `mushi/fix-${reportId.slice(0, 8)}-${Date.now().toString(36)}`
  }
  const date = new Date().toISOString().slice(0, 10)
  const categorySlug = (category ?? 'fix')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
  const shortId = reportId.slice(0, 8)
  return effectiveTemplate
    .replace('{date}', date)
    .replace('{category}', categorySlug)
    .replace('{shortId}', shortId)
}
