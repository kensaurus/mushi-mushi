// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
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
import { resolveLlmKey, resolveLlmKeys } from './byok.ts'
import { keyScopeFor, ownerUserColumnReady, projectKeyOwner, withOwnerUserColumn } from './byok-scope.ts'
import { isCursorKeyLimitError } from './spend-down.ts'
import { fetchPullRequestFiles, parseGithubRepoUrl, prNumberFromUrl, resolveProjectGithubToken } from './github.ts'
import { canonicalPrUrl, classifyPrSubstance, parsePullRequestUrl, type PrChangedFile } from './pr-substance.ts'
import { classifyNoPrSummary, noPrErrorText } from './cloud-agent-no-pr.ts'
import { generateCursorCloudBranchName, validateFixBranchName } from './github-pr.ts'
import { notifyTeamFixEvent } from './team-notify.ts'
import { dispatchPluginEventDetached } from './plugins.ts'
import { enqueueFixReview } from './fix-review-db.ts'
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
  /**
   * Spend-down already chose this `byok_keys` id. The Cursor adapter uses it
   * instead of resolving the pool: the pool still returns a quota-held row
   * after its cooldown, which would bill the key spend-down skipped.
   */
  pinnedCursorKeyId?: string
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
 * Cursor key, in ADR 0023's order: the app's own pool row (`byok_keys`,
 * provider 'cursor') → its legacy `project_settings.cursor_api_key_ref`
 * (vault ref, what the Integrations page writes) → the organization's shared
 * pool row → the universal keys of its organization's owners (ADR 0031) →
 * env `CURSOR_API_KEY` (self-host).
 *
 * Until 2026-10-20 any pool row, shared included, came first, so adding a
 * shared Cursor key moved every app with a legacy key onto it (mushi-mushi
 * started billing another account). The spend-down worker reads the same
 * order (`_shared/spend-down-db.ts`).
 */
export async function resolveCursorApiKey(db: SupabaseClient, projectId: string): Promise<string | null> {
  return (await resolveCursorApiKeyWithSource(db, projectId))?.key ?? null
}

/**
 * The same pick as resolveCursorApiKey, plus where it came from: the
 * `byok_keys` id for a pool key, 'legacy' for the Integrations key, 'env'
 * for the self-host fallback. Review follow-ups (ADR 0032) record the key id
 * and poll the run with the same key.
 */
export async function resolveCursorApiKeyWithSource(
  db: SupabaseClient,
  projectId: string,
): Promise<{ key: string; keyId: string | null; source: 'pool' | 'legacy' | 'env' } | null> {
  const resolved = await resolveLlmKey(db, projectId, 'cursor')
  if (resolved?.source === 'byok' && resolved.key && !resolved.shared) {
    return { key: resolved.key, keyId: resolved.keyId ?? null, source: 'pool' }
  }

  const { data } = await db
    .from('project_settings')
    .select('cursor_api_key_ref')
    .eq('project_id', projectId)
    .maybeSingle()
  const ref = (data as { cursor_api_key_ref?: string | null } | null)?.cursor_api_key_ref ?? null
  const fromRef = await resolveVaultRef(db, ref)
  if (fromRef) return { key: fromRef, keyId: null, source: 'legacy' }

  if (!resolved?.key) return null
  return resolved.source === 'byok'
    ? { key: resolved.key, keyId: resolved.keyId ?? null, source: 'pool' }
    : { key: resolved.key, keyId: null, source: 'env' }
}

/**
 * How long a Cursor key Cursor refused for its plan's usage limit is skipped
 * for NEW agents (`byok_keys.exhausted_until`). Runs it already started keep
 * polling with it. On 2026-10-24 three accounts were run to their limits one
 * after another; the used-up key stayed first and the next one idled.
 */
const CURSOR_KEY_EXHAUSTED_MS = 6 * 3_600_000

async function exhaustedCursorKeyIds(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db
    .from('byok_keys')
    .select('id')
    .eq('provider_slug', 'cursor')
    .gt('exhausted_until', new Date().toISOString())
  // Before the column exists every key counts as available.
  if (error) return new Set()
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}

/**
 * The Cursor key spend-down named, when this project may use it. Null when
 * the row is missing, not Cursor, not active, used up, out of scope, or has
 * no secret — the caller must not fall back to the pool, which would bill
 * the quota-held key spend-down skipped.
 */
