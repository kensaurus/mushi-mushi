/**
 * ci-job-debug.ts — debug a CI job from the console (2026-11-19, ADR 0033 amendment).
 * Registered by registerCiRoutes (served by api-ext; api forwards /v1/admin/ci/*).
 *
 * Every route is keyed by the overview's `jobs[].id`: the ci_jobs row (one per project, job and
 * attempt). The row says which project, repo and run it is; the client never names a repo.
 * A row in a project the caller cannot read is a 404, the same as one that does not exist.
 *
 *   GET  /v1/admin/ci/jobs/:id/debug    adminOrApiKey(mcp:read), 120/h per project
 *        The failing step, the steps, the screened log excerpt and annotations (read live from
 *        GitHub, screened by extractCiLogExcerpt, never stored), a cached explanation, and which
 *        actions apply (re-run, cancel, explain, Send to CI repair).
 *   POST /v1/admin/ci/jobs/:id/explain  adminOrApiKey(mcp:write), non-viewers, 30 model calls/h per project
 *        A plain-English cause, one next step and code / flaky / infra. A machine stop or a cancel
 *        is answered from the job's verdict without a model; a code failure goes to OpenAI's mini
 *        model through the project's key pool (withLlmFailover 'openai': budget and wallet
 *        checks, key rotation) and is cached per job attempt (ci_job_explanations + memory).
 *   POST /v1/admin/ci/jobs/:id/rerun    adminOrApiKey(mcp:write), non-viewers, 20/h per project
 *        rerun-failed-jobs on the job's run. 403 GITHUB_ACTIONS_WRITE_MISSING carries the fix.
 *   POST /v1/admin/ci/jobs/:id/cancel   adminOrApiKey(mcp:write), non-viewers, 20/h per project
 *        Cancels the job's run while it is queued or running.
 *
 * GitHub token: the repo must still be bound to the project (project_repos); its App
 * installation first, then the project's own token, never the platform token (the log is repo
 * content handed to the caller, the same rule as the digest and diagram routes). The Mushi Mushi
 * GitHub App reads Actions but cannot write them (2026-11), so a re-run or cancel the App token is
 * refused retries once with the stored token, the one the "add a fine-grained token" fix adds.
 */

