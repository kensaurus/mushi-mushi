/**
 * FILE: packages/server/supabase/functions/api/routes/security-proof.ts
 * PURPOSE: The security proof stage (Plan 025 P4, ADR 0074), served by
 *          `api-ext` (api forwards these paths).
 *
 *   POST /v1/security/results                         CI: one scanner result (SARIF / JSON) from mushi-security.yml.
 *                                                     Project-scoped key with mcp:write (X-Mushi-Api-Key); the
 *                                                     project is the key's. 120 posts an hour per project.
 *   GET  /v1/admin/projects/:id/security-proof        console / MCP (mcp:read): ?release=<id> | ?commit=<sha>;
 *                                                     neither = the newest scanned commit.
 *   PUT  /v1/admin/projects/:id/releases/:rid/commit  console / MCP (mcp:write): { commit_sha } pins a release to
 *                                                     the commit it ships (drafts and published releases).
 *   GET  /v1/admin/projects/:id/security-workflow     (mcp:read) { path, yaml }: the workflow filled in for this deployment.
 *   POST /v1/admin/projects/:id/security-workflow/pr  console JWT, non-viewers, 5 an hour: a PR that adds the workflow.
 *
 * Mushi never runs a scanner and never hosts scanner rules (ADR 0074).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { adminOrApiKey, apiKeyAuth, jwtAuth, requireApiKeyScope } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { resolveProjectGithubToken, type GithubRepoRef } from '../../_shared/github.ts'
import { primaryRepoFor } from '../../_shared/fix-verify-db.ts'
import { fetchDefaultBranch } from '../../_shared/fix-verify-github.ts'
import { createPrFromFiles } from '../../_shared/github-pr.ts'
import { fetchWithTimeout } from '../../_shared/http.ts'
import { toPublicSupabaseUrl } from '../../_shared/public-url.ts'
import { MAX_RESULT_BYTES, SECURITY_TOOLS } from '../../_shared/security-proof.ts'
import { ingestSecurityResult, loadSecurityProof, SecurityMigrationPending, securityTablesMissing, type ReleaseRef } from '../../_shared/security-proof-db.ts'
import { fillSecurityWorkflow, SECURITY_WORKFLOW_PATH } from '../../_shared/security-workflow.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'

const slog = log.child('security-proof')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA_RE = /^[0-9a-f]{7,40}$/i

export const SECURITY_RESULTS_PER_HOUR = 120
export const SECURITY_WORKFLOW_PRS_PER_HOUR = 5

type Db = ReturnType<typeof getServiceClient>

const resultSchema = z.object({
  tool: z.enum(SECURITY_TOOLS),
  commit_sha: z.string().regex(SHA_RE).nullable().optional(),
  ref: z.string().max(200).nullable().optional(),
  event: z.enum(['pull_request', 'push', 'schedule', 'workflow_dispatch', 'manual']).optional(),
  pr_number: z.number().int().positive().nullable().optional(),
  run_url: z.string().url().max(500).nullable().optional(),
  target_url: z.string().url().max(500).nullable().optional(),
  tool_version: z.string().max(60).nullable().optional(),
  started_at: z.string().datetime().nullable().optional(),
  status: z.enum(['error', 'skipped']).nullable().optional(),
  skip_reason: z.string().max(300).nullable().optional(),
  report: z.unknown(),
})

export interface SecurityRouteDeps {
  getServiceClient: () => Db
  /** Project key, then its mcp:write scope. */
  ciAuth: [MiddlewareHandler, MiddlewareHandler]
  readAuth: MiddlewareHandler
  writeAuth: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  callerCanAccessProject: typeof callerCanAccessProject
  claimRateLimit: typeof claimTenantRateLimit
  logAudit: typeof logAudit
  resolveRepoToken: (db: Db, projectId: string, installationId: number | null) => Promise<string | null>
  /** True / false when the workflow file is (not) on the default branch; null when it cannot be read. */
  workflowInstalled: (token: string, ref: GithubRepoRef, branch: string) => Promise<boolean | null>
  openPr: typeof createPrFromFiles
  defaultBranch: typeof fetchDefaultBranch
  env: (name: string) => string | undefined
  now: () => Date
}

