/**
 * FILE: packages/server/supabase/functions/_shared/github.ts
 * PURPOSE: GitHub auth helpers shared between `webhooks-github-indexer`,
 *          `fix-worker`, and `ci-sync`. Keeps one implementation of the JWT
 *          → installation-token dance and the PAT-fallback so a token format
 *          fix lands once and flows everywhere.
 *
 * Why not Octokit: Deno edge bundles ship 40kB of plain code; Octokit weighs
 * ~350kB transitively and pulls Node polyfills that don't run in the edge
 * runtime. The JWT is trivial to mint by hand with Web Crypto + RSA-PKCS1-v1_5.
 */

import { fetchWithTimeout } from './http.ts'
import type { getServiceClient } from './db.ts'
import { isOperatorProject } from './operator-gate.ts'

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Mint a short-lived installation access token for the given GitHub App
 * installation. Tokens are valid for ~60 min per GitHub's contract; we
 * never cache them because each edge invocation is cheap and re-minting
 * is the simplest way to avoid "token expired mid-run" flakes.
 *
 * @throws if GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY are unset, or if
 *         GitHub returns non-2xx (caller should fall back to PAT).
 */
export async function mintInstallationToken(installationId: number): Promise<string> {
  return (await mintInstallationAccess(installationId)).token
}

/**
 * The same mint, also returning the installation's permissions as GitHub
 * states them in the answer (`{ contents: 'write', actions: 'read', … }`).
 * Setup gaps read them to say what the App can do before anything needs it.
 */
export async function mintInstallationAccess(installationId: number): Promise<{ token: string; permissions: Record<string, string> | null }> {
  // An installation token lives an hour. Reuse it until 5 minutes before it
  // expires, and share one mint between concurrent callers: the Apps page
  // composed 10 cards on one installation and minted 10 tokens per view
  // (2026-10-31, 13.9 s against the console's 15 s limit).
  const now = Date.now()
  const hit = installationTokenCache.get(installationId)
  if (hit && hit.expiresMs - now > INSTALLATION_TOKEN_REUSE_MARGIN_MS) return hit.access
  const pending = installationTokenInflight.get(installationId)
  if (pending) return pending
  const minting = mintInstallationAccessUncached(installationId)
    .then(({ access, expiresMs }) => {
      installationTokenCache.set(installationId, { access, expiresMs })
      return access
    })
    .finally(() => installationTokenInflight.delete(installationId))
  installationTokenInflight.set(installationId, minting)
  return minting
}

type InstallationAccess = { token: string; permissions: Record<string, string> | null }
const INSTALLATION_TOKEN_REUSE_MARGIN_MS = 5 * 60_000
const installationTokenCache = new Map<number, { access: InstallationAccess; expiresMs: number }>()
const installationTokenInflight = new Map<number, Promise<InstallationAccess>>()

/** Forget cached installation tokens (tests). */
export function clearInstallationTokenCache(): void {
  installationTokenCache.clear()
  installationTokenInflight.clear()
}

async function mintInstallationAccessUncached(installationId: number): Promise<{ access: InstallationAccess; expiresMs: number }> {
  const appId = Deno.env.get('GITHUB_APP_ID')
  const pem = Deno.env.get('GITHUB_APP_PRIVATE_KEY')
  if (!appId || !pem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 30, exp: now + 540, iss: appId }
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const data = `${enc(header)}.${enc(payload)}`

  const key = await importPkcs8(pem)
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(data))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const jwt = `${data}.${sigB64}`

  const res = await fetchWithTimeout(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) throw new Error(`installation token mint failed: ${res.status}`)
  const body = await res.json() as { token: string; expires_at?: string; permissions?: Record<string, string> }
  // GitHub states the expiry; without a readable one, assume the shortest
  // reuse that still helps one page view (10 minutes).
  const stated = body.expires_at ? Date.parse(body.expires_at) : NaN
  return {
    access: { token: body.token, permissions: body.permissions && typeof body.permissions === 'object' ? body.permissions : null },
    expiresMs: Number.isFinite(stated) ? stated : Date.now() + 15 * 60_000,
  }
}

/**
 * Resolve a GitHub token for a project, preferring the App installation if
 * the caller provides one. Order:
 *   1. `installationId` (when present, try App mint; on failure fall through)
 *   2. `project_settings.github_installation_token_ref` — PAT stored in vault
 *   3. `organization_integration_settings.github_installation_token_ref` — org default
 *   4. `GITHUB_TOKEN` env fallback (self-host / founder dogfood)
 *
 * Returns null when nothing resolves — callers should surface a "connect
 * GitHub" error rather than proceed with an unauthenticated request.
 */