import type { Context, Hono } from 'npm:hono@4'
import { log } from '../../_shared/logger.ts'
import { sanitizeForLLM } from '../../_shared/sanitize.ts'
import { OPENAI_MINI } from '../../_shared/models.ts'
import { boundRepos } from '../../_shared/ci-collector.ts'
import { cancelRun, ciGithub, fetchJobAnnotations, fetchJobLogTail, fetchJobResult, rerunFailedJobs, type CiGithub } from '../../_shared/ci-jobs.ts'
import { extractCiLogExcerpt } from '../../_shared/review-followup.ts'
import {
  buildCiExplainPrompt,
  canCancel,
  canExplain,
  canRerun,
  CI_DEBUG_LOG_TAIL_BYTES,
  CI_EXPLAIN_SYSTEM,
  CI_JOB_DEBUG_COLUMNS,
  debugSteps,
  debugView,
  failingStep,
  normalizeExplanation,
  readStoredExplanation,
  ruleExplanation,
  screenAnnotations,
  storeExplanation,
  type CiExplainModelOutput,
  type CiJobDebug,
  type CiJobDebugRow,
  type CiJobExplanation,
} from '../../_shared/ci-job-debug.ts'
import { jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { CiRouteDeps } from './ci.ts'
import type { Variables } from '../types.ts'

const dlog = log.child('ci-job-debug')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CI_DEBUG_READS_PER_HOUR = 120
export const CI_EXPLAINS_PER_HOUR = 30
export const CI_RUN_ACTIONS_PER_HOUR = 20

/** Where the console fixes each refusal (the panel turns these into a button). */
export const CI_DEBUG_FIX = {
  githubAccess: (projectId: string) => `/integrations/config?project=${projectId}#platform-card-github`,
  aiKeys: '/settings?tab=byok',
  spendLimits: '/settings#spend-limits',
  wallet: '/team?view=billing',
} as const

type Db = ReturnType<CiRouteDeps['getServiceClient']>

export interface CiExplainModelResult {
  object: CiExplainModelOutput
  model: string
  inputTokens?: number
  outputTokens?: number
  keySource: 'byok' | 'env'
}

export type CiRepoToken = { token: string; source: 'app' | 'stored' } | { error: 'not_bound' | 'no_token' }

export interface CiJobDebugDeps {
  /**
   * The GitHub token for a repo bound to the project, and where it came from, or why there is none.
   * `skipApp`: only the stored token (the project's, else its organization's), never the App's.
   */
  resolveRepoToken: (db: Db, projectId: string, repo: string, opts?: { skipApp?: boolean }) => Promise<CiRepoToken>
  /** One model call: the system and user turns in, the validated answer out. */
  explainModel: (db: Db, projectId: string, prompt: { system: string; user: string }) => Promise<CiExplainModelResult>
  logLlmInvocation: (db: Db, rec: Record<string, unknown>) => Promise<unknown>
}

export const defaultCiJobDebugDeps: CiJobDebugDeps = {
  resolveRepoToken: async (db, projectId, repo, opts = {}) => {
    const binding = (await boundRepos(db as never, [projectId])).find((b) => b.repo.toLowerCase() === repo.toLowerCase())
    if (!binding) return { error: 'not_bound' }
    const { mintInstallationToken, resolveProjectGithubToken } = await import('../../_shared/github.ts')
    if (!opts.skipApp && binding.installationId) {
      try {
        return { token: await mintInstallationToken(binding.installationId), source: 'app' }
      } catch {
        // A failed mint falls through to the stored token, as resolveProjectGithubToken does.
      }
    }
    const token = await resolveProjectGithubToken(db as never, projectId, null, { allowEnvFallback: false })
    return token ? { token, source: 'stored' } : { error: 'no_token' }
  },
  explainModel: async (db, projectId, prompt) => {
    // Loaded on the first explain only: api-ext sits near the edge deploy size limit.
    const { withLlmFailover } = await import('../../_shared/llm-failover.ts')
    const { generateValidatedObject } = await import('../../_shared/structured-output.ts')
    const { CI_EXPLAIN_SCHEMA } = await import('../../_shared/ci-job-debug.ts')
    let keySource: 'byok' | 'env' = 'byok'
    // OpenAI only (brief 2026-11-19: "use OpenAI for now"): never the Claude pool, so an
    // organization still on Claude spends no Claude credit here.
    const result = await withLlmFailover(db as never, projectId, 'openai', async (key) => {
      keySource = key.source
      const { openAiProvider } = await import('../../_shared/openai-compat.ts')
      const openai = openAiProvider({ apiKey: key.key, baseURL: key.baseUrl })
      return generateValidatedObject(CI_EXPLAIN_SCHEMA, {
        model: openai(OPENAI_MINI),
        system: prompt.system,
        prompt: prompt.user,
        // Room for the model's reasoning before the short JSON answer (the answer itself is ~150 tokens).
        maxTokens: 2000,
      })
    })
    const usage = (result as { usage?: { promptTokens?: number; completionTokens?: number } }).usage
    return { object: result.object, model: OPENAI_MINI, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens, keySource }
  },
  logLlmInvocation: async (db, rec) => (await import('../../_shared/telemetry.ts')).logLlmInvocation(db as never, rec as never),
}

type AllDeps = CiRouteDeps & CiJobDebugDeps

/** Load the row by id and check the caller may read its project. */
async function loadRow(c: Context, deps: AllDeps): Promise<{ row: CiJobDebugRow; db: Db; role: string | null } | { response: Response }> {
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return { response: jsonError(c, 'NOT_FOUND', 'Job not found', 404) }
  const db = deps.getServiceClient()
  const { data, error } = await db.from('ci_jobs').select(CI_JOB_DEBUG_COLUMNS).eq('id', id).maybeSingle()
  if (error) return { response: jsonError(c, 'DB_ERROR', 'The job could not be read. Try again in a minute.', 500) }
  const row = data as CiJobDebugRow | null
  if (!row) return { response: jsonError(c, 'NOT_FOUND', 'Job not found', 404) }
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, row.project_id)
  if (!access.allowed) return { response: jsonError(c, 'NOT_FOUND', 'Job not found', 404) }
  return { row, db, role: access.role ?? null }
}