async function workflowInstalled(token: string, ref: GithubRepoRef, branch: string): Promise<boolean | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${SECURITY_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mushi-mushi-security' } },
    )
    if (res.status === 404) return false
    if (!res.ok) return null
    return ((await res.json().catch(() => null)) as { type?: string } | null)?.type === 'file'
  } catch {
    return null
  }
}

export const defaultSecurityRouteDeps: SecurityRouteDeps = {
  getServiceClient,
  ciAuth: [apiKeyAuth as MiddlewareHandler, requireApiKeyScope('mcp:write') as MiddlewareHandler],
  readAuth: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  writeAuth: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  callerCanAccessProject,
  claimRateLimit: claimTenantRateLimit,
  logAudit,
  resolveRepoToken: (db, projectId, installationId) => resolveProjectGithubToken(db, projectId, installationId, { allowEnvFallback: false }),
  workflowInstalled,
  openPr: createPrFromFiles,
  defaultBranch: fetchDefaultBranch,
  env: (name) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined),
  now: () => new Date(),
}

export function registerSecurityProofRoutes(app: Hono<{ Variables: Variables }>, deps: SecurityRouteDeps = defaultSecurityRouteDeps): void {
  app.post('/v1/security/results', deps.ciAuth[0], deps.ciAuth[1], (c) => postResult(c, deps))
  app.get('/v1/admin/projects/:id/security-proof', deps.readAuth, (c) => getProof(c, deps))
  app.put('/v1/admin/projects/:id/releases/:rid/commit', deps.writeAuth, (c) => putReleaseCommit(c, deps))
  app.get('/v1/admin/projects/:id/security-workflow', deps.readAuth, (c) => getWorkflow(c, deps))
  app.post('/v1/admin/projects/:id/security-workflow/pr', deps.jwtAuth, (c) => openWorkflowPr(c, deps))
}

async function postResult(c: Context, deps: SecurityRouteDeps): Promise<Response> {
  const projectId = c.get('projectId') as string | undefined
  if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to one project (Projects → API keys); an account key cannot post scan results.', 403)
  const declared = Number(c.req.header('content-length') ?? '0')
  if (declared > MAX_RESULT_BYTES) return jsonError(c, 'PAYLOAD_TOO_LARGE', `A scan result may be at most ${MAX_RESULT_BYTES / 1024 / 1024} MB.`, 413)
  const text = await c.req.text().catch(() => '')
  if (text.length > MAX_RESULT_BYTES) return jsonError(c, 'PAYLOAD_TOO_LARGE', `A scan result may be at most ${MAX_RESULT_BYTES / 1024 / 1024} MB.`, 413)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return jsonError(c, 'VALIDATION_ERROR', 'The body is not JSON.', 400)
  }
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', 'That scan result is not valid.', 400, { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) })
  }
  const db = deps.getServiceClient()
  const rate = await deps.claimRateLimit(db as never, `project:${projectId}:security_results`, SECURITY_RESULTS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `Mushi takes at most ${SECURITY_RESULTS_PER_HOUR} scan results an hour per project.`, 429)
  }
  const b = parsed.data
  try {
    const outcome = await ingestSecurityResult(db as never, projectId, {
      tool: b.tool,
      commitSha: b.commit_sha?.toLowerCase() ?? null,
      ref: b.ref ?? null,
      event: b.event ?? 'manual',
      prNumber: b.pr_number ?? null,
      runUrl: b.run_url ?? null,
      targetUrl: b.target_url ?? null,
      toolVersion: b.tool_version ?? null,
      startedAt: b.started_at ?? null,
      status: b.status ?? null,
      skipReason: b.skip_reason ?? null,
      report: b.report,
    }, deps.now())
    return c.json({ ok: true, data: outcome }, 201)
  } catch (err) {
    if (err instanceof SecurityMigrationPending) return jsonError(c, 'MIGRATION_PENDING', err.message, 409)
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('Not a ') || /JSON|reported an error/.test(message)) return jsonError(c, 'UNREADABLE_REPORT', `Mushi could not read that ${b.tool} result: ${message.slice(0, 160)}`, 422)
    slog.warn('security result not stored', { projectId, tool: b.tool, err: message.slice(0, 200) })
    return jsonError(c, 'DB_ERROR', 'The scan result could not be stored. The next run sends it again.', 500)
  }
}