/**
 * The GitHub App installation that owns a fix attempt's repository. Attempts
 * rarely carry repo_id, so without the PR-URL match every console merge fell
 * back to the project's stored token, which cannot run the GraphQL
 * markPullRequestReadyForReview mutation: a draft PR (glot.it #141) answered 409.
 */
export async function installationIdForAttempt(
  db: ReturnType<typeof getServiceClient>,
  attempt: { project_id: string; repo_id?: string | null; pr_url?: string | null },
): Promise<number | null> {
  const toId = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  if (attempt.repo_id) {
    const { data } = await db
      .from('project_repos')
      .select('github_app_installation_id')
      .eq('id', attempt.repo_id)
      .maybeSingle()
    return toId(data?.github_app_installation_id)
  }
  const prRepo = attempt.pr_url ? parseGithubRepoUrl(attempt.pr_url.split('/pull/')[0]) : null
  const { data: repos } = await db
    .from('project_repos')
    .select('repo_url, is_primary, github_app_installation_id')
    .eq('project_id', attempt.project_id)
  const rows = (repos ?? []) as Array<{ repo_url: string | null; is_primary: boolean | null; github_app_installation_id: unknown }>
  const match = prRepo
    ? rows.find((r) => {
        const ref = parseGithubRepoUrl(r.repo_url ?? '')
        return ref != null && ref.owner.toLowerCase() === prRepo.owner.toLowerCase() &&
          ref.repo.toLowerCase() === prRepo.repo.toLowerCase()
      })
    : rows.find((r) => r.is_primary)
  return toId(match?.github_app_installation_id)
}

/** The GitHub App installation bound to one of the project's repos (owner/repo), else its primary repo's. */
export async function installationIdForRepo(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repoFullName?: string | null,
): Promise<number | null> {
  const { data } = await db
    .from('project_repos')
    .select('repo_url, is_primary, github_app_installation_id')
    .eq('project_id', projectId)
  const rows = (data ?? []) as Array<{ repo_url: string | null; is_primary: boolean | null; github_app_installation_id: unknown }>
  const want = repoFullName?.toLowerCase() ?? null
  const match = want
    ? rows.find((r) => {
        const ref = parseGithubRepoUrl(r.repo_url ?? '')
        return ref != null && `${ref.owner}/${ref.repo}`.toLowerCase() === want
      })
    : rows.find((r) => r.is_primary)
  const id = Number(match?.github_app_installation_id)
  return id > 0 ? id : null
}

/**
 * The token for changing a repo's Actions variables (CI placement, ADR 0037):
 * the project's or organization's stored token first (the owner chose it for
 * this), else the GitHub App installation bound to that repo. Never the
 * platform token. The App needs "Variables: Read and write" for writes; act()
 * says so plainly when GitHub answers 403.
 */
export async function placementGithubToken(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repoFullName?: string | null,
): Promise<string | null> {
  const stored = await resolveProjectGithubToken(db, projectId, null, { allowEnvFallback: false })
  if (stored) return stored
  const installationId = await installationIdForRepo(db, projectId, repoFullName)
  if (!installationId) return null
  try {
    return await mintInstallationToken(installationId)
  } catch {
    return null
  }
}

export async function resolveProjectGithubToken(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  installationId: number | null = null,
  opts: {
    /**
     * false = never fall back to the platform `GITHUB_TOKEN`. Routes that hand
     * repo contents to the caller (digest, diagram) pass false: otherwise any
     * project could point repo_url at a repo only the platform token can read.
     */
    allowEnvFallback?: boolean
  } = {},
): Promise<string | null> {
  if (installationId && installationId > 0) {
    try {
      return await mintInstallationToken(installationId)
    } catch {
      // Fall through to PAT; a failed mint is not necessarily fatal if the
      // project has a PAT stored as a belt-and-braces fallback.
    }
  }

  const resolveRef = async (ref: string): Promise<string | null> => {
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length)
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id })
      return !vaultErr && typeof secret === 'string' && secret.length > 0 ? secret : null
    }
    return ref.length > 0 ? ref : null
  }

  // Step 1: project-level setting.
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!error && data?.github_installation_token_ref) {
    const resolved = await resolveRef(String(data.github_installation_token_ref))
    if (resolved) return resolved
  }

  // Step 2: org-level default.
  const { data: projectRow } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle()
  const orgId = (projectRow as { organization_id: string | null } | null)?.organization_id ?? null
  if (orgId) {
    const { data: orgRow } = await db
      .from('organization_integration_settings')
      .select('github_installation_token_ref')
      .eq('organization_id', orgId)
      .maybeSingle()
    if (orgRow?.github_installation_token_ref) {
      const resolved = await resolveRef(String(orgRow.github_installation_token_ref))
      if (resolved) return resolved
    }
  }

  // Step 3: the platform token, for the operator's own apps only.
  if (opts.allowEnvFallback === false) return null
  return platformGithubTokenFor(db, projectId)
}