async function claim(c: Context, deps: AllDeps, db: Db, key: string, limit: number, words: string): Promise<Response | null> {
  const rate = await deps.claimRateLimit(db, key, limit, 3600)
  if (rate.allowed) return null
  c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
  return jsonError(c, 'RATE_LIMITED', words, 429)
}

function tokenRefusal(c: Context, projectId: string, error: 'not_bound' | 'no_token'): Response {
  return error === 'not_bound'
    ? jsonError(c, 'REPO_NOT_CONNECTED', 'This repository is no longer connected to the app. Connect it again in the GitHub connection.', 409, { fix: CI_DEBUG_FIX.githubAccess(projectId) })
    : jsonError(c, 'NO_GITHUB_TOKEN', 'Connect GitHub for this app first.', 409, { fix: CI_DEBUG_FIX.githubAccess(projectId) })
}

/** The screened log excerpt and annotations, read live. Nothing raw is kept or logged. */
async function readLog(gh: CiGithub, row: CiJobDebugRow): Promise<{ log: CiJobDebug['log']; annotations: string[]; steps?: CiJobDebug['steps'] }> {
  if (row.status !== 'completed') {
    // Live: GitHub's current steps say where it is; the log is not final yet.
    const live = await fetchJobResult(gh, row.repo, row.job_id)
    const steps = live.status === 200 && live.body ? debugSteps({ steps: (live.body.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion ?? s.status ?? null, seconds: null })) }) : undefined
    return { log: { status: 'running', excerpt: null, linesDropped: 0 }, annotations: [], steps }
  }
  const [raw, notes] = await Promise.all([
    fetchJobLogTail(gh, row.repo, row.job_id, CI_DEBUG_LOG_TAIL_BYTES),
    // An Actions job id is its check run id.
    fetchJobAnnotations(gh, `https://api.github.com/repos/${row.repo}/check-runs/${row.job_id}`),
  ])
  const screened = screenAnnotations(notes)
  if (raw == null) return { log: { status: 'unavailable', excerpt: null, linesDropped: 0 }, annotations: screened.kept }
  const ex = extractCiLogExcerpt(raw)
  return { log: { status: 'ok', excerpt: ex.text || null, linesDropped: ex.linesDropped + screened.dropped }, annotations: screened.kept }
}

/** The newest Mushi Mushi fix whose PR this job tested, for "Send to CI repair". */
async function fixForJob(db: Db, row: CiJobDebugRow): Promise<{ fixId: string; reportId: string | null } | null> {
  if (row.pr_number == null || row.ci_kind !== 'code_failure') return null
  const { data, error } = await db
    .from('fix_attempts')
    .select('id, report_id, pr_url, merged_at, created_at')
    .eq('project_id', row.project_id)
    .eq('pr_number', row.pr_number)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) return null
  const want = `github.com/${row.repo.toLowerCase()}/pull/`
  const hit = ((data ?? []) as Array<{ id: string; report_id: string | null; pr_url: string | null; merged_at: string | null }>).find(
    (f) => !f.merged_at && (f.pr_url ?? '').toLowerCase().includes(want),
  )
  return hit ? { fixId: hit.id, reportId: hit.report_id } : null
}