async function projectAccess(c: Context, deps: SecurityRouteDeps, db: Db): Promise<{ projectId: string; role: string | null } | Response> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  return { projectId, role: (access.role as string | null | undefined) ?? null }
}

async function loadRelease(db: Db, projectId: string, releaseId: string): Promise<{ release: ReleaseRef | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await db
    .from('releases')
    .select('id, version, status, commit_sha, published_at, created_at')
    .eq('id', releaseId)
    .eq('project_id', projectId)
    .maybeSingle()
  return { release: (data as ReleaseRef | null) ?? null, error }
}

async function getProof(c: Context, deps: SecurityRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const releaseId = c.req.query('release') ?? null
  const commit = c.req.query('commit') ?? null
  if (releaseId && !UUID_RE.test(releaseId)) return jsonError(c, 'VALIDATION_ERROR', 'release must be a uuid', 400)
  if (commit && !SHA_RE.test(commit)) return jsonError(c, 'VALIDATION_ERROR', 'commit must be 7–40 hex characters', 400)
  let release: ReleaseRef | null = null
  if (releaseId) {
    const read = await loadRelease(db, access.projectId, releaseId)
    if (securityTablesMissing(read.error)) return jsonError(c, 'MIGRATION_PENDING', new SecurityMigrationPending().message, 409)
    if (read.error) return jsonError(c, 'DB_ERROR', 'The release could not be read.', 500)
    if (!read.release) return jsonError(c, 'NOT_FOUND', 'No such release in this project.', 404)
    release = read.release
  }
  try {
    const proof = await loadSecurityProof(db as never, access.projectId, { release, commitSha: commit?.toLowerCase() ?? null }, deps.now())
    return c.json({ ok: true, data: { ...proof, workflowPath: SECURITY_WORKFLOW_PATH } })
  } catch (err) {
    if (err instanceof SecurityMigrationPending) return jsonError(c, 'MIGRATION_PENDING', err.message, 409)
    slog.warn('security proof read failed', { projectId: access.projectId, err: String(err).slice(0, 200) })
    return jsonError(c, 'DB_ERROR', 'The Security proof could not be read.', 500)
  }
}

async function putReleaseCommit(c: Context, deps: SecurityRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'pin a release to a commit')
  if (viewer) return viewer
  const rid = c.req.param('rid') ?? ''
  if (!UUID_RE.test(rid)) return jsonError(c, 'VALIDATION_ERROR', 'rid must be a uuid', 400)
  const body = (await c.req.json().catch(() => null)) as { commit_sha?: unknown } | null
  const sha = body?.commit_sha
  if (sha !== null && (typeof sha !== 'string' || !SHA_RE.test(sha))) return jsonError(c, 'VALIDATION_ERROR', 'commit_sha must be 7–40 hex characters, or null to unpin.', 400)
  const { data, error } = await db
    .from('releases')
    .update({ commit_sha: typeof sha === 'string' ? sha.toLowerCase() : null })
    .eq('id', rid)
    .eq('project_id', access.projectId)
    .select('id, version, commit_sha')
    .maybeSingle()
  if (securityTablesMissing(error)) return jsonError(c, 'MIGRATION_PENDING', new SecurityMigrationPending().message, 409)
  if (error) return jsonError(c, 'DB_ERROR', 'The release could not be updated.', 500)
  if (!data) return jsonError(c, 'NOT_FOUND', 'No such release in this project.', 404)
  await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'release', rid, { commitSha: (data as { commit_sha: string | null }).commit_sha }).catch(() => null)
  return c.json({ ok: true, data })
}

function workflowYaml(deps: SecurityRouteDeps): string {
  const base = toPublicSupabaseUrl(deps.env('SUPABASE_URL') ?? null)
  const slug = deps.env('GITHUB_APP_SLUG')?.trim()
  return fillSecurityWorkflow({
    apiEndpoint: base ? `${base.replace(/\/+$/, '')}/functions/v1/api` : null,
    trustedBots: slug ? [`${slug}[bot]`] : [],
  })
}

