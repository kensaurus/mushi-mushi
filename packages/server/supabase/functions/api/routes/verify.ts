/**
 * verify.ts — Verified fixes (ADR 0035, Plan 024). Served by `api-ext`; `api`
 * forwards these paths (_shared/edge-proxy.ts).
 *
 *   GET  /v1/admin/projects/:id/verify-settings      jwtAuth (console)
 *        The project_settings columns, as stored: { verified_auto_merge,
 *          verified_auto_merge_daily_limit, verify_runs_on,
 *          verify_test_command, verify_max_files, verify_max_lines,
 *          verify_protected_globs, verify_second_judge,
 *          verify_second_judge_model, auto_revert }, plus workflowInstalled:
 *          boolean | null (read from the primary repo; null = unknown),
 *          secondJudgeKey: { provider, label } | null, and available (false
 *          before the migration).
 *   PUT  /v1/admin/projects/:id/verify-settings      jwtAuth, non-viewers
 *        Any subset of those columns, zod-validated against the bounds in
 *        _shared/fix-verify.ts (verifySettingsPatchSchema). Audited.
 *   GET  /v1/admin/fixes/:id/verification            adminOrApiKey(mcp:read)
 *        { headSha, gates, passed, secondJudge, autoMerge: { state, detail },
 *          regressions: [{ id, signal, label, detail, mergeSha, revertState,
 *          revertPrUrl, createdAt }], mergedAt, mergeSha, evaluatedAt } for the current
 *        head (MCP get_fix_verification, `mushi fixes verify`). Also on
 *        GET /v1/admin/fixes/:id/timeline as data.verification.
 *   POST /v1/admin/fixes/:id/verify                  adminOrApiKey(mcp:write), non-viewers, 6/h per fix
 *        Asks fix-verifier to check the fix now (202, with the current
 *        verification or null); 429 RATE_LIMITED over the limit;
 *        `mushi fixes verify --rerun`.
 *   GET  /v1/admin/projects/:id/verify-workflow      adminOrApiKey(mcp:read)
 *        The workflow fitted to the repo: its lockfile's package manager, a
 *        local .github/actions/setup, and its runner variable (toolchain).
 *        { path, yaml }: the mushi-verify workflow filled in with this
 *        project's runner labels and test command (`mushi verify workflow`).
 *   POST /v1/admin/projects/:id/verify-workflow/pr   jwtAuth, non-viewers, 5/h per project
 *        Opens a PR that adds .github/workflows/mushi-verify.yml to the
 *        primary repo: { prUrl, prNumber, branch, path }. Audited.
 *   PUT validation errors: 400 VALIDATION_ERROR with error.issues [{ path, message }].
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { runInBackground } from '../../_shared/background.ts'
import { resolveProjectGithubToken, type GithubRepoRef } from '../../_shared/github.ts'
import {
  VERIFY_RERUNS_PER_HOUR,
  verifySettingsPatchSchema,
  verifySettingsPatchToRow,
  verifySettingsToRow,
  type VerifySettings,
} from '../../_shared/fix-verify.ts'
import {
  loadFixVerification,
  loadVerifySettings,
  notMigrated,
  primaryRepoFor,
  resolveSecondJudgeKey,
  saveVerifySettings,
  type PrimaryRepo,
} from '../../_shared/fix-verify-db.ts'
import { fetchDefaultBranch, openVerifyWorkflowPr, verifyWorkflowInstalled } from '../../_shared/fix-verify-github.ts'
import { DEFAULT_TOOLCHAIN, fillVerifyWorkflow, VERIFY_WORKFLOW_PATH, type RepoToolchain } from '../../_shared/verify-workflow.ts'
import { readRepoToolchain } from '../../_shared/verify-workflow-repo.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const vlog = log.child('verify-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const WORKFLOW_PRS_PER_HOUR = 5

type Db = ReturnType<typeof getServiceClient>

export interface VerifyRouteDeps {
  getServiceClient: () => Db
  jwtAuth: MiddlewareHandler
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  callerCanAccessProject: typeof callerCanAccessProject
  claimRateLimit: typeof claimTenantRateLimit
  logAudit: typeof logAudit
  /** The project's GitHub token; never the platform token (these routes read and write the project's repo). */
  resolveRepoToken: (db: Db, projectId: string, repo: PrimaryRepo) => Promise<string | null>
  workflowInstalled: typeof verifyWorkflowInstalled
  defaultBranch: typeof fetchDefaultBranch
  openWorkflowPr: typeof openVerifyWorkflowPr
  /** Lockfile, local setup action and runner variable of the repo (best effort; the default toolchain on any failure). */
  repoToolchain: (db: Db, input: { projectId: string; token: string; ref: GithubRepoRef; branch: string | null }) => Promise<RepoToolchain>
  resolveSecondJudgeKey: typeof resolveSecondJudgeKey
  /** Fire-and-forget call to the fix-verifier function for one fix. */
  invokeVerifier: (fixAttemptId: string) => void
  now: () => Date
}