async function cursorKeyPinned(
  db: SupabaseClient,
  projectId: string,
  keyId: string,
): Promise<{ key: string; keyId: string; source: 'pool' } | null> {
  const ready = await ownerUserColumnReady(db)
  const { data, error } = await db
    .from('byok_keys')
    .select(withOwnerUserColumn('id, provider_slug, project_id, organization_id, status, vault_secret_id, exhausted_until', ready))
    .eq('id', keyId)
    .maybeSingle()
  const row = data as {
    id: string
    provider_slug: string
    project_id: string | null
    organization_id: string | null
    owner_user_id?: string | null
    status: string
    vault_secret_id: string | null
    exhausted_until?: string | null
  } | null
  if (error || !row || row.provider_slug !== 'cursor' || row.status !== 'active') return null
  if (row.exhausted_until && Date.parse(row.exhausted_until) > Date.now()) return null
  const owner = await projectKeyOwner(db, projectId)
  if (!keyScopeFor(row, owner)) return null
  const secret = await resolveVaultRef(db, row.vault_secret_id ? `vault://${row.vault_secret_id}` : null)
  if (!secret) return null
  return { key: secret, keyId: row.id, source: 'pool' }
}

/** The key for a new agent: the resolver's pick, or the next one when that one is used up. */
export async function cursorKeyForNewWork(
  db: SupabaseClient,
  projectId: string,
): Promise<{ key: string; keyId: string | null; source: 'pool' | 'legacy' | 'env' } | null> {
  const first = await resolveCursorApiKeyWithSource(db, projectId)
  if (!first?.keyId) return first
  const exhausted = await exhaustedCursorKeyIds(db)
  if (!exhausted.has(first.keyId)) return first
  const next = (await resolveLlmKeys(db, projectId, 'cursor')).find((c) => c.keyId && !exhausted.has(c.keyId))
  // Every key used up: try the first anyway; Cursor answers for itself.
  return next ? { key: next.key, keyId: next.keyId ?? null, source: 'pool' } : first
}

/** Mark a key used up for new agents (Cursor refused it for its usage limit). */
export async function markCursorKeyExhausted(db: SupabaseClient, keyId: string, reason: string): Promise<void> {
  const { error } = await db
    .from('byok_keys')
    .update({ exhausted_until: new Date(Date.now() + CURSOR_KEY_EXHAUSTED_MS).toISOString(), last_error: reason.slice(0, 500) })
    .eq('id', keyId)
  if (error) alog.warn('Cursor key not marked used up', { keyId, err: error.message })
}

/** The key that started this attempt's run (recorded on it), else the app's current first key. */
async function markRunKeyExhausted(db: SupabaseClient, target: CloudAgentOutcomeTarget, reason: string): Promise<void> {
  const { data } = await db.from('fix_attempts').select('external_agent_ref').eq('id', target.attemptId).maybeSingle()
  const recorded = ((data as { external_agent_ref?: { key_id?: unknown } } | null)?.external_agent_ref?.key_id)
  const keyId = typeof recorded === 'string' && recorded ? recorded : (await resolveCursorApiKeyWithSource(db, target.projectId))?.keyId
  if (keyId) await markCursorKeyExhausted(db, keyId, reason)
}

/** The key a run was started with (recorded on the attempt), else the resolver's pick. */
async function cursorKeyForRun(db: SupabaseClient, projectId: string, ref: unknown): Promise<string | null> {
  const keyId = (ref as { key_id?: unknown } | null)?.key_id
  if (typeof keyId === 'string' && keyId) {
    const { data } = await db.from('byok_keys').select('vault_secret_id, provider_slug').eq('id', keyId).maybeSingle()
    const row = data as { vault_secret_id?: string | null; provider_slug?: string } | null
    if (row?.provider_slug === 'cursor' && row.vault_secret_id) {
      const key = await resolveVaultRef(db, `vault://${row.vault_secret_id}`)
      if (key) return key
    }
  }
  return resolveCursorApiKey(db, projectId)
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
5. If you cannot find the cause, do NOT open a pull request. Finish the run without one and explain in your final message what you checked and what to look at next. A pull request that only adds notes, markdown or TODO comments is not a fix: Mushi flags it as needs-investigation and leaves the report open.
6. When you finish without a pull request, make the first line of your final message \`Mushi verdict: <verdict>\`, where <verdict> is one of: \`already_fixed\` (the bug no longer happens on \`${ctx.baseRef}\` or the live site), \`wrong_repo\` (the code to change is in another repository), \`not_actionable\` (nothing in the evidence ties it to code), \`needs_human\` (it waits on a person: a decision, an account, a device, money). Leave the line out if none fits. Mushi reads it to decide whether to run an agent on this report again.`
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
    // A spend-down run names its key. Do not resolve the pool: that still
    // returns a quota-held row, and the call would be billed to the key
    // spend-down skipped.
    const pinned = input.pinnedCursorKeyId
      ? await cursorKeyPinned(input.db, input.projectId, input.pinnedCursorKeyId)
      : null
    if (input.pinnedCursorKeyId && !pinned) {
      throw new Error('Spend-down Cursor key is not usable for this app.')
    }
    const picked = pinned ?? (await cursorKeyForNewWork(input.db, input.projectId))
    if (!picked?.key) {
      throw new Error(
        'Cursor API key not configured. Add a crsr_… key under Settings → Integrations → Cursor Cloud (or BYOK provider "cursor").',
      )
    }
    // A key Cursor refuses for its usage limit is marked used up and the same
    // dispatch goes once more on the next key, so nothing waits for a retry.
    // A pinned spend-down key does not: the next pick would be the pool's,
    // which can be the quota-held key this run was started to avoid. The
    // next spend-down tick sees exhausted_until and pins the following key.
    let key = picked
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await cursorDispatchWithKey(input, { apiKey: key.key })
        // The run is polled and cancelled with the key that started it.
        return key.keyId ? { ...result, ref: { ...(result.ref ?? {}), key_id: key.keyId } } : result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!key.keyId || !isCursorKeyLimitError(message)) throw err
        await markCursorKeyExhausted(input.db, key.keyId, message)
        if (input.pinnedCursorKeyId) throw err
        const next = attempt === 0 ? await cursorKeyForNewWork(input.db, input.projectId) : null
        if (!next?.key || next.keyId === key.keyId) throw err
        alog.info('Cursor key used up; dispatching on the next key', { usedUp: key.keyId, next: next.keyId })
        key = next
      }
    }
  },

  async poll({ db, projectId, attempt }) {
    const apiKey = await cursorKeyForRun(db, projectId, attempt.external_agent_ref)
    if (!apiKey) return { status: 'working', error: 'Cursor API key not configured' }
    return cursorPollWithKey(db, attempt, { apiKey })
  },
}