async function getWorkflow(c: Context, deps: SecurityRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  return c.json({ ok: true, data: { path: SECURITY_WORKFLOW_PATH, yaml: workflowYaml(deps) } })
}

async function openWorkflowPr(c: Context, deps: SecurityRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'open a workflow pull request')
  if (viewer) return viewer
  const repo = await primaryRepoFor(db as never, access.projectId)
  if (!repo) return jsonError(c, 'NO_REPO', 'Connect a GitHub repository to this project first.', 409)
  const token = await deps.resolveRepoToken(db, access.projectId, repo.installationId)
  if (!token) return jsonError(c, 'GITHUB_NOT_CONNECTED', 'Connect GitHub (App or token) for this project first.', 409)
  const ref: GithubRepoRef = { owner: repo.owner, repo: repo.repo }
  const branch = repo.defaultBranch ?? (await deps.defaultBranch(token, ref).catch(() => null))
  if (!branch) return jsonError(c, 'GITHUB_ERROR', 'Mushi could not read the repository\'s default branch.', 502)
  if ((await deps.workflowInstalled(token, ref, branch)) === true) return jsonError(c, 'ALREADY_INSTALLED', `${SECURITY_WORKFLOW_PATH} is already on ${branch}.`, 409)
  const rate = await deps.claimRateLimit(db as never, `project:${access.projectId}:security_workflow_pr`, SECURITY_WORKFLOW_PRS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `Mushi opens at most ${SECURITY_WORKFLOW_PRS_PER_HOUR} workflow pull requests an hour per project.`, 429)
  }
  const now = deps.now()
  try {
    const pr = await deps.openPr({
      token,
      owner: ref.owner,
      repo: ref.repo,
      defaultBranch: branch,
      branch: `mushi/security-workflow-${now.toISOString().slice(0, 10)}-${now.getTime().toString(36)}`,
      title: 'ci: add Mushi security proof (OSV-Scanner, Gitleaks; opt-in AI review and weekly DAST)',
      body: [
        `Adds \`${SECURITY_WORKFLOW_PATH}\`.`,
        '',
        '- Every PR: OSV-Scanner (known holes in lockfiles) and Gitleaks (secrets, redacted) run on your runner and send their SARIF to Mushi.',
        '- Opt-in (`MUSHI_SECURITY_AI_REVIEW=true`): claude-code-security-review on PRs from trusted authors only, with your own `ANTHROPIC_API_KEY`. It is not hardened against prompt injection, so it never reads a fork or a stranger\'s PR.',
        '- Weekly (`MUSHI_STAGING_URL` set): ZAP baseline (passive) and Nuclei (non-intrusive templates, rate-limited) against your staging site.',
        '',
        'Add the `MUSHI_API_KEY` secret (a key with mcp:write) so results reach Mushi; each release then shows its Security proof.',
      ].join('\n'),
      files: [{ path: SECURITY_WORKFLOW_PATH, contents: workflowYaml(deps), reason: 'add the Mushi security proof workflow' }],
      markReady: true,
    })
    await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'project_repo', `${repo.owner}/${repo.repo}`, { securityWorkflowPr: pr.url }).catch(() => null)
    return c.json({ ok: true, data: { prUrl: pr.url, prNumber: pr.number, branch: pr.branch, path: SECURITY_WORKFLOW_PATH } }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/→ (403|404)/.test(message)) {
      return jsonError(c, 'GITHUB_WORKFLOWS_WRITE_MISSING', 'The GitHub access Mushi uses cannot add workflow files. Give the GitHub App "Workflows: Read and write" (or a token the workflow scope), or copy the workflow and commit it yourself.', 403)
    }
    slog.warn('security workflow PR failed', { projectId: access.projectId, err: message.slice(0, 200) })
    return jsonError(c, 'GITHUB_ERROR', 'GitHub did not open the pull request. Try again, or copy the workflow and commit it yourself.', 502)
  }
}