/**
 * The platform `GITHUB_TOKEN` is the operator's own GitHub credential, so only
 * a project whose owner is an operator (MUSHI_OPERATOR_USER_IDS) may use it,
 * as with the env Slack bot (`isOperatorProject`). Every other app brings its
 * own GitHub App install or token. Self-hosters list their user id in
 * MUSHI_OPERATOR_USER_IDS. Fails closed.
 */
export async function platformGithubTokenFor(
  db: unknown,
  projectId: string | null | undefined,
): Promise<string | null> {
  const token = Deno.env.get('GITHUB_TOKEN')
  if (!token) return null
  return (await isOperatorProject(db as never, projectId)) ? token : null
}

export interface GithubRepoRef {
  owner: string
  repo: string
}

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s#?]+?)(?:\.git)?\/?$/i

export function parseGithubRepoUrl(url: string | null | undefined): GithubRepoRef | null {
  if (!url) return null
  const match = GITHUB_URL_RE.exec(url.trim())
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export interface PullRequestSnapshot {
  number: number
  draft: boolean
  state: string
  merged: boolean
  nodeId?: string | null
  /** ISO time GitHub closed (or merged) the PR; null while open. */
  closedAt?: string | null
  /** ISO time GitHub merged the PR; null unless merged. */
  mergedAt?: string | null
  /** Current head commit; CI runs against this, not the first fix commit. */
  headSha?: string | null
  /** GitHub's `mergeable_state` (`clean`, `behind`, `blocked`, `dirty`, …); null while GitHub computes it. */
  mergeableState?: string | null
  /**
   * The base repository as GitHub names it now (`base.repo`). A renamed repo
   * still answers under its old URL, so the id and current full name are the
   * PR's identity, not the URL it was read through.
   */
  baseRepoId?: number | null
  baseRepoFullName?: string | null
}

export interface PullRequestDetails extends PullRequestSnapshot {
  /** PR title and description (agent-written for cloud-agent PRs: untrusted). */
  title?: string | null
  body?: string | null
  htmlUrl: string | null
  headRef: string | null
  headSha: string | null
  baseRef: string | null
  /**
   * The head repository (`head.repo`). A PR from a fork has a head repo
   * different from its base repo; review follow-ups (ADR 0032) refuse those.
   * Null when GitHub sends none (a deleted fork).
   */
  headRepoId?: number | null
  headRepoFullName?: string | null
  mergeable: boolean | null
  mergeableState: string | null
}

function githubAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Fetch minimal PR metadata — used before merge to detect draft state. */
/** Cloud agents hand back only a PR URL; the console merge needs the number. */
export function prNumberFromUrl(url: string): number | null {
  const n = Number(url.match(/\/pull\/(\d+)/)?.[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

type BaseRepoBody = { ref?: string; repo?: { id?: number; full_name?: string } | null }

/** `base.repo` of a pull request payload, as `baseRepoId` / `baseRepoFullName`. */
export function baseRepoOf(base: BaseRepoBody | undefined): { baseRepoId: number | null; baseRepoFullName: string | null } {
  const id = base?.repo?.id
  const name = base?.repo?.full_name
  return {
    baseRepoId: typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null,
    baseRepoFullName: typeof name === 'string' && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) ? name : null,
  }
}

export async function fetchPullRequest(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
): Promise<PullRequestSnapshot | null> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}`,
    { headers: githubAuthHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`pull fetch ${res.status}`)
  const body = await res.json() as {
    number?: number
    draft?: boolean
    state?: string
    merged?: boolean
    node_id?: string
    closed_at?: string | null
    merged_at?: string | null
    head?: { sha?: string }
    base?: BaseRepoBody
    mergeable_state?: string | null
  }
  return {
    number: body.number ?? pullNumber,
    draft: body.draft === true,
    state: body.state ?? 'open',
    merged: body.merged === true,
    nodeId: body.node_id ?? null,
    closedAt: body.closed_at ?? null,
    mergedAt: body.merged_at ?? null,
    headSha: body.head?.sha ?? null,
    mergeableState: body.mergeable_state ?? null,
    ...baseRepoOf(body.base),
  }
}

/**
 * GitHub's "Update branch": merges the base into the PR branch. True when
 * GitHub accepted it (202); false on a conflict or any other refusal. Pinned
 * to the head the caller saw, so a newer push is never merged over.
 */
export async function updatePullRequestBranch(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
  expectedHeadSha: string | null,
): Promise<boolean> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}/update-branch`,
    {
      method: 'PUT',
      headers: { ...githubAuthHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(expectedHeadSha ? { expected_head_sha: expectedHeadSha } : {}),
    },
  ).catch(() => null)
  return res?.status === 202
}

export async function fetchPullRequestDetails(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
): Promise<PullRequestDetails | null> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}`,
    { headers: githubAuthHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`pull fetch ${res.status}`)
  const body = await res.json() as {
    number?: number
    draft?: boolean
    state?: string
    merged?: boolean
    node_id?: string
    html_url?: string
    title?: string | null
    body?: string | null
    head?: { ref?: string; sha?: string; repo?: { id?: number; full_name?: string } | null }
    base?: BaseRepoBody
    mergeable?: boolean | null
    mergeable_state?: string | null
  }
  return {
    number: body.number ?? pullNumber,
    draft: body.draft === true,
    state: body.state ?? 'open',
    merged: body.merged === true,
    nodeId: body.node_id ?? null,
    title: typeof body.title === 'string' ? body.title : null,
    body: typeof body.body === 'string' ? body.body : null,
    htmlUrl: body.html_url ?? null,
    headRef: body.head?.ref ?? null,
    headSha: body.head?.sha ?? null,
    baseRef: body.base?.ref ?? null,
    ...baseRepoOf(body.base),
    ...(() => {
      const head = baseRepoOf({ repo: body.head?.repo ?? null })
      return { headRepoId: head.baseRepoId, headRepoFullName: head.baseRepoFullName }
    })(),
    mergeable: body.mergeable ?? null,
    mergeableState: body.mergeable_state ?? null,
  }
}

export interface PullRequestFile {
  filename: string
  /** The path before a rename (`previous_filename`), when GitHub sends one. */
  previousFilename?: string | null
  status: string
  additions: number
  deletions: number
  patch: string | null
}

/**
 * List a PR's changed files (`GET /pulls/:n/files`, 100 per page). Stops at
 * `maxPages`; `complete` is false when GitHub had more, so a caller never
 * mistakes a truncated list for the whole change. Null when the PR is gone.
 */
export async function fetchPullRequestFiles(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
  opts: { maxPages?: number } = {},
): Promise<{ files: PullRequestFile[]; complete: boolean } | null> {
  const maxPages = opts.maxPages ?? 3
  const files: PullRequestFile[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      { headers: githubAuthHeaders(token) },
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`pull files fetch ${res.status}`)
    const body = await res.json() as Array<{
      filename?: string
      status?: string
      additions?: number
      deletions?: number
      patch?: string
      previous_filename?: string
    }>
    if (!Array.isArray(body)) throw new Error('pull files fetch returned a non-array body')
    for (const f of body) {
      if (typeof f.filename !== 'string') continue
      files.push({
        filename: f.filename,
        previousFilename: typeof f.previous_filename === 'string' ? f.previous_filename : null,
        status: f.status ?? 'modified',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch: typeof f.patch === 'string' ? f.patch : null,
      })
    }
    if (body.length < 100) return { files, complete: true }
  }
  return { files, complete: false }
}

/**
 * Convert a draft PR to "ready for review" so CI can run and the merge API
 * accepts squash-merge. GitHub blocks merge on draft PRs even when checks pass.
 * Idempotent — no-ops when the PR is already non-draft.
 */
export async function markPullRequestReady(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
): Promise<{ ok: boolean; alreadyReady: boolean; message?: string }> {
  const existing = await fetchPullRequest(token, ref, pullNumber)
  if (!existing) {
    return { ok: false, alreadyReady: false, message: 'Pull request not found' }
  }
  if (existing.merged || existing.state === 'closed') {
    return { ok: true, alreadyReady: true, message: 'Pull request already closed or merged' }
  }
  if (!existing.draft) {
    return { ok: true, alreadyReady: true }
  }

  const nodeId = existing.nodeId
  if (!nodeId) {
    return { ok: false, alreadyReady: false, message: 'Pull request missing node_id for ready mutation' }
  }

  // REST PATCH { draft: false } does not reliably undraft on GitHub; the
  // supported path is the GraphQL markPullRequestReadyForReview mutation (same as
  // `gh pr ready`).
  const gqlRes = await fetchWithTimeout('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...githubAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation MarkPullRequestReadyForReview($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
      variables: { id: nodeId },
    }),
  })
  const gqlBody = await gqlRes.json().catch(() => ({})) as {
    data?: { markPullRequestReadyForReview?: { pullRequest?: { isDraft?: boolean } } }
    errors?: Array<{ message?: string }>
  }
  if (gqlBody.errors?.length) {
    return {
      ok: false,
      alreadyReady: false,
      message: gqlBody.errors.map((e) => e.message).filter(Boolean).join('; ') || 'GraphQL ready failed',
    }
  }
  const stillDraft = gqlBody.data?.markPullRequestReadyForReview?.pullRequest?.isDraft
  if (stillDraft === true) {
    return { ok: false, alreadyReady: false, message: 'Pull request is still a draft after ready mutation' }
  }
  return { ok: true, alreadyReady: false }
}

export interface CheckRunSnapshot {
  status: string | null
  conclusion: string | null
}

/**
 * Pull the latest check-run conclusion for a commit. GitHub returns the full
 * list; we collapse to a single { status, conclusion } using the same rules
 * the UI uses:
 *   - If any check-run or commit status is not finished → status stays
 *     pending and conclusion stays null (the PR is not done).
 *   - Otherwise the worst failing conclusion, else `success` when any run
 *     succeeded (skipped and neutral pass, as on GitHub; collapseCheckRuns).
 *   - Legacy commit statuses count too (Buildkite, CircleCI, Vercel…).
 *   - A run a later re-run of the same check replaced is left out first
 *     (currentCheckRuns), as GitHub's merge state does.
 *   - Check runs from an older Actions run of the same workflow are left
 *     out too. GitHub scores only the newest run per workflow; the list
 *     still includes the older one (report 9e2ec6f0).
 */
export async function fetchLatestCheckRun(
  token: string,
  ref: GithubRepoRef,
  commitSha: string,
): Promise<CheckRunSnapshot | null> {
  const [runs, statuses] = await Promise.all([
    listCheckRuns(token, ref, commitSha, 'throw'),
    listCommitStatuses(token, ref, commitSha),
  ])
  if (!runs) return null
  return collapseCheckRuns(await withoutSupersededWorkflowRunsFromGithub(token, ref, commitSha, runs), statuses)
}

/**
 * Names of the check runs that failed (failure / timed_out) on the latest
 * commit of `gitRef` (a branch name or a SHA), with `filter=latest`. Advisory
 * runs (Copilot review) are left out. Null when the list cannot be read.
 * The CI-repair follow-up (ADR 0032 amendment) uses it to leave alone a
 * check that is red on the base branch too.
 */
export async function fetchFailingCheckNames(
  token: string,
  ref: GithubRepoRef,
  gitRef: string,
): Promise<Set<string> | null> {
  const listed = await listCheckRuns(token, ref, gitRef, 'null')
  if (!listed) return null
  const runs = await withoutSupersededWorkflowRunsFromGithub(token, ref, gitRef, listed)
  return new Set(
    currentCheckRuns(runs)
      .filter((r) => !isAdvisoryCheckRun(r) && (r.conclusion === 'failure' || r.conclusion === 'timed_out'))
      .map((r) => String(r.name ?? ''))
      .filter(Boolean),
  )
}

export interface CheckRunLike {
  name?: string | null
  status: string | null
  conclusion: string | null
  started_at?: string | null
  completed_at?: string | null
  /** For Actions jobs: .../actions/runs/<run id>/job/<job id>. */
  details_url?: string | null
  app?: { id?: number | null; slug?: string | null } | null
  check_suite?: { id?: number | null } | null
}

/** One Actions workflow run on a commit, as `actions/runs?head_sha=` returns it. */
export interface WorkflowRunOnHead {
  id: number
  workflow_id: number | null
  /** Latest check suite of this run. Older attempts keep their own suite id. */
  check_suite_id: number | null
  created_at: string | null
}

function actionsRunId(r: CheckRunLike): string | null {
  return r.details_url?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null
}

function actionsRunNumericId(r: CheckRunLike): number | null {
  const s = actionsRunId(r)
  if (!s) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

const COMMIT_SHA_RE = /^[0-9a-f]{7,64}$/i

async function listCheckRuns(
  token: string,
  ref: GithubRepoRef,
  gitRef: string,
  onError: 'throw' | 'null',
): Promise<CheckRunLike[] | null> {
  const all: CheckRunLike[] = []
  // A large matrix has more than 100 runs; a red job on page 2 must count.
  for (let page = 1; page <= CHECK_RUN_PAGES; page++) {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(gitRef)}/check-runs?per_page=100&filter=latest&page=${page}`,
      { headers: githubAuthHeaders(token) },
    )
    if (res.status === 404 && page === 1) return null
    if (!res.ok) {
      if (onError === 'throw') throw new Error(`check-runs fetch ${res.status}`)
      return null
    }
    const body = (await res.json().catch(() => null)) as { total_count?: number; check_runs?: CheckRunLike[] } | null
    if (!body || typeof body !== 'object') {
      if (onError === 'throw') throw new Error('check-runs fetch invalid')
      return null
    }
    if (!Array.isArray(body.check_runs)) return onError === 'throw' ? all : null
    all.push(...body.check_runs)
    if (body.check_runs.length < 100 || all.length >= (body.total_count ?? 0)) break
  }
  return all
}

