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
  /** Report UUID for conventional commit scope (fix(MUSHI-<id>)). */
  reportId?: string
  /** Report category for commit type prefix mapping. */
  category?: string | null
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
  const {
    token,
    owner,
    repo,
    defaultBranch,
    branch,
    title,
    body,
    files,
    labels = [],
    reportId,
    category,
  } = opts

  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi/1.0',
  }

  // Fetch the SHA of the default branch tip so we can branch from it.
  // If the stored defaultBranch doesn't exist (stale DB value or repo renamed
  // from 'master' → 'main'), resolve the live default branch from the GitHub
  // API and use that instead. This prevents silent branch-from-wrong-base errors.
  let resolvedBase = defaultBranch
  let baseSha: string
  try {
    const refRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
      { headers: baseHeaders },
    )
    baseSha = (refRes as { object: { sha: string } }).object.sha
  } catch {
    // Stored defaultBranch not found — resolve live from GitHub API.
    log.warn('github-pr: stored defaultBranch not found, resolving from GitHub API', {
      storedBranch: defaultBranch,
    })
    const repoInfo = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: baseHeaders,
    })
    resolvedBase = (repoInfo as { default_branch: string }).default_branch
    const refRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${resolvedBase}`,
      { headers: baseHeaders },
    )
    baseSha = (refRes as { object: { sha: string } }).object.sha
    log.info('github-pr: resolved live default branch', { resolvedBase })
  }

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
          message: formatFixCommitMessage(file.reason, reportId, category),
          content: btoa(unescape(encodeURIComponent(file.contents))),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    )) as { commit: { sha: string } }
    lastCommitSha = putRes.commit.sha
  }

  // Open the draft PR targeting the resolved base (may differ from stored defaultBranch).
  const prRes = (await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ title, head: branch, base: resolvedBase, draft: true, body }),
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

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'mushi-mushi/1.0',
})

export interface OpenPrRef {
  number: number
  url: string
  headRef: string
}

/**
 * Find the newest OPEN pull request whose head branch starts with `headPrefix`
 * AND was authored by a machine account (GitHub App bot).
 *
 * Used to dedupe machine-generated PRs (e.g. SDK upgrades) so repeat runs reuse
 * the existing PR instead of stacking duplicates. The result is later persisted
 * as the job's `pr_url` and is the target of the console one-click merge-to-main.
 *
 * SECURITY — provenance check (`user.type === 'Bot'`): branch names are not a
 * trust boundary. A repo collaborator could push `mushi/sdk-upgrade-evil` and
 * open a PR with arbitrary changes; without this filter Mushi would adopt that
 * PR as "the SDK upgrade" and an operator's one-click merge would land attacker
 * code on the default branch (confused-deputy). Mushi opens upgrade PRs with the
 * GitHub App installation token, so they are always bot-authored; a
 * human-authored PR on the same branch family is therefore never reused/merged.
 *
 * GitHub returns pulls newest-first by default, so the first match is the most
 * recent open machine PR for that branch family.
 */
export async function findOpenPrByHeadPrefix(
  token: string,
  owner: string,
  repo: string,
  headPrefix: string,
): Promise<OpenPrRef | null> {
  const res = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=created&direction=desc`,
    { headers: ghHeaders(token) },
  )
  if (!Array.isArray(res)) return null
  for (const pr of res as Array<{
    number: number
    html_url: string
    head?: { ref?: string }
    user?: { type?: string } | null
  }>) {
    const ref = pr.head?.ref ?? ''
    if (!ref.startsWith(headPrefix)) continue
    // Only trust machine-authored PRs (see SECURITY note above).
    if (pr.user?.type !== 'Bot') continue
    return { number: pr.number, url: pr.html_url, headRef: ref }
  }
  return null
}

/**
 * Commit (create-or-update) a set of files onto an EXISTING branch. Mirrors the
 * per-file PUT loop in {@link createPrFromFiles} but skips branch + PR creation —
 * used to refresh an already-open PR's branch in place.
 *
 * Returns the last commit SHA.
 */
export async function commitFilesToBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: FileChange[],
  log: SimpleLogger = noopLog,
  reportId?: string,
  category?: string | null,
): Promise<string> {
  const baseHeaders = ghHeaders(token)
  let lastCommitSha = ''
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
          message: formatFixCommitMessage(file.reason, reportId, category),
          content: btoa(unescape(encodeURIComponent(file.contents))),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    )) as { commit: { sha: string } }
    lastCommitSha = putRes.commit.sha
  }
  log.info('github-pr: refreshed files on existing branch', { branch, files: files.length })
  return lastCommitSha
}