async function cursorDispatchWithKey(input: CloudDispatchInput, client: { apiKey: string }): Promise<CloudDispatchResult> {

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
    // Cursor v1 refuses envVars together with a client-chosen agentId
    // (400 validation_error, 2026-10-03). The deterministic agentId is what
    // keeps a retried dispatch from starting a second agent, so the ids the
    // agent needs travel in the prompt instead; none of them is a secret.
    const created = await createCursorAgentV1(client, {
      prompt: `${input.prompt}

Mushi ids for this fix: project ${input.projectId}, report ${input.reportId}, fix attempt ${input.attemptId}.`,
      repoUrl: input.repoUrl,
      startingRef: input.baseRef,
      agentId,
      name: input.name ?? `Mushi fix ${input.reportId.slice(0, 8)}`,
      model: input.model,
      autoCreatePR: true,
      skipReviewerRequest: true,
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
}

async function cursorPollWithKey(db: SupabaseClient, attempt: CloudPollInput['attempt'], client: { apiKey: string }): Promise<CloudPollResult> {
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
  | {
      kind: 'pr_opened'
      prUrl: string
      branch?: string | null
      summary?: string | null
      /**
       * True when the vendor says the agent run is over (poll `completed`,
       * Cursor FINISHED), so the PR's files are final. A `pull_request.opened`
       * delivery or a PR seen at dispatch time leaves it unset: the GitHub
       * Copilot agent opens its draft PR before it pushes anything.
       */
      agentFinished?: boolean
    }
  | { kind: 'completed_no_pr'; summary?: string | null }
  | { kind: 'failed'; error: string; failureCategory?: string | null }

export interface CloudAgentOutcomeTarget {
  attemptId: string
  projectId: string
  reportId: string
  agent: string
  /**
   * The PR already attached to this still-open attempt while the agent was
   * working (fix_attempts.pr_url). A final "finished without a PR" then means
   * "finished, and that PR is the result", so it is judged, not dropped.
   */
  pendingPrUrl?: string | null
}

export interface CloudAgentOutcomeResult {
  applied: boolean
  reason?: 'already_has_pr' | 'pr_url_conflict' | 'not_open' | 'update_failed' | 'invalid_pr_url'
  /** The PR only adds notes (markdown / TODO comments), or the finished
   *  agent's PR changes nothing: the attempt is flagged needs-investigation
   *  and the report is NOT moved to fixing. */
  needsInvestigation?: true
  /** The agent is still working and its PR has no code change yet: the PR
   *  is attached, the attempt stays open, and the verdict waits for the
   *  agent to finish (agent-status-poll / cursor-webhook). */
  awaitingChanges?: true
}

/** What Mushi could read of a cloud agent's PR before trusting it. */
export type CloudPrInspection =
  | { kind: 'read'; files: PrChangedFile[]; complete: boolean }
  | { kind: 'unread'; reason: string }

export interface CloudAgentOutcomeDeps {
  /** Reads the PR's changed files; injectable for tests. */
  inspectPr?: (db: SupabaseClient, projectId: string, prUrl: string) => Promise<CloudPrInspection>
}

/**
 * Read a cloud agent PR's changed files with the project's own GitHub token:
 * the App installation bound to that repo when there is one, else the
 * project / org PAT, else the platform token (resolveProjectGithubToken's
 * order). Never throws; an unreadable PR is reported, not guessed.
 */
export async function inspectCloudAgentPr(
  db: SupabaseClient,
  projectId: string,
  prUrl: string,
): Promise<CloudPrInspection> {
  const pr = parsePullRequestUrl(prUrl)
  if (!pr) return { kind: 'unread', reason: 'not a GitHub pull request URL' }
  try {
    const { data: repoRow } = await db
      .from('project_repos')
      .select('github_app_installation_id')
      .eq('project_id', projectId)
      .eq('repo_url', `https://github.com/${pr.owner}/${pr.repo}`)
      .limit(1)
      .maybeSingle()
    const installationId =
      (repoRow as { github_app_installation_id?: number | null } | null)?.github_app_installation_id ?? null
    const token = await resolveProjectGithubToken(db, projectId, installationId)
    if (!token) return { kind: 'unread', reason: 'no GitHub token is stored for this project' }
    const listed = await fetchPullRequestFiles(token, { owner: pr.owner, repo: pr.repo }, pr.number)
    if (!listed) return { kind: 'unread', reason: 'GitHub did not find the pull request' }
    return { kind: 'read', files: listed.files, complete: listed.complete }
  } catch (err) {
    return { kind: 'unread', reason: String(err instanceof Error ? err.message : err).slice(0, 200) }
  }
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
 *
 * Before a PR moves the report to `fixing`, its changed files are read:
 *   - a PR that only adds notes (markdown, a NEEDS_INVESTIGATION file, TODO
 *     comments), or a finished agent's PR that changes no file, closes the
 *     attempt as needs-investigation;
 *   - while the agent is still working (`agentFinished` unset), a PR with no
 *     files or only notes so far is attached but NOT judged: the attempt
 *     stays open, agent-status-poll keeps polling it, and the verdict is made
 *     on the files the finished agent left;
 *   - when the files cannot be read while the agent is still working, the PR
 *     is attached and the verdict waits the same way (a transient GitHub
 *     error never passes a PR that nobody will re-read);
 *   - when the files still cannot be read once the agent has finished (no
 *     token, GitHub down), the PR is trusted and the timeline says it went
 *     unchecked.
 */
export async function applyCloudAgentOutcome(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  rawOutcome: CloudAgentOutcome,
  deps: CloudAgentOutcomeDeps = {},
): Promise<CloudAgentOutcomeResult> {
  const now = new Date().toISOString()
  // "Finished, no PR" on an attempt that already holds the PR the agent
  // opened while working: that PR is the result, so it gets judged.
  const preliminary: CloudAgentOutcome =
    rawOutcome.kind === 'completed_no_pr' && target.pendingPrUrl
      ? { kind: 'pr_opened', prUrl: target.pendingPrUrl, summary: rawOutcome.summary ?? null, agentFinished: true }
      : rawOutcome
  // ADR 0030: store one spelling per PR (claimAttemptForPr, attachPendingPr
  // and the review queue all key on it). A vendor URL that is not a GitHub
  // PR is not attached at all.
  const canonicalUrl = preliminary.kind === 'pr_opened' ? canonicalPrUrl(preliminary.prUrl) : null
  if (preliminary.kind === 'pr_opened' && !canonicalUrl) {
    alog.warn('Cloud agent reported a PR URL that is not a GitHub pull request; not attached', {
      attemptId: target.attemptId,
      prUrl: String(preliminary.prUrl).slice(0, 200),
    })
    return { applied: false, reason: 'invalid_pr_url' }
  }
  const outcome: CloudAgentOutcome =
    preliminary.kind === 'pr_opened' ? { ...preliminary, prUrl: canonicalUrl! } : preliminary

  if (outcome.kind === 'pr_opened') {
    const finished = outcome.agentFinished === true
    const inspection = await (deps.inspectPr ?? inspectCloudAgentPr)(db, target.projectId, outcome.prUrl).catch(
      (err): CloudPrInspection => ({ kind: 'unread', reason: String(err).slice(0, 200) }),
    )
    if (inspection.kind === 'read') {
      const verdict = classifyPrSubstance(inspection.files, { complete: inspection.complete })
      const empty = inspection.files.length === 0
      if (!finished && (empty || verdict.speculative)) {
        return await attachPendingPr(
          db,
          target,
          outcome,
          empty ? 'the pull request has no files yet' : 'the pull request only has notes so far',
        )
      }
      if (empty) {
        return await applyNeedsInvestigationPr(
          db,
          target,
          outcome,
          { reason: 'the agent finished, but its pull request changes no files', files: [] },
          now,
        )
      }
      if (verdict.speculative) {
        return await applyNeedsInvestigationPr(db, target, outcome, verdict, now)
      }
    } else if (!finished) {
      // A transient read failure (GitHub 5xx / 403 / rate limit / timeout)
      // while the agent still works must not pass the PR as a fix: once the
      // attempt is claimed, nothing re-reads it. Attach it and let the
      // finished agent's outcome (agent-status-poll / cursor-webhook) judge.
      alog.warn('Cloud agent PR contents not readable yet — waiting for the agent to finish', {
        attemptId: target.attemptId,
        prUrl: outcome.prUrl,
        reason: inspection.reason,
      })
      return await attachPendingPr(db, target, outcome, `the pull request's files could not be read yet (${inspection.reason})`)
    } else {
      alog.warn('Cloud agent PR contents not checked', {
        attemptId: target.attemptId,
        prUrl: outcome.prUrl,
        reason: inspection.reason,
      })
    }
    const contentCheck = inspection.kind === 'unread' ? `not_checked: ${inspection.reason}` : 'code_change'

    const claim = await claimAttemptForPr(db, target.attemptId, outcome.prUrl, {
      status: 'completed',
      pr_url: outcome.prUrl,
      pr_number: prNumberFromUrl(outcome.prUrl),
      pr_state: 'open',
      ...(outcome.branch ? { branch: outcome.branch, branch_name: outcome.branch } : {}),
      ...(outcome.summary ? { summary: outcome.summary.slice(0, 2000) } : {}),
      completed_at: now,
    })
    if (claim.error) {
      if (claim.error.code === '23505') {
        alog.warn('PR already attached to another fix attempt — skipping', {
          attemptId: target.attemptId,
          prUrl: outcome.prUrl,
        })
        return { applied: false, reason: 'pr_url_conflict' }
      }
      alog.error('fix_attempts PR update failed', { attemptId: target.attemptId, error: claim.error.message })
      return { applied: false, reason: 'update_failed' }
    }
    if (!claim.claimed) {
      if (finished) {
        const closed = await closeAttemptWhosePrClosed(db, target, outcome.prUrl, now)
        if (closed) return closed
      }
      return { applied: false, reason: 'already_has_pr' }
    }

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
      payload: { agent: target.agent, prUrl: outcome.prUrl, branch: outcome.branch ?? null, contentCheck },
    })

    // ADR 0030: every cloud agent PR accepted as a fix gets an independent
    // Opus review (agent-pr-review drains the queue). Best-effort: a failed
    // enqueue never fails the PR bookkeeping, and the merge gate treats a
    // missing review as "not reviewed".
    const queued = await enqueueFixReview(db, {
      fixAttemptId: target.attemptId,
      projectId: target.projectId,
      reportId: target.reportId,
      prUrl: outcome.prUrl,
    })
    if (!queued.queued) {
      alog.warn('Agent PR review not queued (non-fatal)', { attemptId: target.attemptId, err: queued.error ?? null })
    }

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
  // A finished agent usually says why it opened nothing ("already fixed on
  // main", "the code is in the backend repo"); keep that verdict instead of
  // filing an API error the console would offer to retry.
  const isFailure = outcome.kind === 'failed'
  // A run that failed on the account's usage limit: mark the key that started
  // it, so new agents go to the next key (cursorKeyForNewWork).
  if (isFailure && target.agent === 'cursor_cloud' && isCursorKeyLimitError(outcome.error)) {
    await markRunKeyExhausted(db, target, outcome.error)
  }
  const noPr = isFailure ? null : classifyNoPrSummary(outcome.summary)
  const errorText = isFailure ? outcome.error.slice(0, 1000) : noPrErrorText(noPr!).slice(0, 1000)
  const failureCategory = isFailure
    ? failureCategoryFor(target.agent, outcome.failureCategory)
    : // A finished run with notes but no verdict is not an API error: the console
      // would offer Retry and the stop-loss would read it as a Cursor fault.
      (noPr?.category ?? 'unknown')
  const { data: closed, error: closeErr } = await db
    .from('fix_attempts')
    .update({
      status: 'failed',
      error: errorText,
      failure_category: failureCategory,
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
      // 'skipped' when the agent explained itself: nothing is waiting on GitHub.
      status: isFailure ? 'failed' : noPr?.category ? 'skipped' : 'completed_no_pr',
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
    label: isFailure
      ? 'Cloud agent failed'
      : noPr?.category === 'already_fixed'
        ? 'Agent found nothing to change'
        : noPr?.category === 'wrong_repo'
          ? 'Agent says the code is in another repo'
          : noPr?.category === 'not_actionable'
            ? 'Agent found nothing it can tie to code'
            : noPr?.category === 'needs_human'
              ? 'Agent says this needs a person'
              : 'Cloud agent finished without a PR',
    detail: errorText.slice(0, 500),
    dedupe_key: `cloud-final:${target.attemptId}`,
    payload: { agent: target.agent, ...(noPr?.category ? { verdict: noPr.category } : {}) },
  })

  if (noPr?.category === 'already_fixed') await resolveAlreadyFixed(db, target, now)

  dispatchPluginEventDetached(db, target.projectId, 'fix.failed', {
    report: { id: target.reportId },
    fix: { id: target.attemptId, agent: target.agent, error: errorText.slice(0, 500) },
  }).catch((e) => alog.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }))

  void notifyTeamFixEvent(db, target.projectId, target.reportId, 'fix_failed', {
    error: errorText.slice(0, 500),
    failureCategory,
  }).catch((e) => alog.warn('Team fix notification failed', { event: 'fix_failed', err: String(e) }))

  return { applied: true }
}

/** Statuses a report can leave for `resolved` when an agent finds the bug already gone. */
const RESOLVABLE_REPORT_STATUSES = ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'fixing', 'in_progress', 'reopened']