/** At most 300 check runs per commit are read. */
const CHECK_RUN_PAGES = 3

/**
 * Workflow run ids that are not the newest run of their workflow on this
 * commit. GitHub's merge box scores only that newest run. An older run
 * (a cancelled duplicate, a failed run replaced by a re-run that started
 * before the failure was recorded) stays on the check-run list forever.
 */
export function supersededWorkflowRunIds(runs: readonly WorkflowRunOnHead[]): Set<number> {
  const newest = new Map<number, WorkflowRunOnHead>()
  const dead = new Set<number>()
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || run.id <= 0) continue
    const wf = run.workflow_id
    if (wf == null || !Number.isSafeInteger(wf) || wf <= 0) continue
    const prev = newest.get(wf)
    if (!prev) {
      newest.set(wf, run)
      continue
    }
    if (prev.id === run.id) continue
    if (workflowRunIsNewer(run, prev)) {
      dead.add(prev.id)
      newest.set(wf, run)
    } else {
      dead.add(run.id)
    }
  }
  return dead
}

function workflowRunIsNewer(a: WorkflowRunOnHead, b: WorkflowRunOnHead): boolean {
  const ta = Date.parse(a.created_at ?? '')
  const tb = Date.parse(b.created_at ?? '')
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb
  return a.id > b.id
}