/** Conventional branch prefix regex (GitFlow-style). */
export const FIX_BRANCH_REGEX =
  /^(feature|bugfix|hotfix|refactor|chore|docs|test|ci)\/[a-z0-9][a-z0-9-]*$/

/** Branch names must include the full report id for traceability. */
export const FIX_BRANCH_MUSHI_ID_REGEX =
  /^(feature|bugfix|hotfix|refactor|chore|docs|test|ci)\/MUSHI-[a-f0-9-]+-[a-z0-9][a-z0-9-]*$/

function categoryToBranchPrefix(category?: string | null): string {
  const c = (category ?? 'bug').toLowerCase()
  if (c === 'slow') return 'bugfix'
  if (c === 'visual' || c === 'confusing') return 'bugfix'
  if (c === 'other') return 'chore'
  if (
    c === 'feature' ||
    c === 'bugfix' ||
    c === 'hotfix' ||
    c === 'refactor' ||
    c === 'chore' ||
    c === 'docs' ||
    c === 'test' ||
    c === 'ci'
  ) {
    return c
  }
  return 'bugfix'
}

function slugifyDescription(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'fix'
}

export function validateFixBranchName(name: string): void {
  if (!FIX_BRANCH_MUSHI_ID_REGEX.test(name)) {
    throw new Error(
      `Branch name "${name}" does not match required pattern ${FIX_BRANCH_MUSHI_ID_REGEX.source}`,
    )
  }
}

export function validateFixBranchTemplate(template: string): void {
  const sample = template
    .replace('{date}', '2026-06-23')
    .replace('{category}', 'ui-bug')
    .replace('{shortId}', 'abc12345')
    .replace('{reportId}', '00000000-0000-4000-8000-000000000001')
  if (!FIX_BRANCH_MUSHI_ID_REGEX.test(sample)) {
    throw new Error(
      `fix_branch_template must compile to <type>/MUSHI-<reportId>-<slug>; got sample "${sample}"`,
    )
  }
}

export function formatFixCommitMessage(
  reason: string,
  reportId?: string,
  category?: string | null,
): string {
  const scope = reportId ? `MUSHI-${reportId}` : 'mushi'
  const prefix = categoryToBranchPrefix(category)
  const trimmed = reason.trim().slice(0, 200)
  return `${prefix}(${scope}): ${trimmed}`
}

export function formatFixPrTitle(summary: string, reportId: string): string {
  const trimmed = summary.trim().slice(0, 120)
  return `fix(MUSHI-${reportId}): ${trimmed}`
}

/**
 * Generate a spec-compliant branch name: <type>/MUSHI-<reportId>-<slug>.
 * Optional template tokens: {date}, {category}, {shortId}, {reportId}, {slug}.
 */
export function generateFixBranchName(
  reportId: string,
  template?: string | null,
  category?: string | null,
  descriptionSlug?: string | null,
): string {
  const prefix = categoryToBranchPrefix(category)
  const slug = slugifyDescription(descriptionSlug ?? category ?? 'fix')
  const defaultName = `${prefix}/MUSHI-${reportId}-${slug}`

  const effectiveTemplate = template && template.trim().length > 0 ? template.trim() : null
  if (!effectiveTemplate) {
    validateFixBranchName(defaultName)
    return defaultName
  }

  const date = new Date().toISOString().slice(0, 10)
  const categorySlug = slugifyDescription(category ?? 'fix', 20)
  const shortId = reportId.slice(0, 8)
  const fromTemplate = effectiveTemplate
    .replace('{date}', date)
    .replace('{category}', categorySlug)
    .replace('{shortId}', shortId)
    .replace('{reportId}', reportId)
    .replace('{slug}', slug)

  try {
    validateFixBranchName(fromTemplate)
    return fromTemplate
  } catch (templateErr) {
    // The stored fix_branch_template produced an invalid branch name. Fall back to the safe
    // default so the fix-worker can continue, but surface the bad template so it gets cleaned up.
    console.warn(
      `[fix-worker] fix_branch_template "${effectiveTemplate}" produced invalid branch name` +
        ` "${fromTemplate}" — falling back to default "${defaultName}".` +
        ` Template error: ${(templateErr as Error).message}`,
    )
    validateFixBranchName(defaultName)
    return defaultName
  }
}

export function generateCursorCloudBranchName(reportId: string, category?: string | null): string {
  const prefix = categoryToBranchPrefix(category)
  const name = `${prefix}/MUSHI-${reportId}-cursor-cloud`
  validateFixBranchName(name)
  return name
}