/**
 * The agent found the bug already gone (no PR): mark the report `resolved`
 * (not `fixed`: nothing merged) so it stops counting as open, unless another
 * attempt or an open PR is still live for it. On 2026-10-24 nine critical
 * site-watch reports stayed open for days after this verdict. The reporter is
 * not told: no fix shipped. A recurrence files or reopens a report as usual.
 */
async function resolveAlreadyFixed(db: SupabaseClient, target: CloudAgentOutcomeTarget, now: string): Promise<void> {
  try {
    const { count } = await db
      .from('fix_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', target.reportId)
      .neq('id', target.attemptId)
      .is('merged_at', null)
      .or('status.in.(queued,running),pr_state.in.(open,draft),and(pr_url.not.is.null,pr_state.is.null)')
    if ((count ?? 0) > 0) return
    const { data: changed } = await db
      .from('reports')
      .update({ status: 'resolved', updated_at: now })
      .eq('id', target.reportId)
      .eq('project_id', target.projectId)
      .in('status', RESOLVABLE_REPORT_STATUSES)
      .select('id')
    if (!changed || (changed as unknown[]).length === 0) return
    await insertFixEvent(db, {
      fix_attempt_id: target.attemptId,
      project_id: target.projectId,
      kind: 'completed',
      status: 'ok',
      label: 'Resolved: the agent found it already fixed',
      detail: 'No pull request was needed. The report reopens if the bug comes back.',
      dedupe_key: `already-fixed-resolved:${target.attemptId}`,
      payload: { agent: target.agent, verdict: 'already_fixed' },
    })
  } catch (err) {
    alog.warn('already-fixed report not resolved', { reportId: target.reportId, err: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * A cloud agent opened a PR that only adds notes. Record the PR on the attempt
 * (so the race guard and the unique index still hold, and a human can find
 * and close it), close the attempt as needs-investigation, and leave the
 * report's status alone: nothing was fixed.
 */
async function applyNeedsInvestigationPr(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  outcome: Extract<CloudAgentOutcome, { kind: 'pr_opened' }>,
  verdict: { reason: string; files: string[] },
  now: string,
): Promise<CloudAgentOutcomeResult> {
  const errorText =
    `needs_investigation: ${verdict.reason}. The agent did not find a fix; read its notes, then close the PR: ${outcome.prUrl}`
      .slice(0, 1000)
  const claim = await claimAttemptForPr(db, target.attemptId, outcome.prUrl, {
    status: 'failed',
    pr_url: outcome.prUrl,
    pr_number: prNumberFromUrl(outcome.prUrl),
    pr_state: 'open',
    ...(outcome.branch ? { branch: outcome.branch, branch_name: outcome.branch } : {}),
    ...(outcome.summary ? { summary: outcome.summary.slice(0, 2000) } : {}),
    files_changed: verdict.files.slice(0, 50),
    review_passed: false,
    review_reasoning: verdict.reason.slice(0, 1000),
    error: errorText,
    failure_category: 'validation_rejected',
    completed_at: now,
  })
  if (claim.error) {
    if (claim.error.code === '23505') {
      alog.warn('PR already attached to another fix attempt — skipping', { attemptId: target.attemptId, prUrl: outcome.prUrl })
      return { applied: false, reason: 'pr_url_conflict' }
    }
    alog.error('fix_attempts needs-investigation update failed', { attemptId: target.attemptId, error: claim.error.message })
    return { applied: false, reason: 'update_failed' }
  }
  if (!claim.claimed) {
    if (outcome.agentFinished === true) {
      const closed = await closeAttemptWhosePrClosed(db, target, outcome.prUrl, now)
      if (closed) return closed
    }
    return { applied: false, reason: 'already_has_pr' }
  }

  await db
    .from('fix_dispatch_jobs')
    .update({ status: 'completed_no_pr', pr_url: outcome.prUrl, error: errorText.slice(0, 500), finished_at: now })
    .eq('fix_attempt_id', target.attemptId)
    .in('status', ['queued', 'running'])

  // processing_error only: the report keeps its status (not `fixing`).
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
    label: 'Cloud agent PR needs investigation (notes only, no fix)',
    detail: `${verdict.reason} — ${outcome.prUrl}`.slice(0, 500),
    dedupe_key: `cloud-final:${target.attemptId}`,
    payload: { agent: target.agent, prUrl: outcome.prUrl, files: verdict.files.slice(0, 20), needsInvestigation: true },
  })

  dispatchPluginEventDetached(db, target.projectId, 'fix.failed', {
    report: { id: target.reportId },
    fix: { id: target.attemptId, agent: target.agent, error: errorText.slice(0, 500), prUrl: outcome.prUrl },
  }).catch((e) => alog.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }))

  void notifyTeamFixEvent(db, target.projectId, target.reportId, 'fix_failed', {
    error: errorText.slice(0, 500),
    failureCategory: 'validation_rejected',
  }).catch((e) => alog.warn('Team fix notification failed', { event: 'fix_failed', err: String(e) }))

  return { applied: true, needsInvestigation: true }
}