function defaultInvokeVerifier(fixAttemptId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const internalSecret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !internalSecret) return
  // The cron picks the fix up anyway if this call is lost.
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/fix-verifier`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixAttemptId, force: true, trigger: 'manual' }),
    }),
    'fix-verifier re-check',
  )
}

export const defaultVerifyRouteDeps: VerifyRouteDeps = {
  getServiceClient,
  jwtAuth: jwtAuth as MiddlewareHandler,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  callerCanAccessProject,
  claimRateLimit: claimTenantRateLimit,
  logAudit,
  resolveRepoToken: (db, projectId, repo) => resolveProjectGithubToken(db, projectId, repo.installationId, { allowEnvFallback: false }),
  workflowInstalled: verifyWorkflowInstalled,
  defaultBranch: fetchDefaultBranch,
  openWorkflowPr: openVerifyWorkflowPr,
  repoToolchain: (db, input) => readRepoToolchain(db as never, input),
  resolveSecondJudgeKey,
  invokeVerifier: defaultInvokeVerifier,
  now: () => new Date(),
}

export function registerVerifyRoutes(app: Hono<{ Variables: Variables }>, deps: VerifyRouteDeps = defaultVerifyRouteDeps): void {
  app.get('/v1/admin/projects/:id/verify-settings', deps.jwtAuth, (c) => getSettings(c, deps))
  app.put('/v1/admin/projects/:id/verify-settings', deps.jwtAuth, (c) => putSettings(c, deps))
  app.get('/v1/admin/fixes/:id/verification', deps.adminOrApiKeyRead, (c) => getVerification(c, deps))
  app.post('/v1/admin/fixes/:id/verify', deps.adminOrApiKeyWrite, (c) => rerunVerification(c, deps))
  app.get('/v1/admin/projects/:id/verify-workflow', deps.adminOrApiKeyRead, (c) => getWorkflow(c, deps))
  app.post('/v1/admin/projects/:id/verify-workflow/pr', deps.jwtAuth, (c) => openWorkflowPr(c, deps))
}

/** The project from :id, after the caller's access check. A Response when refused. */
async function projectAccess(
  c: Context,
  deps: VerifyRouteDeps,
  db: Db,
): Promise<{ projectId: string; role: string | null } | Response> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  return { projectId, role: (access.role as string | null | undefined) ?? null }
}

async function workflowState(deps: VerifyRouteDeps, db: Db, projectId: string): Promise<boolean | null> {
  try {
    const repo = await primaryRepoFor(db as never, projectId)
    if (!repo) return null
    const token = await deps.resolveRepoToken(db, projectId, repo)
    if (!token) return null
    return await deps.workflowInstalled(token, { owner: repo.owner, repo: repo.repo }, repo.defaultBranch)
  } catch {
    return null
  }
}

async function settingsPayload(deps: VerifyRouteDeps, db: Db, projectId: string, settings: VerifySettings, available: boolean) {
  const [workflowInstalled, judge] = await Promise.all([
    available ? workflowState(deps, db, projectId) : Promise.resolve(null),
    deps.resolveSecondJudgeKey(db as never, projectId, settings, { purpose: 'probe' }).catch(() => null),
  ])
  return {
    ...verifySettingsToRow(settings),
    available,
    workflowInstalled,
    // The key's label or last four characters only; never the key.
    secondJudgeKey: judge && judge.key ? { provider: judge.provider, label: judge.key.label ?? `…${judge.key.hint}` } : null,
  }
}

async function getSettings(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const read = await loadVerifySettings(db as never, access.projectId)
  if (read.error) return jsonError(c, 'DB_ERROR', 'Could not read the verified-merge settings.', 500)
  return c.json({ ok: true, data: await settingsPayload(deps, db, access.projectId, read.settings, read.available) })
}

async function putSettings(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'change verified merge')
  if (viewer) return viewer
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON', 400)
  }
  const parsed = verifySettingsPatchSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String), message: i.message }))
    return jsonError(c, 'VALIDATION_ERROR', issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 500), 400, { issues })
  }
  const columns = verifySettingsPatchToRow(parsed.data)
  if (Object.keys(columns).length === 0) return jsonError(c, 'VALIDATION_ERROR', 'Nothing to change.', 400)
  const saved = await saveVerifySettings(db as never, access.projectId, columns)
  if (!saved.settings) {
    if (notMigrated({ code: saved.code })) return jsonError(c, 'NOT_AVAILABLE', 'Verified merge is not set up on this server yet.', 409)
    vlog.warn('verify settings save failed', { projectId: access.projectId, err: saved.error })
    return jsonError(c, 'DB_ERROR', 'Could not save the verified-merge settings.', 500)
  }
  await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'project_settings', access.projectId, { verifiedMerge: parsed.data }).catch(() => null)
  return c.json({ ok: true, data: await settingsPayload(deps, db, access.projectId, saved.settings, true) })
}

interface FixRow {
  id: string
  project_id: string
  report_id: string | null
  pr_url: string | null
  pr_state: string | null
  merged_at: string | null
  commit_sha: string | null
}

async function fixAccess(c: Context, deps: VerifyRouteDeps, db: Db): Promise<{ fix: FixRow; role: string | null } | Response> {
  const fixId = c.req.param('id') ?? ''
  if (!UUID_RE.test(fixId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const { data, error } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, pr_url, pr_state, merged_at, commit_sha')
    .eq('id', fixId)
    .maybeSingle()
  if (error) return jsonError(c, 'DB_ERROR', 'Could not read the fix.', 500)
  if (!data) return jsonError(c, 'NOT_FOUND', 'Fix not found', 404)
  const fix = data as FixRow
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, fix.project_id)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'You cannot read this fix.', 403)
  return { fix, role: (access.role as string | null | undefined) ?? null }
}

async function getVerification(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const found = await fixAccess(c, deps, db)
  if (found instanceof Response) return found
  const verification = await loadFixVerification(db as never, found.fix.id, found.fix.commit_sha)
  if (!verification) return jsonError(c, 'NOT_FOUND', 'Mushi has not checked this fix yet.', 404)
  return c.json({ ok: true, data: verification })
}

async function rerunVerification(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const found = await fixAccess(c, deps, db)
  if (found instanceof Response) return found
  const { fix } = found
  const viewer = denyViewerWrite(c, found.role, 're-check a fix')
  if (viewer) return viewer
  if (!fix.pr_url) return jsonError(c, 'NO_PR', 'This fix has no pull request to check.', 409)
  if (fix.merged_at || fix.pr_state === 'merged' || fix.pr_state === 'closed') {
    return jsonError(c, 'PR_NOT_OPEN', 'The pull request is already merged or closed.', 409)
  }
  const rate = await deps.claimRateLimit(db as never, `fix:${fix.id}:verify_rerun`, VERIFY_RERUNS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `A fix can be re-checked ${VERIFY_RERUNS_PER_HOUR} times an hour.`, 429)
  }
  deps.invokeVerifier(fix.id)
  await deps.logAudit(db as never, fix.project_id, c.get('userId') as string, 'fix.reviewed', 'fix_attempt', fix.id, {
    report_id: fix.report_id,
    requested: 'verification_rerun',
  }).catch(() => null)
  return c.json({ ok: true, data: await loadFixVerification(db as never, fix.id, fix.commit_sha) }, 202)
}

async function getWorkflow(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const read = await loadVerifySettings(db as never, access.projectId)
  if (read.error) return jsonError(c, 'DB_ERROR', 'Could not read the verified-merge settings.', 500)
  const toolchain = await toolchainFor(deps, db, access.projectId)
  return c.json({ ok: true, data: { path: VERIFY_WORKFLOW_PATH, yaml: fillVerifyWorkflow(read.settings, toolchain), toolchain } })
}

/** The repo's toolchain for the workflow; the template's defaults when the repo or its token cannot be read. */
async function toolchainFor(deps: VerifyRouteDeps, db: Db, projectId: string): Promise<RepoToolchain> {
  try {
    const repo = await primaryRepoFor(db as never, projectId)
    if (!repo) return DEFAULT_TOOLCHAIN
    const token = await deps.resolveRepoToken(db, projectId, repo)
    if (!token) return DEFAULT_TOOLCHAIN
    return await deps.repoToolchain(db, { projectId, token, ref: { owner: repo.owner, repo: repo.repo }, branch: repo.defaultBranch ?? null })
  } catch {
    return DEFAULT_TOOLCHAIN
  }
}

async function openWorkflowPr(c: Context, deps: VerifyRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'open a workflow pull request')
  if (viewer) return viewer
  const repo = await primaryRepoFor(db as never, access.projectId)
  if (!repo) return jsonError(c, 'NO_REPO', 'Connect a GitHub repository to this project first.', 409)
  const token = await deps.resolveRepoToken(db, access.projectId, repo)
  if (!token) return jsonError(c, 'GITHUB_NOT_CONNECTED', 'Connect GitHub (App or token) for this project first.', 409)
  const ref: GithubRepoRef = { owner: repo.owner, repo: repo.repo }
  const branch = repo.defaultBranch ?? (await deps.defaultBranch(token, ref).catch(() => null))
  if (!branch) return jsonError(c, 'GITHUB_ERROR', 'Mushi could not read the repository\'s default branch.', 502)
  if ((await deps.workflowInstalled(token, ref, branch)) === true) {
    return jsonError(c, 'ALREADY_INSTALLED', `${VERIFY_WORKFLOW_PATH} is already on ${branch}.`, 409)
  }
  const rate = await deps.claimRateLimit(db as never, `project:${access.projectId}:verify_workflow_pr`, WORKFLOW_PRS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `Mushi opens at most ${WORKFLOW_PRS_PER_HOUR} workflow pull requests an hour per project.`, 429)
  }
  const read = await loadVerifySettings(db as never, access.projectId)
  if (read.error) return jsonError(c, 'DB_ERROR', 'Could not read the verified-merge settings.', 500)
  let pr: { url: string; number: number; branch: string }
  try {
    const toolchain = await deps.repoToolchain(db, { projectId: access.projectId, token, ref, branch }).catch(() => DEFAULT_TOOLCHAIN)
    pr = await deps.openWorkflowPr({ token, ref, defaultBranch: branch, yaml: fillVerifyWorkflow(read.settings, toolchain), now: deps.now() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // GitHub refuses writes under .github/workflows without the workflows permission.
    if (/→ (403|404)/.test(message)) {
      return jsonError(
        c,
        'GITHUB_WORKFLOWS_WRITE_MISSING',
        'The GitHub access Mushi uses cannot add workflow files. Give the GitHub App "Workflows: Read and write" (or a token the workflow scope), or copy the workflow and commit it yourself.',
        403,
      )
    }
    vlog.warn('verify workflow PR failed', { projectId: access.projectId, err: message.slice(0, 200) })
    return jsonError(c, 'GITHUB_ERROR', 'GitHub did not open the pull request. Try again, or copy the workflow and commit it yourself.', 502)
  }
  await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'project_repo', `${repo.owner}/${repo.repo}`, {
    verifyWorkflowPr: pr.url,
  }).catch(() => null)
  return c.json({ ok: true, data: { prUrl: pr.url, prNumber: pr.number, branch: pr.branch, path: VERIFY_WORKFLOW_PATH } }, 201)
}
