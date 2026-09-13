// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/server/supabase/functions/_shared/agent-adapters.ts
 * PURPOSE: The common interface for CLOUD coding agents that Mushi hands a
 *          fix to and then waits on — plus the one place that turns an
 *          agent outcome (PR opened / failed / finished without a PR) into
 *          fix_attempts + fix_dispatch_jobs + reports writes and the team
 *          notifications. `cursor-webhook`, `agent-status-poll` and
 *          `webhooks-github-indexer` all converge on `applyCloudAgentOutcome`
 *          so the three completion paths cannot drift (or double-notify).
 *
 *          Backends:
 *            cursor_cloud        Cursor Cloud Agents v1 (_shared/cursor-cloud.ts)
 *            github_cloud_agent  GitHub Copilot Agent Tasks (_shared/github-agent-tasks.ts)
 *            anthropic_managed   Anthropic Managed Agents — INTERFACE ONLY.
 *                                The adapter is a typed stub that throws
 *                                `not_implemented`; the beta needs a
 *                                `github_repository` session resource plus
 *                                Standard Webhooks registered in the Console,
 *                                which is a later pass (see the exec plan, C4).
 *
 *          The in-edge `fix-worker` LLM path stays the zero-config default
 *          and never goes through here.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { resolveLlmKey } from './byok.ts'
import { parseGithubRepoUrl } from './github.ts'
import { generateCursorCloudBranchName, validateFixBranchName } from './github-pr.ts'
import { notifyTeamFixEvent } from './team-notify.ts'
import { dispatchPluginEventDetached } from './plugins.ts'
import {
  CursorApiError,
  buildV0WebhookSecret,
  cancelCursorRun,
  createCursorAgentV0,
  createCursorAgentV1,
  cursorWebhookCallbackUrl,
  deterministicCursorAgentId,
  extractCursorBranch,
  extractCursorPrUrl,
  getCursorAgent,
  getCursorRun,
  mapCursorRunStatus,
  preferV0WebhookPath,
} from './cursor-cloud.ts'
import {
  createGithubAgentTask,
  extractGithubTaskError,
  extractGithubTaskHeadRef,
  extractGithubTaskPrUrl,
  getGithubAgentTask,
  mapGithubTaskState,
} from './github-agent-tasks.ts'

const alog = log.child('agent-adapters')

// ─────────────────────────────────────────────────────────────────────────────
// Kinds + allow-lists
// ─────────────────────────────────────────────────────────────────────────────

export type CloudAgentKind = 'cursor_cloud' | 'github_cloud_agent' | 'anthropic_managed'

/** Cloud kinds a project can actually select today (CHECK constraint on
 *  project_settings.autofix_agent). `anthropic_managed` is interface-only. */
export const DISPATCHABLE_CLOUD_AGENTS: ReadonlySet<string> = new Set(['cursor_cloud', 'github_cloud_agent'])

export function isDispatchableCloudAgent(agent: string | null | undefined): agent is 'cursor_cloud' | 'github_cloud_agent' {
  return !!agent && DISPATCHABLE_CLOUD_AGENTS.has(agent)
}

/**
 * Agent overrides accepted by POST /v1/admin/fixes/dispatch (`agent` /
 * `agentOverride`). Runnable in the edge fix-worker: claude_code (default LLM
 * path), rest_worker / rest_fix_worker / llm (aliases of it), cursor_cloud,
 * github_cloud_agent. Orchestrator-only (codex, mcp) are accepted so the
 * worker can stamp an actionable `skipped_unsupported_agent` receipt instead
 * of the route silently swapping the choice. 'auto' = project default.
 */
export const ALLOWED_AGENT_OVERRIDES = [
  'claude_code',
  'codex',
  'auto',
  'rest_worker',
  'rest_fix_worker',
  'llm',
  'mcp',
  'cursor_cloud',
  'github_cloud_agent',
] as const