type DbError = { code?: string; message: string }

/**
 * Write a PR verdict onto the attempt exactly once. First writer wins on
 * `pr_url IS NULL` (as always); an attempt whose PR was attached while the
 * agent was still working is claimed instead on "same PR, still open, PR not
 * closed". The second write leaves `pr_state` alone: the indexer keeps it
 * current (a Copilot PR is a draft until someone readies it).
 */
async function claimAttemptForPr(
  db: SupabaseClient,
  attemptId: string,
  prUrl: string,
  patch: Record<string, unknown>,
): Promise<{ claimed: boolean; error: DbError | null }> {
  const first = await db.from('fix_attempts').update(patch).eq('id', attemptId).is('pr_url', null).select('id')
  if (first.error) return { claimed: false, error: first.error }
  if (first.data && first.data.length > 0) return { claimed: true, error: null }

  const pendingPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'pr_state'))
  const second = await db
    .from('fix_attempts')
    .update(pendingPatch)
    .eq('id', attemptId)
    .eq('pr_url', prUrl)
    .in('status', OPEN_ATTEMPT_STATUSES)
    .in('pr_state', ['open', 'draft'])
    .select('id')
  if (second.error) return { claimed: false, error: second.error }
  return { claimed: !!second.data && second.data.length > 0, error: null }
}