/**
 * Drop check runs that belong to an older Actions run of the same workflow.
 * A check with no Actions run id is kept (another app, or a run we could
 * not place). Two different workflows that share a job name both stay.
 */
export function withoutSupersededWorkflowRuns<T extends CheckRunLike>(
  checks: readonly T[],
  runs: readonly WorkflowRunOnHead[],
): T[] {
  const deadRuns = supersededWorkflowRunIds(runs)
  if (deadRuns.size === 0) return [...checks]
  const deadSuites = new Set<number>()
  for (const run of runs) {
    if (deadRuns.has(run.id) && run.check_suite_id != null && run.check_suite_id > 0) deadSuites.add(run.check_suite_id)
  }
  return checks.filter((c) => {
    const runId = actionsRunNumericId(c)
    if (runId != null && deadRuns.has(runId)) return false
    const suite = c.check_suite?.id
    if (typeof suite === 'number' && deadSuites.has(suite)) return false
    return true
  })
}

async function listWorkflowRunsForHead(token: string, ref: GithubRepoRef, sha: string): Promise<WorkflowRunOnHead[] | null> {
  if (!COMMIT_SHA_RE.test(sha)) return null
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/actions/runs?${new URLSearchParams({ head_sha: sha, per_page: '100' })}`,
      { headers: githubAuthHeaders(token) },
    )
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { workflow_runs?: unknown } | null
    if (!body || !Array.isArray(body.workflow_runs)) return null
    const out: WorkflowRunOnHead[] = []
    for (const raw of body.workflow_runs) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as { id?: unknown; workflow_id?: unknown; check_suite_id?: unknown; created_at?: unknown }
      if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0) continue
      out.push({
        id: r.id,
        workflow_id: typeof r.workflow_id === 'number' && r.workflow_id > 0 ? r.workflow_id : null,
        check_suite_id: typeof r.check_suite_id === 'number' && r.check_suite_id > 0 ? r.check_suite_id : null,
        created_at: typeof r.created_at === 'string' ? r.created_at : null,
      })
    }
    return out
  } catch {
    return null
  }
}

/** Check runs minus older Actions runs of the same workflow. A failed runs read keeps every check. */
async function withoutSupersededWorkflowRunsFromGithub<T extends CheckRunLike>(
  token: string,
  ref: GithubRepoRef,
  sha: string,
  checks: readonly T[],
): Promise<T[]> {
  const workflows = await listWorkflowRunsForHead(token, ref, sha)
  if (!workflows) return [...checks]
  return withoutSupersededWorkflowRuns(checks, workflows)
}

/**
 * Whether `later` re-ran the check `earlier` stands for: the same name from
 * the same app, and either the same Actions run (a re-run attempt) or started
 * after `earlier` finished. Two workflows with a job of the same name run side
 * by side on one push, so neither supersedes the other and a red one stays red.
 */
function supersedes(later: CheckRunLike, earlier: CheckRunLike): boolean {
  if ((later.name ?? '') !== (earlier.name ?? '') || !later.name) return false
  if ((later.app?.id ?? later.app?.slug ?? null) !== (earlier.app?.id ?? earlier.app?.slug ?? null)) return false
  const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN)
  const laterStart = t(later.started_at)
  if (!Number.isFinite(laterStart)) return false
  const runA = actionsRunId(later)
  const runB = actionsRunId(earlier)
  if (runA && runB && runA === runB) return laterStart > t(earlier.started_at) || !Number.isFinite(t(earlier.started_at))
  const earlierDone = t(earlier.completed_at)
  return Number.isFinite(earlierDone) && laterStart >= earlierDone
}

/**
 * Drop check runs a later run of the same check replaced. GitHub lists every
 * run of a head, so a failed run and its green re-run both come back, even
 * with `filter=latest` when they sit in different check suites (report
 * 9e2ec6f0: yen-yen#364 read "CI failed" while GitHub said CLEAN).
 */
function currentCheckRuns<T extends CheckRunLike>(all: T[]): T[] {
  return all.filter((r) => !all.some((other) => other !== r && supersedes(other, r)))
}

/**
 * Check runs that review a PR instead of testing it. Copilot code review
 * posts a `copilot-pull-request-reviewer` run that concludes `failure`
 * whenever it leaves comments or runs out of quota; counting it made
 * help-her-take-photo#65 read "CI failed" with its only CI job green, and
 * the console hid the merge button.
 */
const ADVISORY_CHECK_RUN_NAMES = new Set(['copilot-pull-request-reviewer'])

export function isAdvisoryCheckRun(run: { name?: string | null }): boolean {
  return ADVISORY_CHECK_RUN_NAMES.has((run.name ?? '').toLowerCase())
}

/** Conclusions GitHub counts as passing for required checks and the merge box. */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

/** Worst first among conclusions that do not pass. Unknown values rank just under failure. */
const FAILING_SEVERITY: Record<string, number> = {
  failure: 100,
  startup_failure: 95,
  cancelled: 90,
  timed_out: 80,
  action_required: 70,
  stale: 60,
}

/**
 * One state for a commit, by GitHub's own rule: `success`, `neutral` and
 * `skipped` pass (docs.github.com, "Status checks"). Any other conclusion,
 * including one this code does not know, fails closed and the worst wins.
 * A head with only passing runs reads `success` when one of them succeeded,
 * so a skipped CLA or E2E job no longer hides a green build; `skipped` or
 * `neutral` alone stays as is for callers that want a real success.
 * `extra` holds legacy commit statuses, already one per context.
 */
export function collapseCheckRuns(all: CheckRunLike[], extra: CheckRunLike[] = []): CheckRunSnapshot {
  const runs = [...currentCheckRuns(all.filter((r) => !isAdvisoryCheckRun(r))), ...extra]
  if (runs.length === 0) return { status: null, conclusion: null }

  if (runs.some((r) => r.status !== 'completed' || !r.conclusion)) {
    return { status: 'in_progress', conclusion: null }
  }

  let worst: string | null = null
  let worstScore = -1
  for (const r of runs) {
    const c = r.conclusion as string
    if (PASSING_CONCLUSIONS.has(c)) continue
    // Unknown values fail closed but never displace a real `failure`, the
    // one conclusion downstream code reads as red code (pipeline-view, ci-infra).
    const score = FAILING_SEVERITY[c] ?? 99
    if (score > worstScore) {
      worstScore = score
      worst = c
    }
  }
  if (worst) return { status: 'completed', conclusion: worst }
  const has = (c: string) => runs.some((r) => r.conclusion === c)
  return { status: 'completed', conclusion: has('success') ? 'success' : has('neutral') ? 'neutral' : 'skipped' }
}

/**
 * Legacy commit statuses (Buildkite, CircleCI, Vercel, Snyk…) as check-run
 * shapes. They report on a separate API from check runs, so a repo whose CI
 * posts statuses had no CI state at all. Only finished statuses count: a
 * `pending` one may never finish (a CircleCI approval hold, an integration
 * that posts pending and never updates), and GitHub itself merges past a
 * pending status that is not required, so it must not hold the head at
 * "running" forever. A read error or no statuses gives none (the combined
 * state is "pending" when there are no statuses at all).
 */
export function commitStatusesAsCheckRuns(statuses: Array<{ context?: string | null; state?: string | null }>): CheckRunLike[] {
  return statuses.flatMap((s) => {
    const state = (s.state ?? '').toLowerCase()
    if (state !== 'success' && state !== 'failure' && state !== 'error') return []
    return [{ name: s.context ?? 'status', status: 'completed', conclusion: state === 'success' ? 'success' : 'failure' }]
  })
}

async function listCommitStatuses(token: string, ref: GithubRepoRef, gitRef: string): Promise<CheckRunLike[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(gitRef)}/status?per_page=100`,
      { headers: githubAuthHeaders(token) },
    )
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as { statuses?: Array<{ context?: string; state?: string }> } | null
    return Array.isArray(body?.statuses) ? commitStatusesAsCheckRuns(body.statuses) : []
  } catch {
    return []
  }
}