async function debugJob(c: Context, deps: AllDeps): Promise<Response> {
  const loaded = await loadRow(c, deps)
  if ('response' in loaded) return loaded.response
  const { row, db } = loaded
  c.header('Cache-Control', 'no-store')
  const limited = await claim(c, deps, db, `project:${row.project_id}:ci_job_debug`, CI_DEBUG_READS_PER_HOUR, `At most ${CI_DEBUG_READS_PER_HOUR} job logs an hour per app. Try again later.`)
  if (limited) return limited

  const now = deps.now()
  const [stored, ciRepair, token] = await Promise.all([
    canExplain(row) ? readStoredExplanation(db as never, row.id) : Promise.resolve({ explanation: null, stored: true }),
    fixForJob(db, row),
    deps.resolveRepoToken(db, row.project_id, row.repo),
  ])
  const explanation = stored.explanation ?? ruleExplanation(row, now)

  let logPart: Awaited<ReturnType<typeof readLog>>
  if ('error' in token) {
    logPart = { log: { status: token.error, excerpt: null, linesDropped: 0 }, annotations: [] }
  } else {
    try {
      logPart = await readLog(ciGithub(token.token, 3, deps.fetchImpl), row)
    } catch (err) {
      dlog.warn('job log read failed', { jobId: row.job_id, err: err instanceof Error ? err.message : String(err) })
      logPart = { log: { status: 'unavailable', excerpt: null, linesDropped: 0 }, annotations: [] }
    }
  }
  return c.json({ ok: true, data: debugView({ row, steps: logPart.steps, log: logPart.log, annotations: logPart.annotations, explanation, ciRepair }) })
}

/**
 * Map a model-path error to the setup gap that fixes it. Duck-typed on the error's own code so
 * this module never loads the failover chain to compare classes.
 *
 * @internal Exported for tests.
 */
export function explainErrorResponse(err: unknown): { status: 402 | 409 | 502; code: string; message: string; fix: string | null } {
  const e = err as { code?: unknown; reason?: unknown; message?: unknown } | null
  if (e?.code === 'LLM_BUDGET_EXCEEDED') {
    return { status: 409, code: 'LLM_BUDGET_EXCEEDED', message: "This app's AI spend limit for the month is used up. Raise it to get explanations again.", fix: CI_DEBUG_FIX.spendLimits }
  }
  if (e?.code === 'NO_KEYS_CONFIGURED') {
    return { status: 409, code: 'NO_AI_KEY', message: 'Add an OpenAI key so Mushi Mushi can explain CI failures.', fix: CI_DEBUG_FIX.aiKeys }
  }
  if (e?.code === 'ALL_KEYS_EXHAUSTED') {
    return { status: 502, code: 'AI_KEYS_FAILED', message: 'Every OpenAI key was refused (quota or a revoked key). Check the keys, then try again.', fix: CI_DEBUG_FIX.aiKeys }
  }
  if (typeof e?.message === 'string' && e.message.startsWith('wallet denied')) {
    return { status: 402, code: 'WALLET_DENIED', message: "The Mushi Mushi AI balance can't cover this. Top it up, or add your own OpenAI key.", fix: CI_DEBUG_FIX.wallet }
  }
  return { status: 502, code: 'EXPLAIN_FAILED', message: 'The explanation could not be written. Try again in a minute.', fix: null }
}