/**
 * The agent is still working and its PR has no code change yet. Attach the PR
 * (so the unique index and the indexer's pr_url lookups hold) but keep the
 * attempt open and the report where it is; the finished agent's files decide.
 * No team notification and no `fix.proposed`: nothing is proposed yet.
 */
async function attachPendingPr(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  outcome: Extract<CloudAgentOutcome, { kind: 'pr_opened' }>,
  waitingFor: string,
): Promise<CloudAgentOutcomeResult> {
  const { data: attached, error } = await db
    .from('fix_attempts')
    .update({
      pr_url: outcome.prUrl,
      pr_number: prNumberFromUrl(outcome.prUrl),
      pr_state: 'open',
      ...(outcome.branch ? { branch: outcome.branch, branch_name: outcome.branch } : {}),
    })
    .eq('id', target.attemptId)
    .is('pr_url', null)
    .in('status', OPEN_ATTEMPT_STATUSES)
    .select('id')
  if (error) {
    if (error.code === '23505') {
      alog.warn('PR already attached to another fix attempt — skipping', { attemptId: target.attemptId, prUrl: outcome.prUrl })
      return { applied: false, reason: 'pr_url_conflict' }
    }
    alog.error('fix_attempts pending PR attach failed', { attemptId: target.attemptId, error: error.message })
    return { applied: false, reason: 'update_failed' }
  }
  if (!attached || attached.length === 0) return { applied: false, reason: 'already_has_pr' }

  await insertFixEvent(db, {
    fix_attempt_id: target.attemptId,
    project_id: target.projectId,
    kind: 'pr_opened',
    status: 'pending',
    label: 'Draft PR opened; waiting for the agent to finish',
    detail: `${waitingFor} — ${outcome.prUrl}`.slice(0, 500),
    dedupe_key: `cloud-pr-pending:${target.attemptId}`,
    payload: {
      agent: target.agent,
      prUrl: outcome.prUrl,
      branch: outcome.branch ?? null,
      contentCheck: `pending: ${waitingFor}`,
    },
  })
  return { applied: true, awaitingChanges: true }
}

