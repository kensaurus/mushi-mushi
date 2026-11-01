/**
 * local-agent.ts — the local fix agent (Plan 023 Phase 3, ADR 0034).
 *
 * A fix dispatched with `agent: 'local'` is run by the developer's own
 * machine (`mushi agent serve`), never by the edge fix-worker or a cloud
 * agent. The dispatch route (fix-dispatch.ts) calls queueLocalFixAttempt():
 * a fix_attempts row (agent 'local', status 'queued') and a 'running'
 * dispatch job, so fix_dispatch_sweeper never hands it to the fix-worker.
 *
 *   POST /v1/admin/agent/claim                adminOrApiKey(mcp:write)
 *        body { projectId? }. Atomically claims the oldest queued local
 *        attempt in the caller's projects (claim_local_fix_attempt: FOR
 *        UPDATE SKIP LOCKED), sets it running with a 30-minute lease, and
 *        returns { attempt: { id, projectId, reportId, repoUrl, baseBranch,
 *        branchName, claimedUntil }, context } where context is the fix
 *        context packet of GET /v1/admin/reports/:id/fix-context (the one
 *        get_fix_context carries). { attempt: null } when nothing waits. A
 *        running attempt whose lease lapsed (crashed machine) is claimable.
 *   POST /v1/admin/agent/attempts/:id/report  adminOrApiKey(mcp:write)
 *        body { status: 'running' | 'completed' | 'failed', branch?, prUrl?,
 *        summary?, error? }. Only the key that claimed the attempt, or a
 *        project member signed in to the console, may report.
 *          running    renews the lease (30 min) while the agent works;
 *          completed  with prUrl: the PR is accepted exactly like a cloud
 *                     agent's (applyCloudAgentOutcome: substance check,
 *                     report → fixing, the Opus review queue of ADR 0030,
 *                     notifications); the PR must be on one of the
 *                     project's repos. Without prUrl: the no-PR verdict
 *                     classifier reads the summary;
 *          failed     closes the attempt (local_agent_error).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { applyCloudAgentOutcome, LOCAL_AGENT, localFixBranchName } from '../../_shared/agent-adapters.ts'
import { canonicalPrUrl, parsePullRequestUrl } from '../../_shared/pr-substance.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import { FIX_CONTEXT_COLUMNS, reportFixContextOf } from './report-agent-context.ts'
import type { Variables } from '../types.ts'

const llog = log.child('local-agent')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long a claim (or a `running` report) holds an attempt. */
export const LOCAL_AGENT_LEASE_SECONDS = 30 * 60
const OPEN_STATUSES = new Set(['queued', 'running'])
const MAX_SUMMARY = 4000
const MAX_ERROR = 2000

type Db = ReturnType<typeof getServiceClient>

export interface LocalAgentRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyWrite: MiddlewareHandler
  callerProjectIds: typeof callerProjectIds
  callerCanAccessProject: typeof callerCanAccessProject
  applyOutcome: typeof applyCloudAgentOutcome
  /** The fix context packet for one report (null when the report is gone). */
  loadFixContext: (db: Db, reportId: string) => Promise<Record<string, unknown> | null>
  now: () => Date
}

async function loadFixContext(db: Db, reportId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from('reports').select(FIX_CONTEXT_COLUMNS).eq('id', reportId).maybeSingle()
  if (error || !data) return null
  return reportFixContextOf(db, reportId, data as Record<string, unknown>)
}

export const defaultLocalAgentRouteDeps: LocalAgentRouteDeps = {
  getServiceClient,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  callerProjectIds,
  callerCanAccessProject,
  applyOutcome: applyCloudAgentOutcome,
  loadFixContext,
  now: () => new Date(),
}