export interface WorkflowRunSnapshot {
  id: number
  name: string | null
  status: string | null
  conclusion: string | null
  htmlUrl: string | null
  headSha: string | null
  updatedAt: string | null
}

export async function fetchLatestWorkflowRunForSha(
  token: string,
  ref: GithubRepoRef,
  branch: string | null,
  commitSha: string,
): Promise<WorkflowRunSnapshot | null> {
  const params = new URLSearchParams({ per_page: '20' })
  if (branch) params.set('branch', branch)
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/actions/runs?${params.toString()}`,
    { headers: githubAuthHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`workflow runs fetch ${res.status}`)
  const body = await res.json() as {
    workflow_runs?: Array<{
      id?: number
      name?: string | null
      status?: string | null
      conclusion?: string | null
      html_url?: string | null
      head_sha?: string | null
      updated_at?: string | null
    }>
  }
  const run = (body.workflow_runs ?? []).find((r) => r.head_sha === commitSha)
  if (!run?.id) return null
  return {
    id: run.id,
    name: run.name ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    htmlUrl: run.html_url ?? null,
    headSha: run.head_sha ?? null,
    updatedAt: run.updated_at ?? null,
  }
}

export interface DeploymentStatusSnapshot {
  state: string | null
  environment: string | null
  environmentUrl: string | null
  updatedAt: string | null
}

export async function fetchLatestDeploymentStatusForSha(
  token: string,
  ref: GithubRepoRef,
  commitSha: string,
): Promise<DeploymentStatusSnapshot | null> {
  const params = new URLSearchParams({ sha: commitSha, per_page: '10' })
  const deploymentsRes = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/deployments?${params.toString()}`,
    { headers: githubAuthHeaders(token) },
  )
  if (deploymentsRes.status === 404) return null
  if (!deploymentsRes.ok) throw new Error(`deployments fetch ${deploymentsRes.status}`)
  const deployments = await deploymentsRes.json() as Array<{
    id?: number
    environment?: string | null
  }>
  const deployment = deployments.find((d) => d.id)
  if (!deployment?.id) return null
  const statusesRes = await fetchWithTimeout(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/deployments/${deployment.id}/statuses?per_page=1`,
    { headers: githubAuthHeaders(token) },
  )
  if (statusesRes.status === 404) return null
  if (!statusesRes.ok) throw new Error(`deployment statuses fetch ${statusesRes.status}`)
  const statuses = await statusesRes.json() as Array<{
    state?: string | null
    environment_url?: string | null
    updated_at?: string | null
  }>
  const status = statuses[0]
  if (!status) return null
  return {
    state: status.state ?? null,
    environment: deployment.environment ?? null,
    environmentUrl: status.environment_url ?? null,
    updatedAt: status.updated_at ?? null,
  }
}

/**
 * GitHub deployment-status states (`error`, `inactive`, `in_progress`, `queued`,
 * `pending`, `success`, `failure`, `waiting`) are broader than the
 * `sdk_upgrade_jobs.deploy_status` CHECK constraint allows
 * (`unknown | pending | success | failure | waiting`). Persisting a raw
 * `in_progress`/`queued`/`error`/`inactive` value would violate the CHECK
 * (Postgres 23514) and silently abort the entire job-row update, freezing the
 * release cockpit. Normalize to the constrained vocabulary at every write site.
 */
export function normalizeDeployStatus(
  raw: string | null | undefined,
): 'unknown' | 'pending' | 'success' | 'failure' | 'waiting' {
  switch (raw) {
    case 'success':
      return 'success'
    case 'failure':
    case 'error':
      return 'failure'
    case 'in_progress':
    case 'queued':
    case 'pending':
      return 'pending'
    case 'waiting':
      return 'waiting'
    default:
      return 'unknown'
  }
}