export type AllowedAgentOverride = (typeof ALLOWED_AGENT_OVERRIDES)[number]

export type AgentOverrideValidation =
  | { ok: true; agent: AllowedAgentOverride | null }
  | { ok: false; code: 'UNSUPPORTED_AGENT'; message: string }

/**
 * Validate the caller's agent choice. Absent ⇒ `{ ok: true, agent: null }`
 * (project default). Unknown ⇒ a 400-shaped error instead of the old silent
 * null (which downgraded `mushi fix --agent cursor_cloud` without a word).
 */
export function validateAgentOverride(raw: unknown): AgentOverrideValidation {
  if (raw === undefined || raw === null || raw === '') return { ok: true, agent: null }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'UNSUPPORTED_AGENT', message: 'agent must be a string' }
  }
  if ((ALLOWED_AGENT_OVERRIDES as readonly string[]).includes(raw)) {
    return { ok: true, agent: raw as AllowedAgentOverride }
  }
  return {
    ok: false,
    code: 'UNSUPPORTED_AGENT',
    message: `agent "${raw}" is not supported. Allowed: ${ALLOWED_AGENT_OVERRIDES.join(', ')}.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter contract
// ─────────────────────────────────────────────────────────────────────────────

/** Subset of a fix_attempts row the adapters read. */
export interface FixAttemptRow {
  id: string
  project_id: string
  report_id: string
  agent: string
  status: string
  pr_url: string | null
  branch_name?: string | null
  cursor_agent_id?: string | null
  cursor_run_id?: string | null
  github_task_id?: string | null
  github_task_url?: string | null
  external_agent_ref?: Record<string, unknown> | null
  started_at?: string | null
}

export interface CloudDispatchInput {
  db: SupabaseClient
  projectId: string
  reportId: string
  dispatchId: string
  attemptId: string
  /** `https://github.com/owner/repo` */
  repoUrl: string
  baseRef: string
  /** Fully composed prompt (see buildCloudAgentPrompt). */
  prompt: string
  /** Branch the agent is asked to push to (recorded for the indexer fallback). */
  branchName?: string
  /** Optional model override (Cursor model id / GitHub model slug). */
  model?: string
  /** Short label for vendor dashboards. */
  name?: string
}

export interface CloudDispatchResult {
  externalAgentId: string
  externalRunId?: string
  statusUrl?: string
  prUrl?: string | null
  /** Vendor-specific extras persisted verbatim into fix_attempts.external_agent_ref. */
  ref?: Record<string, unknown>
}

export interface CloudPollInput {
  db: SupabaseClient
  projectId: string
  attempt: FixAttemptRow
}

export interface CloudPollResult {
  status: 'working' | 'completed' | 'failed' | 'cancelled'
  prUrl?: string | null
  branch?: string | null
  summary?: string
  error?: string
  /** Ids learned while polling (e.g. a v0 agent's latestRunId) to persist. */
  ref?: Record<string, unknown>
}

export interface CloudAgentAdapter {
  kind: CloudAgentKind
  dispatch(input: CloudDispatchInput): Promise<CloudDispatchResult>
  poll(input: CloudPollInput): Promise<CloudPollResult>
}