async function explainJob(c: Context, deps: AllDeps): Promise<Response> {
  const loaded = await loadRow(c, deps)
  if ('response' in loaded) return loaded.response
  const { row, db, role } = loaded
  const viewer = denyViewerWrite(c, role, 'explain a CI failure')
  if (viewer) return viewer
  if (!canExplain(row)) return jsonError(c, 'NOTHING_TO_EXPLAIN', row.status === 'completed' ? 'This job passed.' : 'This job is still running.', 409)

  const now = deps.now()
  const rule = ruleExplanation(row, now)
  if (rule) return c.json({ ok: true, data: { explanation: rule, cached: false } })
  const stored = await readStoredExplanation(db as never, row.id)
  if (stored.explanation) return c.json({ ok: true, data: { explanation: stored.explanation, cached: true } })

  // Only a miss costs a model call, so only a miss counts against the hourly cap.
  const limited = await claim(c, deps, db, `project:${row.project_id}:ci_job_explain`, CI_EXPLAINS_PER_HOUR, `At most ${CI_EXPLAINS_PER_HOUR} new explanations an hour per app. Try again later.`)
  if (limited) return limited

  const token = await deps.resolveRepoToken(db, row.project_id, row.repo)
  let logPart: Awaited<ReturnType<typeof readLog>> = { log: { status: 'no_token', excerpt: null, linesDropped: 0 }, annotations: [] }
  if (!('error' in token)) {
    try {
      logPart = await readLog(ciGithub(token.token, 2, deps.fetchImpl), row)
    } catch {
      // Explained from the step alone.
    }
  }
  const user = buildCiExplainPrompt(
    {
      jobName: row.job_name,
      workflowName: row.workflow_name,
      failedStep: failingStep(debugSteps(row)),
      conclusion: row.conclusion,
      annotations: logPart.annotations,
      excerpt: logPart.log.excerpt,
    },
    (t) => sanitizeForLLM(t).text,
  )

  const started = Date.now()
  let explanation: CiJobExplanation
  try {
    const out = await deps.explainModel(db, row.project_id, { system: CI_EXPLAIN_SYSTEM, user })
    explanation = normalizeExplanation(out.object, out.model, now)
    // Awaited (it never rejects): the spend row must not be lost when the isolate winds down.
    await deps.logLlmInvocation(db, {
      projectId: row.project_id,
      functionName: 'ci-job-explain',
      stage: 'ci-job-explain',
      primaryModel: OPENAI_MINI,
      usedModel: out.model,
      fallbackUsed: false,
      fallbackReason: null,
      status: 'success',
      latencyMs: Date.now() - started,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      keySource: out.keySource,
    })
  } catch (err) {
    const mapped = explainErrorResponse(err)
    await deps.logLlmInvocation(db, {
      projectId: row.project_id,
      functionName: 'ci-job-explain',
      stage: 'ci-job-explain',
      primaryModel: OPENAI_MINI,
      usedModel: OPENAI_MINI,
      fallbackUsed: false,
      fallbackReason: null,
      status: 'error',
      errorMessage: mapped.code,
      latencyMs: Date.now() - started,
    })
    if (mapped.code === 'EXPLAIN_FAILED') dlog.error('ci job explain failed', { jobId: row.job_id, err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, mapped.code, mapped.message, mapped.status, mapped.fix ? { fix: mapped.fix } : undefined)
  }
  try {
    await storeExplanation(db as never, row, explanation)
  } catch (err) {
    // The answer still goes back; the memory cache holds it in this instance.
    dlog.warn('ci job explanation not stored', { err: err instanceof Error ? err.message : String(err) })
  }
  return c.json({ ok: true, data: { explanation, cached: false } })
}

/**
 * The App refused (and no stored token could): the installation has not accepted the App's
 * Actions: Read and write yet (requested 2026-11-20), or there is no App on this repo.
 */
const WRITE_MISSING =
  "Mushi Mushi's GitHub access can read your CI but not re-run or cancel it. Accept the Mushi Mushi App's Actions permission on GitHub (Settings → Applications → Review request), or add a fine-grained token with Actions: Read and write in the GitHub connection."
/** The stored token was tried and refused too: that token is what needs the permission. */
const STORED_WRITE_MISSING =
  "The GitHub token saved in the GitHub connection can't re-run or cancel CI. Give it Actions: Read and write for this repository (fine-grained token), or replace it."

async function runAction(c: Context, deps: AllDeps, action: 'rerun' | 'cancel'): Promise<Response> {
  const loaded = await loadRow(c, deps)
  if ('response' in loaded) return loaded.response
  const { row, db, role } = loaded
  const viewer = denyViewerWrite(c, role, action === 'rerun' ? 're-run CI' : 'cancel CI')
  if (viewer) return viewer
  if (action === 'rerun' && !canRerun(row)) {
    return jsonError(c, row.status === 'completed' ? 'NOTHING_TO_RERUN' : 'CI_RUNNING', row.status === 'completed' ? 'This job passed; there is nothing to re-run.' : 'This job is still running. Cancel it, or re-run once it finishes.', 409)
  }
  if (action === 'cancel' && !canCancel(row)) return jsonError(c, 'NOT_RUNNING', 'This run already finished.', 409)
  const limited = await claim(c, deps, db, `project:${row.project_id}:ci_run_action`, CI_RUN_ACTIONS_PER_HOUR, `CI can be re-run or cancelled ${CI_RUN_ACTIONS_PER_HOUR} times an hour per app. Try again later.`)
  if (limited) return limited

  const token = await deps.resolveRepoToken(db, row.project_id, row.repo)
  if ('error' in token) return tokenRefusal(c, row.project_id, token.error)
  const call = (t: string) => {
    const gh = ciGithub(t, 1, deps.fetchImpl)
    return action === 'rerun' ? rerunFailedJobs(gh, row.repo, row.run_id) : cancelRun(gh, row.repo, row.run_id)
  }
  let status = await call(token.token)
  let storedRefused = token.source === 'stored'
  if (status === 403 && token.source === 'app') {
    // An installation that has not accepted the App's Actions write refuses: the stored token (if any) may still be able to.
    const stored = await deps.resolveRepoToken(db, row.project_id, row.repo, { skipApp: true })
    if (!('error' in stored)) {
      status = await call(stored.token)
      storedRefused = true
    }
  }
  const ok = action === 'rerun' ? status === 201 || status === 204 : status === 202 || status === 204
  if (!ok) {
    if (status === 403) {
      return jsonError(c, 'GITHUB_ACTIONS_WRITE_MISSING', storedRefused ? STORED_WRITE_MISSING : WRITE_MISSING, 403, { fix: CI_DEBUG_FIX.githubAccess(row.project_id) })
    }
    if (status === 409) {
      return action === 'rerun'
        ? jsonError(c, 'CI_RUNNING', 'GitHub is still running this workflow; re-run it when it finishes.', 409)
        : jsonError(c, 'NOT_RUNNING', 'GitHub says this run already finished.', 409)
    }
    if (status === 404) return jsonError(c, 'RUN_NOT_FOUND', 'GitHub no longer has this run (runs are kept for a limited time).', 404)
    return jsonError(c, 'GITHUB_ERROR', `GitHub answered ${status}. Try again in a minute.`, 502)
  }
  void deps.logAudit(
    db as never,
    row.project_id,
    c.get('userId') as string,
    'settings.updated',
    'ci_run',
    String(row.run_id),
    { action: action === 'rerun' ? 'ci_rerun_failed_jobs' : 'ci_cancel_run', repo: row.repo, runId: row.run_id, jobId: row.job_id },
    { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' },
  )
  return c.json({ ok: true, data: { runId: row.run_id, action } })
}

export function registerCiJobDebugRoutes(app: Hono<{ Variables: Variables }>, deps: AllDeps): void {
  app.get('/v1/admin/ci/jobs/:id/debug', deps.adminOrApiKeyRead, (c) => debugJob(c, deps))
  app.post('/v1/admin/ci/jobs/:id/explain', deps.adminOrApiKeyWrite, (c) => explainJob(c, deps))
  app.post('/v1/admin/ci/jobs/:id/rerun', deps.adminOrApiKeyWrite, (c) => runAction(c, deps, 'rerun'))
  app.post('/v1/admin/ci/jobs/:id/cancel', deps.adminOrApiKeyWrite, (c) => runAction(c, deps, 'cancel'))
}