export function registerLocalAgentRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: LocalAgentRouteDeps = defaultLocalAgentRouteDeps,
): void {
  app.post('/v1/admin/agent/claim', deps.adminOrApiKeyWrite, (c) => claimLocalAttempt(c, deps))
  app.post('/v1/admin/agent/attempts/:id/report', deps.adminOrApiKeyWrite, (c) => reportLocalAttempt(c, deps))
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch side (called from fix-dispatch.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalRepo {
  id: string
  repo_url: string
  default_branch: string | null
}

/**
 * The repo a local fix goes to: the chosen one, else the project's primary,
 * else its oldest. null when the project has no linked repo.
 */
export async function resolveLocalRepo(db: Db, projectId: string, targetRepoId: string | null): Promise<LocalRepo | null> {
  let q = db.from('project_repos').select('id, repo_url, default_branch, is_primary, created_at').eq('project_id', projectId)
  if (targetRepoId) q = q.eq('id', targetRepoId)
  const { data, error } = await q.order('is_primary', { ascending: false }).order('created_at', { ascending: true }).limit(1)
  if (error) throw new Error(`project_repos read failed: ${error.message}`)
  const row = (data as LocalRepo[] | null)?.[0]
  return row ? { id: row.id, repo_url: row.repo_url, default_branch: row.default_branch ?? null } : null
}

/**
 * Queue a local fix: one fix_attempts row (agent 'local', status 'queued')
 * linked to the dispatch job. No cloud API is called; `mushi agent serve`
 * claims it. Returns the attempt id and branch, or throws (the caller fails
 * the job).
 */
export async function queueLocalFixAttempt(
  db: Db,
  input: { projectId: string; reportId: string; dispatchId: string; repo: LocalRepo; newId?: () => string },
): Promise<{ attemptId: string; branchName: string }> {
  const attemptId = (input.newId ?? (() => crypto.randomUUID()))()
  const branchName = localFixBranchName(input.reportId, attemptId)
  const { error } = await db.from('fix_attempts').insert({
    id: attemptId,
    project_id: input.projectId,
    report_id: input.reportId,
    agent: LOCAL_AGENT,
    status: 'queued',
    branch_name: branchName,
    repo_id: input.repo.id,
    external_agent_ref: {
      kind: LOCAL_AGENT,
      repo_url: input.repo.repo_url,
      base_branch: input.repo.default_branch ?? 'main',
      dispatch_id: input.dispatchId,
    },
  })
  if (error) throw new Error(`fix_attempts insert failed: ${error.message}`)
  const { error: linkErr } = await db
    .from('fix_dispatch_jobs')
    .update({ fix_attempt_id: attemptId })
    .eq('id', input.dispatchId)
  if (linkErr) throw new Error(`fix_dispatch_jobs link failed: ${linkErr.message}`)
  return { attemptId, branchName }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claim
// ─────────────────────────────────────────────────────────────────────────────

interface ClaimedRow {
  id: string
  project_id: string
  report_id: string
  branch_name: string | null
  repo_id: string | null
  external_agent_ref: Record<string, unknown> | null
  claimed_until: string
  reclaimed: boolean
}

async function claimLocalAttempt(c: Context, deps: LocalAgentRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const body = (await c.req.json().catch(() => ({}))) as { projectId?: unknown }
  if (body.projectId !== undefined && (typeof body.projectId !== 'string' || !UUID_RE.test(body.projectId))) {
    return jsonError(c, 'INVALID_PROJECT_ID', 'projectId must be a UUID')
  }
  let projectIds = await deps.callerProjectIds(c, db, userId)
  if (typeof body.projectId === 'string') {
    if (!projectIds.includes(body.projectId)) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    projectIds = [body.projectId]
  }
  if (projectIds.length === 0) return c.json({ ok: true, data: { attempt: null } })

  const keyId = c.get('authMethod') === 'apiKey' ? ((c.get('apiKeyId') as string | undefined) ?? null) : null
  const { data, error } = await db.rpc('claim_local_fix_attempt', {
    p_project_ids: projectIds,
    p_key_id: keyId,
    p_user_id: userId ?? null,
    p_lease_seconds: LOCAL_AGENT_LEASE_SECONDS,
  })
  if (error) {
    llog.error('local attempt claim failed', { err: error.message })
    return jsonError(c, 'CLAIM_FAILED', 'Could not claim a local fix', 500)
  }
  const row = (Array.isArray(data) ? data[0] : data) as ClaimedRow | null | undefined
  if (!row) return c.json({ ok: true, data: { attempt: null } })

  const ref = row.external_agent_ref ?? {}
  let repoUrl = typeof ref.repo_url === 'string' ? ref.repo_url : null
  let baseBranch = typeof ref.base_branch === 'string' ? ref.base_branch : null
  if (!repoUrl) {
    const repo = await resolveLocalRepo(db, row.project_id, row.repo_id).catch(() => null)
    repoUrl = repo?.repo_url ?? null
    baseBranch = baseBranch ?? repo?.default_branch ?? null
  }
  const context = await deps.loadFixContext(db, row.report_id).catch((err) => {
    llog.warn('fix context for a local claim failed', { attemptId: row.id, err: String(err).slice(0, 200) })
    return null
  })
  llog.info('local fix claimed', { attemptId: row.id, projectId: row.project_id, reclaimed: row.reclaimed, viaKey: keyId != null })
  return c.json({
    ok: true,
    data: {
      attempt: {
        id: row.id,
        projectId: row.project_id,
        reportId: row.report_id,
        repoUrl,
        baseBranch: baseBranch ?? 'main',
        branchName: row.branch_name ?? localFixBranchName(row.report_id, row.id),
        claimedUntil: row.claimed_until,
        reclaimed: row.reclaimed === true,
      },
      context,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

type ReportStatus = 'running' | 'completed' | 'failed'

interface ReportBody {
  status: ReportStatus
  branch: string | null
  prUrl: string | null
  summary: string | null
  error: string | null
}

const BRANCH_RE = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._\/-]{1,200}$/

/** @internal Exported for tests only. */
export function parseReportBody(raw: unknown): { ok: true; body: ReportBody } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'body must be a JSON object' }
  const b = raw as Record<string, unknown>
  if (b.status !== 'running' && b.status !== 'completed' && b.status !== 'failed') {
    return { ok: false, message: "status must be 'running', 'completed' or 'failed'" }
  }
  const str = (k: string, max: number): string | null | undefined => {
    const v = b[k]
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string') return undefined
    return v.slice(0, max)
  }
  const branch = str('branch', 200)
  const prUrl = str('prUrl', 500)
  const summary = str('summary', MAX_SUMMARY)
  const error = str('error', MAX_ERROR)
  if (branch === undefined || prUrl === undefined || summary === undefined || error === undefined) {
    return { ok: false, message: 'branch, prUrl, summary and error must be strings' }
  }
  if (branch && !BRANCH_RE.test(branch)) return { ok: false, message: 'branch is not a valid git branch name' }
  if (prUrl && b.status !== 'completed') return { ok: false, message: "prUrl is only accepted with status 'completed'" }
  if (b.status === 'failed' && !error) return { ok: false, message: "status 'failed' needs an error" }
  return { ok: true, body: { status: b.status, branch, prUrl, summary, error } }
}

interface AttemptRow {
  id: string
  project_id: string
  report_id: string
  agent: string
  status: string
  pr_url: string | null
  claimed_by_key_id: string | null
  claimed_until: string | null
}

/** owner/repo of a GitHub repo URL, lowercased; null when it is not one. */
function repoSlug(url: string | null | undefined): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(String(url ?? '').trim())
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

async function reportLocalAttempt(c: Context, deps: LocalAgentRouteDeps): Promise<Response> {
  const attemptId = c.req.param('id') ?? ''
  if (!UUID_RE.test(attemptId)) return jsonError(c, 'INVALID_ID', 'attempt id must be a UUID')
  const parsed = parseReportBody(await c.req.json().catch(() => null))
  if (!parsed.ok) return jsonError(c, 'INVALID_BODY', parsed.message)
  const body = parsed.body

  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const { data, error } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, status, pr_url, claimed_by_key_id, claimed_until')
    .eq('id', attemptId)
    .maybeSingle()
  if (error) return jsonError(c, 'DB_ERROR', 'Could not read the fix attempt', 500)
  const attempt = data as AttemptRow | null
  // One answer for "no such attempt" and "not yours", so ids cannot be probed.
  if (!attempt || attempt.agent !== LOCAL_AGENT) return jsonError(c, 'NOT_FOUND', 'Local fix attempt not found', 404)
  const access = await deps.callerCanAccessProject(c, db, userId, attempt.project_id)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Local fix attempt not found', 404)

  // An API key may report only on the attempt it claimed; a console session
  // of a project member may report on any (to give up on a stuck one).
  const isKey = c.get('authMethod') === 'apiKey'
  if (isKey) {
    const keyId = (c.get('apiKeyId') as string | undefined) ?? null
    if (!keyId || keyId !== attempt.claimed_by_key_id) {
      return jsonError(c, 'NOT_CLAIMANT', 'Only the key that claimed this fix can report on it', 403)
    }
  }
  if (!OPEN_STATUSES.has(attempt.status)) {
    return jsonError(c, 'NOT_OPEN', `This fix attempt is already ${attempt.status}`, 409)
  }
  if (isKey && attempt.status !== 'running') {
    return jsonError(c, 'NOT_CLAIMED', 'Claim this fix before reporting on it', 409)
  }

  const now = deps.now()
  if (body.status === 'running') {
    const claimedUntil = new Date(now.getTime() + LOCAL_AGENT_LEASE_SECONDS * 1000).toISOString()
    let q = db
      .from('fix_attempts')
      .update({ claimed_until: claimedUntil, ...(body.branch ? { branch: body.branch } : {}) })
      .eq('id', attempt.id)
      .eq('status', 'running')
    if (isKey) q = q.eq('claimed_by_key_id', attempt.claimed_by_key_id as string)
    const { data: renewed, error: renewErr } = await q.select('id')
    if (renewErr) return jsonError(c, 'DB_ERROR', 'Could not renew the lease', 500)
    if (!renewed || (renewed as unknown[]).length === 0) {
      return jsonError(c, 'NOT_CLAIMED', 'The fix is no longer claimed by this key', 409)
    }
    return c.json({ ok: true, data: { attemptId: attempt.id, status: 'running', claimedUntil } })
  }

  const target = {
    attemptId: attempt.id,
    projectId: attempt.project_id,
    reportId: attempt.report_id,
    agent: LOCAL_AGENT,
    pendingPrUrl: attempt.pr_url,
  }

  if (body.status === 'completed' && body.prUrl) {
    const prUrl = canonicalPrUrl(body.prUrl)
    const pr = prUrl ? parsePullRequestUrl(prUrl) : null
    if (!prUrl || !pr) return jsonError(c, 'INVALID_PR_URL', 'prUrl must be a GitHub pull request URL')
    // The merge gate (ADR 0030) only merges PRs on the project's repos;
    // refuse any other here so a key cannot attach a foreign PR to a fix.
    const { data: repos, error: repoErr } = await db.from('project_repos').select('repo_url').eq('project_id', attempt.project_id)
    if (repoErr) return jsonError(c, 'DB_ERROR', 'Could not read the project repos', 500)
    const slug = `${pr.owner}/${pr.repo}`.toLowerCase()
    if (!((repos ?? []) as Array<{ repo_url: string }>).some((r) => repoSlug(r.repo_url) === slug)) {
      return jsonError(c, 'REPO_NOT_IN_PROJECT', `${pr.owner}/${pr.repo} is not a repo of this project`, 403)
    }
    const result = await deps.applyOutcome(db, target, {
      kind: 'pr_opened',
      prUrl,
      branch: body.branch ?? undefined,
      summary: body.summary,
      agentFinished: true,
    })
    return outcomeResponse(c, attempt.id, result)
  }

  const result = await deps.applyOutcome(
    db,
    target,
    body.status === 'completed'
      ? { kind: 'completed_no_pr', summary: body.summary }
      : { kind: 'failed', error: body.error ?? 'The local fix agent failed.', failureCategory: 'local_agent_error' },
  )
  return outcomeResponse(c, attempt.id, result)
}

function outcomeResponse(
  c: Context,
  attemptId: string,
  result: Awaited<ReturnType<typeof applyCloudAgentOutcome>>,
): Response {
  if (!result.applied) {
    if (result.reason === 'update_failed') return jsonError(c, 'DB_ERROR', 'Could not record the outcome', 500)
    if (result.reason === 'invalid_pr_url') return jsonError(c, 'INVALID_PR_URL', 'prUrl must be a GitHub pull request URL')
    if (result.reason === 'pr_url_conflict') {
      return jsonError(c, 'PR_ALREADY_ATTACHED', 'That pull request already belongs to another fix', 409)
    }
    return jsonError(c, 'NOT_OPEN', 'This fix attempt is no longer open', 409, { reason: result.reason ?? null })
  }
  return c.json({
    ok: true,
    data: {
      attemptId,
      applied: true,
      ...(result.needsInvestigation ? { needsInvestigation: true } : {}),
      ...(result.awaitingChanges ? { awaitingChanges: true } : {}),
    },
  })
}