export class CloudAgentNotImplementedError extends Error {
  readonly code = 'not_implemented' as const
  constructor(kind: CloudAgentKind, detail: string) {
    super(`not_implemented: ${kind} — ${detail}`)
    this.name = 'CloudAgentNotImplementedError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────────

async function resolveVaultRef(db: SupabaseClient, ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null
  if (!ref.startsWith('vault://')) return ref.length > 0 ? ref : null
  const id = ref.slice('vault://'.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) return null
  return typeof data === 'string' && data.length > 0 ? data : null
}

/**
 * Cursor key: BYOK pool row (`byok_keys`, provider 'cursor') → legacy
 * `project_settings.cursor_api_key_ref` (vault ref, what the Integrations
 * page writes) → env `CURSOR_API_KEY` (self-host). resolveLlmKey already
 * covers the pool + env; the project-level ref is checked BEFORE the env
 * fallback so a project's own key always beats the platform-wide one.
 */
export async function resolveCursorApiKey(db: SupabaseClient, projectId: string): Promise<string | null> {
  const resolved = await resolveLlmKey(db, projectId, 'cursor')
  if (resolved?.source === 'byok' && resolved.key) return resolved.key

  const { data } = await db
    .from('project_settings')
    .select('cursor_api_key_ref')
    .eq('project_id', projectId)
    .maybeSingle()
  const ref = (data as { cursor_api_key_ref?: string | null } | null)?.cursor_api_key_ref ?? null
  const fromRef = await resolveVaultRef(db, ref)
  if (fromRef) return fromRef

  return resolved?.key ?? null
}

/**
 * GitHub USER-TO-SERVER token for Agent Tasks: `project_settings.
 * github_user_token_ref` (vault ref; column added by a sibling migration —
 * a missing column is treated as "not configured") → env `GITHUB_TOKEN`.
 * Installation tokens from resolveProjectGithubToken are deliberately NOT
 * consulted: the Agent Tasks API rejects them.
 */
export async function resolveGithubUserToken(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await db
    .from('project_settings')
    .select('github_user_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) {
    alog.warn('github_user_token_ref not readable (column missing?) — falling back to GITHUB_TOKEN', {
      projectId,
      error: error.message,
    })
  } else {
    const ref = (data as { github_user_token_ref?: string | null } | null)?.github_user_token_ref ?? null
    const token = await resolveVaultRef(db, ref)
    if (token) return token
  }
  return (typeof Deno !== 'undefined' ? Deno.env.get('GITHUB_TOKEN') : undefined) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt + branch conventions shared by every cloud backend
// ─────────────────────────────────────────────────────────────────────────────

export interface CloudAgentPromptContext {
  reportId: string
  repoOwner: string
  repoName: string
  baseRef: string
  branchName: string
  /** 'cursor_cloud' | 'github_cloud_agent' — only changes the wording. */
  kind: CloudAgentKind
}

/**
 * Wrap the fix-worker's user prompt (same bug report / RAG / inventory
 * context the in-edge path builds) with the instructions a repo-level agent
 * needs and the LLM-only path never had: branch + base ref, the DRAFT PR
 * requirement (Cursor has no draft flag; Copilot opens drafts by default but
 * we still say it), the PR title convention that webhooks-github-indexer and
 * the console rely on, and the "do not merge" rule.
 */
export function buildCloudAgentPrompt(basePrompt: string, ctx: CloudAgentPromptContext): string {
  const agentLabel = ctx.kind === 'github_cloud_agent' ? 'GitHub Copilot cloud agent' : 'Cursor Cloud Agent'
  return `${basePrompt.trimEnd()}

## Cloud agent instructions (${agentLabel})
You have the full repository \`${ctx.repoOwner}/${ctx.repoName}\` checked out. The "Relevant Code" above is a retrieval hint, not a boundary — read whatever you need.

1. Start from \`${ctx.baseRef}\`. Create the branch \`${ctx.branchName}\` and push your commits there (if the platform forces its own branch name, keep \`MUSHI-${ctx.reportId}\` in it).
2. Make the smallest change that fixes the bug. Add or update a test when you change behaviour. Do not refactor unrelated code.
3. Open the pull request as a DRAFT against \`${ctx.baseRef}\`. Title it \`fix: <short summary> (MUSHI-${ctx.reportId})\` and include the line \`Mushi report: ${ctx.reportId}\` in the description, followed by what you changed and why.
4. Never merge, never force-push, never touch secrets or CI credentials. A human reviews every line before merge.
5. If you cannot find the cause, still open the draft PR with a \`NEEDS_INVESTIGATION.md\` describing what you checked and what to look at next.`
}

/** Branch the agent is asked to use; the Cursor helper owns the prefix/validation rules. */
export function cloudAgentBranchName(kind: CloudAgentKind, reportId: string, category?: string | null): string {
  const cursorName = generateCursorCloudBranchName(reportId, category)
  if (kind === 'cursor_cloud') return cursorName
  const name = cursorName.replace(/-cursor-cloud$/, kind === 'github_cloud_agent' ? '-github-agent' : '-managed-agent')
  validateFixBranchName(name)
  return name
}

/** `<prefix>/MUSHI-<uuid>-<suffix>` ⇒ { reportId, kind } for head-ref matching. */
export const MUSHI_CLOUD_BRANCH_RE =
  /MUSHI-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(cursor-cloud|github-agent|managed-agent)/i

export function parseCloudAgentBranchRef(headRef: string | null | undefined): { reportId: string; kind: CloudAgentKind } | null {
  if (!headRef) return null
  const m = MUSHI_CLOUD_BRANCH_RE.exec(headRef)
  if (!m) return null
  const kind: CloudAgentKind = m[2].toLowerCase() === 'github-agent'
    ? 'github_cloud_agent'
    : m[2].toLowerCase() === 'managed-agent'
      ? 'anthropic_managed'
      : 'cursor_cloud'
  return { reportId: m[1].toLowerCase(), kind }
}

// ─────────────────────────────────────────────────────────────────────────────
// cursor_cloud
// ─────────────────────────────────────────────────────────────────────────────

const cursorAdapter: CloudAgentAdapter = {
  kind: 'cursor_cloud',

  async dispatch(input) {
    const apiKey = await resolveCursorApiKey(input.db, input.projectId)
    if (!apiKey) {
      throw new Error(
        'Cursor API key not configured. Add a crsr_… key under Settings → Integrations → Cursor Cloud (or BYOK provider "cursor").',
      )
    }
    const client = { apiKey }

    if (preferV0WebhookPath()) {
      // v0: the only API that pushes a completion webhook back to us today.
      const secret = await buildV0WebhookSecret(input.projectId)
      const created = await createCursorAgentV0(client, {
        prompt: input.prompt,
        repoUrl: input.repoUrl,
        ref: input.baseRef,
        branchName: input.branchName,
        model: input.model,
        autoCreatePr: true,
        webhook: { url: cursorWebhookCallbackUrl(input.projectId), secret },
      })
      return {
        externalAgentId: created.id,
        statusUrl: created.target?.url,
        prUrl: created.target?.prUrl ?? null,
        ref: { api: 'v0', webhook: true },
      }
    }

    const agentId = await deterministicCursorAgentId(input.dispatchId)
    try {
      const created = await createCursorAgentV1(client, {
        prompt: input.prompt,
        repoUrl: input.repoUrl,
        startingRef: input.baseRef,
        agentId,
        name: input.name ?? `Mushi fix ${input.reportId.slice(0, 8)}`,
        model: input.model,
        autoCreatePR: true,
        skipReviewerRequest: true,
        envVars: {
          MUSHI_PROJECT_ID: input.projectId,
          MUSHI_REPORT_ID: input.reportId,
          MUSHI_FIX_ATTEMPT_ID: input.attemptId,
        },
      })
      return {
        externalAgentId: created.agent.id,
        externalRunId: created.run.id,
        statusUrl: created.agent.url,
        prUrl: extractCursorPrUrl(created.run),
        ref: { api: 'v1', runStatus: created.run.status },
      }
    } catch (err) {
      // Same dispatchId re-POSTed (sweeper re-invoke, lost response):
      // Cursor already has this agent. Recover its run id instead of failing.
      if (err instanceof CursorApiError && err.status === 409 && err.code === 'agent_id_conflict') {
        alog.info('Cursor agent already exists for dispatch — reusing', { dispatchId: input.dispatchId, agentId })
        const existing = await getCursorAgent(client, agentId)
        return {
          externalAgentId: existing.id,
          externalRunId: existing.latestRunId,
          statusUrl: existing.url,
          prUrl: null,
          ref: { api: 'v1', reused: true },
        }
      }
      throw err
    }
  },

  async poll({ db, projectId, attempt }) {
    const apiKey = await resolveCursorApiKey(db, projectId)
    if (!apiKey) return { status: 'working', error: 'Cursor API key not configured' }
    const client = { apiKey }
    const agentId = attempt.cursor_agent_id
    if (!agentId) return { status: 'failed', error: 'fix_attempts.cursor_agent_id is empty' }

    let runId = attempt.cursor_run_id ?? null
    const learned: Record<string, unknown> = {}
    if (!runId) {
      // v0-created agents carry no run id; the v1 agent resource exposes it.
      const agent = await getCursorAgent(client, agentId)
      runId = agent.latestRunId ?? null
      if (!runId) return { status: 'working' }
      learned.cursor_run_id = runId
    }
    const run = await getCursorRun(client, agentId, runId)
    const status = mapCursorRunStatus(run.status)
    return {
      status,
      prUrl: extractCursorPrUrl(run),
      branch: extractCursorBranch(run),
      summary: typeof run.result === 'string' ? run.result.slice(0, 2000) : undefined,
      error: status === 'failed' ? `Cursor run ${run.status}` : undefined,
      ref: { ...learned, runStatus: run.status, durationMs: run.durationMs ?? null },
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// github_cloud_agent
// ─────────────────────────────────────────────────────────────────────────────

const githubAdapter: CloudAgentAdapter = {
  kind: 'github_cloud_agent',

  async dispatch(input) {
    const token = await resolveGithubUserToken(input.db, input.projectId)
    if (!token) {
      throw new Error(
        'GitHub cloud agent needs a user-to-server token. Store a fine-grained PAT with "Agent tasks" (read+write), Contents and Pull requests as project_settings.github_user_token_ref (vault) or set GITHUB_TOKEN. Installation tokens are rejected by the Agent Tasks API.',
      )
    }
    const repo = parseGithubRepoUrl(input.repoUrl)
    if (!repo) throw new Error(`GitHub cloud agent: cannot parse repo URL "${input.repoUrl}"`)
    const task = await createGithubAgentTask(
      { token },
      {
        owner: repo.owner,
        repo: repo.repo,
        prompt: input.prompt,
        baseRef: input.baseRef,
        model: input.model,
        createPullRequest: true,
      },
    )
    return {
      externalAgentId: task.id,
      statusUrl: task.html_url,
      prUrl: extractGithubTaskPrUrl(task),
      ref: { api: 'agent-tasks/2026-03-10', state: task.state, owner: repo.owner, repo: repo.repo },
    }
  },

  async poll({ db, projectId, attempt }) {
    const token = await resolveGithubUserToken(db, projectId)
    if (!token) return { status: 'working', error: 'GitHub user token not configured' }
    const taskId = attempt.github_task_id
    if (!taskId) return { status: 'failed', error: 'fix_attempts.github_task_id is empty' }
    const ref = (attempt.external_agent_ref ?? {}) as { owner?: unknown; repo?: unknown }
    const owner = typeof ref.owner === 'string' ? ref.owner : undefined
    const repoName = typeof ref.repo === 'string' ? ref.repo : undefined
    const task = await getGithubAgentTask({ token }, { taskId, owner, repo: repoName })
    const status = mapGithubTaskState(task.state)
    return {
      status,
      prUrl: extractGithubTaskPrUrl(task),
      branch: extractGithubTaskHeadRef(task),
      error: status === 'failed' ? (extractGithubTaskError(task) ?? `GitHub agent task ${task.state}`) : undefined,
      ref: { state: task.state, sessionCount: task.session_count ?? null },
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// anthropic_managed — interface only
// ─────────────────────────────────────────────────────────────────────────────

const anthropicManagedAdapter: CloudAgentAdapter = {
  kind: 'anthropic_managed',
  dispatch() {
    return Promise.reject(
      new CloudAgentNotImplementedError(
        'anthropic_managed',
        'Anthropic Managed Agents (beta managed-agents-2026-04-01) is designed into this interface but not built: it needs a github_repository session resource + Console-registered Standard Webhooks. Pick cursor_cloud or github_cloud_agent.',
      ),
    )
  },
  poll() {
    return Promise.reject(new CloudAgentNotImplementedError('anthropic_managed', 'no poll endpoint wired'))
  },
}

const REGISTRY: Record<CloudAgentKind, CloudAgentAdapter> = {
  cursor_cloud: cursorAdapter,
  github_cloud_agent: githubAdapter,
  anthropic_managed: anthropicManagedAdapter,
}

export function getCloudAgentAdapter(kind: string): CloudAgentAdapter {
  const adapter = REGISTRY[kind as CloudAgentKind]
  if (!adapter) throw new Error(`Unknown cloud agent kind "${kind}"`)
  return adapter
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome application — the single completion path
// ─────────────────────────────────────────────────────────────────────────────

export type CloudAgentOutcome =
  | { kind: 'pr_opened'; prUrl: string; branch?: string | null; summary?: string | null }
  | { kind: 'completed_no_pr'; summary?: string | null }
  | { kind: 'failed'; error: string; failureCategory?: string | null }

export interface CloudAgentOutcomeTarget {
  attemptId: string
  projectId: string
  reportId: string
  agent: string
}

export interface CloudAgentOutcomeResult {
  applied: boolean
  reason?: 'already_has_pr' | 'pr_url_conflict' | 'not_open' | 'update_failed'
}

const OPEN_ATTEMPT_STATUSES = ['running', 'queued', 'dispatched', 'pending']

function failureCategoryFor(agent: string, explicit?: string | null): string {
  if (explicit) return explicit
  return agent === 'github_cloud_agent' ? 'github_other_error' : 'cursor_api_error'
}

/**
 * Idempotent: the PR write is guarded on `pr_url IS NULL` at write time, so a
 * webhook, a poll tick and a GitHub `pull_request.opened` delivery racing for
 * the same attempt produce exactly one transition and one notification. A
 * unique-index hit on `uq_fix_attempts_pr_url` (another attempt already owns
 * that PR) is logged and skipped, as is an attempt that is no longer open.
 */
export async function applyCloudAgentOutcome(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  outcome: CloudAgentOutcome,
): Promise<CloudAgentOutcomeResult> {
  const now = new Date().toISOString()

  if (outcome.kind === 'pr_opened') {
    const { data: updated, error } = await db
      .from('fix_attempts')
      .update({
        status: 'completed',
        pr_url: outcome.prUrl,
        pr_state: 'open',
        ...(outcome.branch ? { branch: outcome.branch, branch_name: outcome.branch } : {}),
        ...(outcome.summary ? { summary: outcome.summary.slice(0, 2000) } : {}),
        completed_at: now,
      })
      .eq('id', target.attemptId)
      .is('pr_url', null)
      .select('id')
    if (error) {
      if (error.code === '23505') {
        alog.warn('PR already attached to another fix attempt — skipping', {
          attemptId: target.attemptId,
          prUrl: outcome.prUrl,
        })
        return { applied: false, reason: 'pr_url_conflict' }
      }
      alog.error('fix_attempts PR update failed', { attemptId: target.attemptId, error: error.message })
      return { applied: false, reason: 'update_failed' }
    }
    if (!updated || updated.length === 0) return { applied: false, reason: 'already_has_pr' }

    await db
      .from('fix_dispatch_jobs')
      .update({ status: 'completed', pr_url: outcome.prUrl, finished_at: now })
      .eq('fix_attempt_id', target.attemptId)
      .in('status', ['queued', 'running'])

    // Mirror onto the report exactly like the in-edge success path and
    // PATCH /v1/admin/fixes/:id do (reports.fix_pr_url is what the console
    // and MCP triage read).
    await db
      .from('reports')
      .update({
        fix_pr_url: outcome.prUrl,
        ...(outcome.branch ? { fix_branch: outcome.branch } : {}),
        status: 'fixing',
        processing_error: null,
      })
      .eq('id', target.reportId)
      .eq('project_id', target.projectId)

    await insertFixEvent(db, {
      fix_attempt_id: target.attemptId,
      project_id: target.projectId,
      kind: 'pr_opened',
      status: 'ok',
      label: 'Draft PR opened by cloud agent',
      detail: outcome.prUrl,
      dedupe_key: `cloud-pr:${target.attemptId}`,
      payload: { agent: target.agent, prUrl: outcome.prUrl, branch: outcome.branch ?? null },
    })

    dispatchPluginEventDetached(db, target.projectId, 'fix.proposed', {
      report: { id: target.reportId },
      fix: {
        id: target.attemptId,
        agent: target.agent,
        branch: outcome.branch ?? null,
        prUrl: outcome.prUrl,
        summary: outcome.summary ?? null,
      },
    }).catch((e) => alog.warn('Plugin dispatch failed', { event: 'fix.proposed', err: String(e) }))

    void notifyTeamFixEvent(db, target.projectId, target.reportId, 'fix_pr_opened', {
      prUrl: outcome.prUrl,
      branch: outcome.branch ?? null,
    }).catch((e) => alog.warn('Team fix notification failed', { event: 'fix_pr_opened', err: String(e) }))

    return { applied: true }
  }

  // Terminal without a PR (failed / cancelled / finished empty-handed).
  const isFailure = outcome.kind === 'failed'
  const errorText = isFailure
    ? outcome.error.slice(0, 1000)
    : 'Cloud agent finished without opening a pull request.'
  const { data: closed, error: closeErr } = await db
    .from('fix_attempts')
    .update({
      status: 'failed',
      error: errorText,
      failure_category: failureCategoryFor(target.agent, isFailure ? outcome.failureCategory : null),
      ...(!isFailure && outcome.summary ? { summary: outcome.summary.slice(0, 2000) } : {}),
      completed_at: now,
    })
    .eq('id', target.attemptId)
    .in('status', OPEN_ATTEMPT_STATUSES)
    .select('id')
  if (closeErr) {
    alog.error('fix_attempts close failed', { attemptId: target.attemptId, error: closeErr.message })
    return { applied: false, reason: 'update_failed' }
  }
  if (!closed || closed.length === 0) return { applied: false, reason: 'not_open' }

  await db
    .from('fix_dispatch_jobs')
    .update({
      status: isFailure ? 'failed' : 'completed_no_pr',
      error: errorText.slice(0, 500),
      finished_at: now,
    })
    .eq('fix_attempt_id', target.attemptId)
    .in('status', ['queued', 'running'])

  await db
    .from('reports')
    .update({ processing_error: `autofix_blocked: ${errorText}`.slice(0, 500) })
    .eq('id', target.reportId)
    .eq('project_id', target.projectId)

  await insertFixEvent(db, {
    fix_attempt_id: target.attemptId,
    project_id: target.projectId,
    kind: 'failed',
    status: 'fail',
    label: isFailure ? 'Cloud agent failed' : 'Cloud agent finished without a PR',
    detail: errorText.slice(0, 500),
    dedupe_key: `cloud-final:${target.attemptId}`,
    payload: { agent: target.agent },
  })

  dispatchPluginEventDetached(db, target.projectId, 'fix.failed', {
    report: { id: target.reportId },
    fix: { id: target.attemptId, agent: target.agent, error: errorText.slice(0, 500) },
  }).catch((e) => alog.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }))

  void notifyTeamFixEvent(db, target.projectId, target.reportId, 'fix_failed', {
    error: errorText.slice(0, 500),
    failureCategory: failureCategoryFor(target.agent, isFailure ? outcome.failureCategory : null),
  }).catch((e) => alog.warn('Team fix notification failed', { event: 'fix_failed', err: String(e) }))

  return { applied: true }
}

async function insertFixEvent(
  db: SupabaseClient,
  row: {
    fix_attempt_id: string
    project_id: string
    kind: 'dispatched' | 'pr_opened' | 'failed' | 'completed'
    status: 'ok' | 'fail' | 'pending'
    label: string
    detail?: string | null
    dedupe_key: string
    payload?: Record<string, unknown> | null
  },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: row.kind,
    status: row.status,
    label: row.label,
    detail: row.detail ?? null,
    at: new Date().toISOString(),
    dedupe_key: row.dedupe_key,
    payload: row.payload ?? null,
  })
  // 23505 on dedupe_key is the expected replay signal — not a warning.
  if (error && error.code !== '23505') {
    alog.warn('fix_events insert failed (non-fatal)', { kind: row.kind, err: error.message })
  }
}

/** Timeline breadcrumb the fix-worker writes right after a successful dispatch. */
export async function recordCloudAgentDispatched(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  result: CloudDispatchResult,
): Promise<void> {
  await insertFixEvent(db, {
    fix_attempt_id: target.attemptId,
    project_id: target.projectId,
    kind: 'dispatched',
    status: 'pending',
    label: `Dispatched to ${target.agent}`,
    detail: result.statusUrl ?? result.externalAgentId,
    dedupe_key: `cloud-dispatch:${target.attemptId}`,
    payload: { agent: target.agent, externalAgentId: result.externalAgentId, externalRunId: result.externalRunId ?? null },
  })
}

/**
 * Operator cancel (POST /v1/admin/fixes/dispatches/:id/cancel) for a cloud
 * attempt: best-effort vendor cancel (Cursor v1 has one; GitHub Agent Tasks
 * has no cancel endpoint) and close the attempt so the poller stops and the
 * report can be re-dispatched. No team notification — the operator did this.
 */
export async function cancelCloudAgentAttempt(
  db: SupabaseClient,
  input: { attemptId: string; projectId: string; kind: string; externalAgentId?: string | null; externalRunId?: string | null },
): Promise<{ vendorCancelled: boolean }> {
  let vendorCancelled = false
  if (input.kind === 'cursor_cloud' && input.externalAgentId && input.externalRunId) {
    try {
      const apiKey = await resolveCursorApiKey(db, input.projectId)
      if (apiKey) {
        await cancelCursorRun({ apiKey }, input.externalAgentId, input.externalRunId)
        vendorCancelled = true
      }
    } catch (err) {
      // 409 run_not_cancellable (already finished) is the common case.
      alog.info('Cursor run cancel skipped', { attemptId: input.attemptId, err: String(err).slice(0, 200) })
    }
  }
  await db
    .from('fix_attempts')
    .update({
      status: 'cancelled',
      error: 'Cancelled by operator.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', input.attemptId)
    .in('status', OPEN_ATTEMPT_STATUSES)
  return { vendorCancelled }
}

/** Poll → outcome mapping shared by the cron poller (kept pure for tests). */
export function pollResultToOutcome(poll: CloudPollResult): CloudAgentOutcome | null {
  switch (poll.status) {
    case 'working':
      return null
    case 'completed':
      return poll.prUrl
        ? { kind: 'pr_opened', prUrl: poll.prUrl, branch: poll.branch ?? null, summary: poll.summary ?? null }
        : { kind: 'completed_no_pr', summary: poll.summary ?? null }
    case 'cancelled':
      return { kind: 'failed', error: poll.error ?? 'Cloud agent run was cancelled' }
    case 'failed':
      return { kind: 'failed', error: poll.error ?? 'Cloud agent run failed' }
  }
}