/**
 * The agent finished, but the PR it opened while working was closed before
 * that: nothing to judge. Close the attempt so it stops blocking re-dispatch
 * (the report never moved to fixing).
 */
async function closeAttemptWhosePrClosed(
  db: SupabaseClient,
  target: CloudAgentOutcomeTarget,
  prUrl: string,
  now: string,
): Promise<CloudAgentOutcomeResult | null> {
  const errorText = `The cloud agent's pull request was closed before the agent finished: ${prUrl}`.slice(0, 1000)
  const { data: closed, error } = await db
    .from('fix_attempts')
    .update({
      status: 'failed',
      error: errorText,
      failure_category: failureCategoryFor(target.agent, null),
      completed_at: now,
    })
    .eq('id', target.attemptId)
    .eq('pr_url', prUrl)
    .eq('pr_state', 'closed')
    .in('status', OPEN_ATTEMPT_STATUSES)
    .select('id')
  if (error) {
    alog.error('fix_attempts close (PR closed) failed', { attemptId: target.attemptId, error: error.message })
    return { applied: false, reason: 'update_failed' }
  }
  if (!closed || closed.length === 0) return null

  await db
    .from('fix_dispatch_jobs')
    .update({ status: 'completed_no_pr', pr_url: prUrl, error: errorText.slice(0, 500), finished_at: now })
    .eq('fix_attempt_id', target.attemptId)
    .in('status', ['queued', 'running'])

  await insertFixEvent(db, {
    fix_attempt_id: target.attemptId,
    project_id: target.projectId,
    kind: 'failed',
    status: 'fail',
    label: 'Cloud agent finished after its PR was closed',
    detail: errorText.slice(0, 500),
    dedupe_key: `cloud-final:${target.attemptId}`,
    payload: { agent: target.agent, prUrl },
  })
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
      // Cancel with the key that started the run (a used-up key may no longer be first).
      const { data: att } = await db.from('fix_attempts').select('external_agent_ref').eq('id', input.attemptId).maybeSingle()
      const apiKey = await cursorKeyForRun(db, input.projectId, (att as { external_agent_ref?: unknown } | null)?.external_agent_ref)
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

/** Outcome of stopping one Cursor Cloud agent's current run. */
export type CursorStopOutcome = 'stopped' | 'already_finished' | 'no_key' | 'failed'

/**
 * Stop the latest run of a Cursor Cloud agent known only by its agent id
 * (skill pipeline steps store `agent_ref`, not the run id). Cursor v1 has a
 * run cancel; GET /v1/agents/{id} names the run. A 409 means the run already
 * ended, which is not a failure. GitHub Agent Tasks has no cancel endpoint,
 * so only Cursor agents can be stopped from Mushi.
 */
export async function stopCursorAgentLatestRun(
  db: SupabaseClient,
  projectId: string,
  agentId: string,
): Promise<CursorStopOutcome> {
  const apiKey = await resolveCursorApiKey(db, projectId)
  if (!apiKey) return 'no_key'
  try {
    const agent = await getCursorAgent({ apiKey }, agentId)
    if (!agent.latestRunId) return 'already_finished'
    await cancelCursorRun({ apiKey }, agentId, agent.latestRunId)
    return 'stopped'
  } catch (err) {
    if (err instanceof CursorApiError && err.status === 409) return 'already_finished'
    alog.warn('Cursor agent stop failed', { agentId, err: String(err).slice(0, 200) })
    return 'failed'
  }
}

/** Poll → outcome mapping shared by the cron poller (kept pure for tests). */
export function pollResultToOutcome(poll: CloudPollResult): CloudAgentOutcome | null {
  switch (poll.status) {
    case 'working':
      return null
    case 'completed':
      return poll.prUrl
        ? { kind: 'pr_opened', prUrl: poll.prUrl, branch: poll.branch ?? null, summary: poll.summary ?? null, agentFinished: true }
        : { kind: 'completed_no_pr', summary: poll.summary ?? null }
    case 'cancelled':
      return { kind: 'failed', error: poll.error ?? 'Cloud agent run was cancelled' }
    case 'failed':
      return { kind: 'failed', error: poll.error ?? 'Cloud agent run failed' }
  }
}
