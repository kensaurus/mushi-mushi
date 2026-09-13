/**
 * FILE: packages/server/supabase/functions/_shared/mcp-tasks.ts
 * PURPOSE: The `io.modelcontextprotocol/tasks` extension (SEP-2663, MCP
 *          2026-07-28) for the hosted MCP endpoint, plus the voice
 *          confirmation gate that is its first concrete use.
 *
 * Task store
 * ──────────
 * A fix run is a long-lived job and `fix_dispatch_jobs` is already its
 * durable record, so a task IS a dispatch job: `taskId = fix_dispatch_jobs.id`
 * and the job's `status` column maps onto the task status
 * (`queued|running → working`, `completed|completed_no_pr → completed`,
 * `failed|skipped* → failed`, `cancelled → cancelled`). No new table.
 *
 * The one exception is the voice confirmation gate: a voice request that is
 * still `awaiting_confirm` has no job row yet (the status CHECK on
 * `fix_dispatch_jobs` has no "awaiting input" value), so while the task is
 * `input_required` its id is the `voice_intake_sessions.id`. Both are UUIDs
 * from different tables; `tasks/get` resolves either. Once confirmed the
 * task keeps the session id and reads the job it produced.
 *
 * Extension surface (only these three methods exist; no tasks/list, no
 * tasks/result):
 *   tasks/get    {taskId}                  → { resultType:"complete", task }
 *   tasks/update {taskId, inputResponses}  → { resultType:"complete", task }
 *   tasks/cancel {taskId}                  → { resultType:"complete", task }
 *
 * A task is only ever returned to a client that declared the extension in
 * `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`; the
 * caller (`mcp/index.ts`) enforces that and answers -32021 otherwise.
 *
 * Voice gate
 * ──────────
 * When `dispatch_fix` targets a report whose `voice_intake_sessions` row is
 * `awaiting_confirm`, the tool does not dispatch. A task-capable client gets
 * a task in `input_required`; any other 2026-07-28 client gets the MRTR
 * `input_required` result with a signed `requestState` (see mcp-mrtr.ts).
 * Accepting flips the session to `confirmed` (compare-and-swap, so a
 * replayed accept cannot re-arm it) and the normal dispatch runs; declining
 * flips it to `cancelled`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  buildInputRequired,
  describeRequestStateFailure,
  elicitationRequest,
  readInputResponses,
  type ElicitResult,
  type ElicitationRequest,
  type InputRequiredResult,
  type RequestStateCodec,
} from './mcp-mrtr.ts'

export const TASK_POLL_INTERVAL_MS = 5_000
export const TASKS_METHODS: ReadonlySet<string> = new Set(['tasks/get', 'tasks/update', 'tasks/cancel'])
export const VOICE_CONFIRM_KEY = 'confirm'

const ERR_INVALID_PARAMS = -32602

export class McpTaskError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpTaskError'
  }
}

// ── Row shapes (read with the service client) ────────────────────────────────

export interface FixDispatchJobRow {
  id: string
  project_id: string
  report_id: string
  status: string
  pr_url: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  fix_attempt_id: string | null
}

export interface VoiceIntakeSessionRow {
  id: string
  project_id: string
  report_id: string | null
  source: string | null
  status: string
  transcript: string | null
  transcript_sha256: string | null
  action: string | null
  summary: string | null
  expires_at: string | null
  confirmed_at: string | null
  confirmed_by: string | null
  created_at?: string | null
  updated_at?: string | null
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'

export interface CallToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface McpTask {
  taskId: string
  status: McpTaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs: number
  result?: CallToolResult
  error?: { code: number; message: string; data?: unknown }
  inputRequests?: Record<string, ElicitationRequest>
}

export interface CreateTaskResult extends Record<string, unknown> {
  resultType: 'task'
  taskId: string
  status: 'working' | 'input_required'
  createdAt: string
  lastUpdatedAt: string
  ttlMs: null
  pollIntervalMs: number
  inputRequests?: Record<string, ElicitationRequest>
}

export interface TaskEnvelope extends Record<string, unknown> {
  resultType: 'complete'
  task: McpTask
}

// ── Status mapping ───────────────────────────────────────────────────────────

/** `fix_dispatch_jobs.status` (see the CHECK constraint) → task status. */
export function mapJobStatus(status: string): McpTaskStatus {
  switch (status) {
    case 'queued':
    case 'running':
      return 'working'
    case 'completed':
    case 'completed_no_pr':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    // failed, skipped, skipped_no_sandbox and anything unexpected.
    default:
      return 'failed'
  }
}

/** The CallToolResult the synchronous `dispatch_fix` path returns for this job. */
export function jobToCallToolResult(job: FixDispatchJobRow): CallToolResult {
  const data: Record<string, unknown> = {
    fixId: job.id,
    status: job.status,
    ...(job.pr_url ? { prUrl: job.pr_url } : {}),
    ...(job.fix_attempt_id ? { fixAttemptId: job.fix_attempt_id } : {}),
  }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }
}

function lastUpdated(job: FixDispatchJobRow): string {
  return job.finished_at ?? job.started_at ?? job.created_at
}

export function jobToTask(job: FixDispatchJobRow, taskId: string = job.id): McpTask {
  const status = mapJobStatus(job.status)
  const task: McpTask = {
    taskId,
    status,
    createdAt: job.created_at,
    lastUpdatedAt: lastUpdated(job),
    ttlMs: null,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  }
  if (job.status !== status) task.statusMessage = `dispatch ${job.status}`
  if (status === 'completed') task.result = jobToCallToolResult(job)
  if (status === 'failed') {
    task.error = {
      code: -32000,
      message: job.error ?? `dispatch ${job.status}`,
      data: { dispatchStatus: job.status, fixId: job.id },
    }
  }
  if (status === 'cancelled' && job.error) task.statusMessage = job.error
  return task
}

export function createTaskResultForJob(job: FixDispatchJobRow): CreateTaskResult {
  return {
    resultType: 'task',
    taskId: job.id,
    status: 'working',
    createdAt: job.created_at,
    lastUpdatedAt: lastUpdated(job),
    ttlMs: null,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  }
}

// ── Voice confirmation gate ──────────────────────────────────────────────────

export function buildVoiceConfirmMessage(transcript: string, reportId: string): string {
  return `Voice request (verbatim): ${transcript}\n\nAction: open a draft PR for report ${reportId}. Confirm?`
}

export const VOICE_CONFIRM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { confirm: { type: 'boolean' } },
  required: ['confirm'],
}

export function buildVoiceConfirmInputRequests(
  session: VoiceIntakeSessionRow,
  reportId: string,
): Record<string, ElicitationRequest> {
  return {
    [VOICE_CONFIRM_KEY]: elicitationRequest(buildVoiceConfirmMessage(session.transcript ?? '', reportId), VOICE_CONFIRM_SCHEMA),
  }
}

export type VoiceDecision = 'accept' | 'reject' | 'missing'

/** accept + content.confirm === true ⇒ accept; decline/cancel/confirm:false ⇒ reject; no answer ⇒ missing. */
export function readVoiceDecision(responses: Record<string, ElicitResult>): VoiceDecision {
  const r = responses[VOICE_CONFIRM_KEY]
  if (!r) return 'missing'
  if (r.action === 'accept' && r.content?.confirm === true) return 'accept'
  return 'reject'
}

export function isVoiceSessionExpired(session: VoiceIntakeSessionRow, now: number = Date.now()): boolean {
  if (!session.expires_at) return false
  const t = Date.parse(session.expires_at)
  return Number.isFinite(t) && t <= now
}

export function createTaskResultForVoiceSession(session: VoiceIntakeSessionRow, reportId: string): CreateTaskResult {
  const created = session.created_at ?? new Date().toISOString()
  return {
    resultType: 'task',
    taskId: session.id,
    status: 'input_required',
    createdAt: created,
    lastUpdatedAt: session.updated_at ?? created,
    ttlMs: null,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
    inputRequests: buildVoiceConfirmInputRequests(session, reportId),
  }
}

/** A voice session (and, once confirmed, the job it produced) as a task. */
export function voiceSessionToTask(
  session: VoiceIntakeSessionRow,
  latestJob: FixDispatchJobRow | null,
  now: number = Date.now(),
): McpTask {
  const created = session.created_at ?? new Date(now).toISOString()
  const base: McpTask = {
    taskId: session.id,
    status: 'working',
    createdAt: created,
    lastUpdatedAt: session.confirmed_at ?? session.updated_at ?? created,
    ttlMs: null,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  }
  switch (session.status) {
    case 'awaiting_confirm':
      if (isVoiceSessionExpired(session, now)) {
        return { ...base, status: 'failed', error: { code: -32000, message: 'voice confirmation window expired' } }
      }
      return {
        ...base,
        status: 'input_required',
        statusMessage: 'awaiting confirmation of the voice request',
        inputRequests: buildVoiceConfirmInputRequests(session, session.report_id ?? ''),
      }
    case 'confirmed':
    case 'dispatched':
    case 'notified':
      if (latestJob) return jobToTask(latestJob, session.id)
      return { ...base, status: 'working', statusMessage: 'confirmed; dispatch pending' }
    case 'cancelled':
    case 'refused':
      return { ...base, status: 'cancelled', statusMessage: `voice request ${session.status}` }
    case 'failed':
    case 'expired':
      return { ...base, status: 'failed', error: { code: -32000, message: `voice request ${session.status}` } }
    default:
      // received / transcribed: not yet at the gate.
      return { ...base, status: 'working', statusMessage: `voice request ${session.status}` }
  }
}

export function declinedVoiceResult(session: VoiceIntakeSessionRow): CallToolResult {
  const payload = {
    error: 'Voice request was not confirmed; dispatch cancelled.',
    code: 'VOICE_CONFIRM_DECLINED',
    voiceSessionId: session.id,
  }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true }
}

/** What legacy (pre-2026-07-28) clients see: they have no MRTR / tasks to answer with. */
export function legacyVoiceGateResult(session: VoiceIntakeSessionRow, reportId: string): CallToolResult {
  const payload = {
    error:
      'This report came in by voice and is awaiting confirmation before a draft PR can be opened. ' +
      'Confirm it from the voice channel, or call dispatch_fix from an MCP 2026-07-28 client which will be asked to confirm.',
    code: 'VOICE_CONFIRM_REQUIRED',
    voiceSessionId: session.id,
    reportId,
    transcript: session.transcript ?? '',
  }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true }
}

/** What the signed `requestState` pins the retry to (attacker-controlled on the way back). */
export interface VoiceGatePayload {
  kind: 'voice_confirm'
  sessionId: string
  projectId: string
  reportId: string
  transcriptSha256: string | null
  action: string | null
}

export function voiceGatePayload(session: VoiceIntakeSessionRow, projectId: string, reportId: string): VoiceGatePayload {
  return {
    kind: 'voice_confirm',
    sessionId: session.id,
    projectId,
    reportId,
    transcriptSha256: session.transcript_sha256,
    action: session.action,
  }
}

function payloadMatches(p: unknown, expected: VoiceGatePayload): boolean {
  if (!p || typeof p !== 'object') return false
  const v = p as Partial<VoiceGatePayload>
  return (
    v.kind === expected.kind &&
    v.sessionId === expected.sessionId &&
    v.projectId === expected.projectId &&
    v.reportId === expected.reportId &&
    (v.transcriptSha256 ?? null) === (expected.transcriptSha256 ?? null) &&
    (v.action ?? null) === (expected.action ?? null)
  )
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface McpTaskStore {
  /** Job by id, or null when it does not exist or the caller may not see it. */
  getJob(id: string): Promise<FixDispatchJobRow | null>
  /** Cooperative cancel (CAS on queued|running). Null when the job was already terminal. */
  cancelJob(id: string, reason: string): Promise<FixDispatchJobRow | null>
  getVoiceSession(id: string): Promise<VoiceIntakeSessionRow | null>
  /** The `awaiting_confirm` session for a report, if any (table may not exist yet ⇒ null). */
  findAwaitingVoiceSession(projectId: string, reportId: string): Promise<VoiceIntakeSessionRow | null>
  /** CAS `awaiting_confirm → to`. False when the row already moved (single use). */
  transitionVoiceSession(id: string, to: 'confirmed' | 'cancelled', confirmedBy: string): Promise<boolean>
  latestJobForReport(projectId: string, reportId: string): Promise<FixDispatchJobRow | null>
}

export interface SupabaseTaskStoreOptions {
  db: SupabaseClient
  /** Project the API key is bound to; tasks outside it are invisible. */
  projectIdHint?: string
  /** JWT caller — visibility is checked against project membership. */
  ownerUserId?: string
}

const JOB_COLUMNS = 'id, project_id, report_id, status, pr_url, error, created_at, started_at, finished_at, fix_attempt_id'

export function createSupabaseTaskStore(opts: SupabaseTaskStoreOptions): McpTaskStore {
  const { db, projectIdHint, ownerUserId } = opts

  async function callerCanSeeProject(projectId: string): Promise<boolean> {
    if (projectIdHint) return projectId === projectIdHint
    if (!ownerUserId) return false
    // Same three-way membership walk as _shared/dispatch.ts (owner → org
    // member → project member). Inlined so _shared stays free of api/shared.ts.
    const { data: project } = await db
      .from('projects')
      .select('owner_id, organization_id')
      .eq('id', projectId)
      .maybeSingle()
    const proj = project as { owner_id?: string; organization_id?: string | null } | null
    if (proj?.owner_id === ownerUserId) return true
    if (proj?.organization_id) {
      const { data: orgMember } = await db
        .from('organization_members')
        .select('role')
        .eq('organization_id', proj.organization_id)
        .eq('user_id', ownerUserId)
        .maybeSingle()
      if (orgMember) return true
    }
    const { data: projMember } = await db
      .from('project_members')
      .select('role')
      .eq('user_id', ownerUserId)
      .eq('project_id', projectId)
      .maybeSingle()
    return !!projMember
  }

  async function readJob(id: string): Promise<FixDispatchJobRow | null> {
    const { data, error } = await db.from('fix_dispatch_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle()
    if (error || !data) return null
    return data as unknown as FixDispatchJobRow
  }

  return {
    async getJob(id) {
      const job = await readJob(id)
      if (!job) return null
      return (await callerCanSeeProject(job.project_id)) ? job : null
    },

    async cancelJob(id, reason) {
      const job = await readJob(id)
      if (!job || !(await callerCanSeeProject(job.project_id))) return null
      if (job.status !== 'queued' && job.status !== 'running') return null
      // CAS — the worker does the inverse transition; whoever lands first wins
      // (identical to /v1/admin/fixes/dispatches/:id/cancel and the A2A cancel).
      const { data, error } = await db
        .from('fix_dispatch_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString(), error: reason })
        .eq('id', id)
        .in('status', ['queued', 'running'])
        .select(JOB_COLUMNS)
        .maybeSingle()
      if (error || !data) return null
      return data as unknown as FixDispatchJobRow
    },

    async getVoiceSession(id) {
      try {
        const { data, error } = await db.from('voice_intake_sessions').select('*').eq('id', id).maybeSingle()
        if (error || !data) return null
        const row = data as unknown as VoiceIntakeSessionRow
        return (await callerCanSeeProject(row.project_id)) ? row : null
      } catch {
        return null
      }
    },

    async findAwaitingVoiceSession(projectId, reportId) {
      // A JWT caller may name any projectId in the tool arguments; never
      // surface a transcript for a project they are not a member of.
      if (!(await callerCanSeeProject(projectId))) return null
      // The table is created by the voice workstream; until it exists (or if
      // the query fails for any reason) there is no gate.
      try {
        const { data, error } = await db
          .from('voice_intake_sessions')
          .select('*')
          .eq('project_id', projectId)
          .eq('report_id', reportId)
          .eq('status', 'awaiting_confirm')
          .limit(1)
        if (error || !data || !data.length) return null
        const row = data[0] as unknown as VoiceIntakeSessionRow
        return isVoiceSessionExpired(row) ? null : row
      } catch {
        return null
      }
    },

    async transitionVoiceSession(id, to, confirmedBy) {
      try {
        const patch: Record<string, unknown> =
          to === 'confirmed'
            ? { status: 'confirmed', confirmed_by: confirmedBy, confirmed_at: new Date().toISOString() }
            : { status: 'cancelled' }
        const { data, error } = await db
          .from('voice_intake_sessions')
          .update(patch)
          .eq('id', id)
          .eq('status', 'awaiting_confirm')
          .select('id')
        if (error) return false
        return Array.isArray(data) && data.length > 0
      } catch {
        return false
      }
    },

    async latestJobForReport(projectId, reportId) {
      const { data, error } = await db
        .from('fix_dispatch_jobs')
        .select(JOB_COLUMNS)
        .eq('project_id', projectId)
        .eq('report_id', reportId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error || !data || !data.length) return null
      return data[0] as unknown as FixDispatchJobRow
    },
  }
}

// ── Gate evaluation for tools/call dispatch_fix ──────────────────────────────

export interface VoiceGateInput {
  session: VoiceIntakeSessionRow
  projectId: string
  reportId: string
  /** `tools/call` params — `inputResponses` / `requestState` are read from here. */
  params: Record<string, unknown>
  codec: RequestStateCodec<VoiceGatePayload>
  store: McpTaskStore
  /** Client declared the tasks extension ⇒ answer with a task instead of MRTR. */
  taskClient: boolean
  now?: number
}

export type VoiceGateOutcome =
  | { kind: 'respond'; result: InputRequiredResult | CreateTaskResult }
  | { kind: 'proceed' }
  | { kind: 'declined'; result: CallToolResult }
  | { kind: 'error'; code: number; message: string; data?: unknown }

/**
 * Decide what `dispatch_fix` does when the report is awaiting voice
 * confirmation. Pure apart from the injected store/codec so the retry
 * matrix (valid / invalid / expired / replayed requestState) is unit-testable.
 */
export async function evaluateVoiceGate(input: VoiceGateInput): Promise<VoiceGateOutcome> {
  const { session, projectId, reportId, params, codec, store, taskClient } = input
  const now = input.now ?? Date.now()
  const expected = voiceGatePayload(session, projectId, reportId)
  const requestState = params.requestState

  if (requestState !== undefined) {
    // Second leg of an MRTR exchange.
    const verified = await codec.verify(requestState, now)
    if (!verified.ok) {
      return { kind: 'error', code: ERR_INVALID_PARAMS, message: describeRequestStateFailure(verified.reason) }
    }
    if (!payloadMatches(verified.payload, expected)) {
      return {
        kind: 'error',
        code: ERR_INVALID_PARAMS,
        message: 'requestState does not belong to this voice request; call the tool again without it',
      }
    }
    const decision = readVoiceDecision(readInputResponses(params))
    if (decision === 'accept') {
      const moved = await store.transitionVoiceSession(session.id, 'confirmed', 'mcp')
      if (!moved) {
        return {
          kind: 'error',
          code: ERR_INVALID_PARAMS,
          message: 'voice request is no longer awaiting confirmation (already confirmed or cancelled)',
        }
      }
      return { kind: 'proceed' }
    }
    if (decision === 'reject') {
      await store.transitionVoiceSession(session.id, 'cancelled', 'mcp')
      return { kind: 'declined', result: declinedVoiceResult(session) }
    }
    // Partial response: ask again with a fresh envelope (the old nonce is spent).
  }

  if (taskClient) {
    return { kind: 'respond', result: createTaskResultForVoiceSession(session, reportId) }
  }
  const state = await codec.sign(expected, now)
  return { kind: 'respond', result: buildInputRequired(buildVoiceConfirmInputRequests(session, reportId), state) }
}

// ── tasks/* handlers ─────────────────────────────────────────────────────────

export interface TaskHandlerDeps {
  store: McpTaskStore
  /**
   * Run the ordinary `dispatch_fix` for a confirmed voice session through
   * the same REST path the synchronous tool uses (so scope / RLS checks
   * fire). Returns the CallToolResult that path produced.
   */
  dispatch: (session: VoiceIntakeSessionRow) => Promise<CallToolResult>
  now?: number
}

function requireTaskId(params: Record<string, unknown>): string {
  const id = params.taskId
  if (typeof id !== 'string' || !id.trim()) throw new McpTaskError(ERR_INVALID_PARAMS, 'taskId is required')
  return id.trim()
}

async function resolveTask(deps: TaskHandlerDeps, taskId: string): Promise<
  | { kind: 'job'; job: FixDispatchJobRow }
  | { kind: 'voice'; session: VoiceIntakeSessionRow; latestJob: FixDispatchJobRow | null }
> {
  const job = await deps.store.getJob(taskId)
  if (job) return { kind: 'job', job }
  const session = await deps.store.getVoiceSession(taskId)
  if (session) {
    const latestJob =
      session.report_id && session.status !== 'awaiting_confirm'
        ? await deps.store.latestJobForReport(session.project_id, session.report_id)
        : null
    return { kind: 'voice', session, latestJob }
  }
  throw new McpTaskError(ERR_INVALID_PARAMS, `unknown taskId: ${taskId}`)
}

function envelope(task: McpTask): TaskEnvelope {
  return { resultType: 'complete', task }
}

export async function handleTasksGet(deps: TaskHandlerDeps, params: Record<string, unknown>): Promise<TaskEnvelope> {
  const taskId = requireTaskId(params)
  const resolved = await resolveTask(deps, taskId)
  if (resolved.kind === 'job') return envelope(jobToTask(resolved.job))
  return envelope(voiceSessionToTask(resolved.session, resolved.latestJob, deps.now))
}

export async function handleTasksCancel(deps: TaskHandlerDeps, params: Record<string, unknown>): Promise<TaskEnvelope> {
  const taskId = requireTaskId(params)
  const resolved = await resolveTask(deps, taskId)
  if (resolved.kind === 'job') {
    const cancelled = await deps.store.cancelJob(taskId, 'Cancelled via MCP tasks/cancel')
    if (cancelled) return envelope(jobToTask(cancelled))
    // Already terminal (or the worker won the race): report the current state.
    const current = (await deps.store.getJob(taskId)) ?? resolved.job
    return envelope(jobToTask(current))
  }
  const { session } = resolved
  if (session.status === 'awaiting_confirm') {
    await deps.store.transitionVoiceSession(session.id, 'cancelled', 'mcp')
    const after = (await deps.store.getVoiceSession(session.id)) ?? { ...session, status: 'cancelled' }
    return envelope(voiceSessionToTask(after, null, deps.now))
  }
  if (resolved.latestJob && (resolved.latestJob.status === 'queued' || resolved.latestJob.status === 'running')) {
    const cancelled = await deps.store.cancelJob(resolved.latestJob.id, 'Cancelled via MCP tasks/cancel')
    return envelope(jobToTask(cancelled ?? resolved.latestJob, session.id))
  }
  return envelope(voiceSessionToTask(session, resolved.latestJob, deps.now))
}

export async function handleTasksUpdate(deps: TaskHandlerDeps, params: Record<string, unknown>): Promise<TaskEnvelope> {
  const taskId = requireTaskId(params)
  const resolved = await resolveTask(deps, taskId)
  if (resolved.kind === 'job') {
    throw new McpTaskError(ERR_INVALID_PARAMS, `task ${taskId} is not awaiting input`)
  }
  const { session } = resolved
  if (session.status !== 'awaiting_confirm') {
    throw new McpTaskError(ERR_INVALID_PARAMS, `task ${taskId} is not awaiting input (voice request is ${session.status})`)
  }
  if (isVoiceSessionExpired(session, deps.now)) {
    return envelope(voiceSessionToTask(session, null, deps.now))
  }
  const decision = readVoiceDecision(readInputResponses(params))
  if (decision === 'missing') {
    // Keys are unique for the task lifetime; a partial answer leaves it pending.
    return envelope(voiceSessionToTask(session, null, deps.now))
  }
  if (decision === 'reject') {
    await deps.store.transitionVoiceSession(session.id, 'cancelled', 'mcp')
    return envelope(voiceSessionToTask({ ...session, status: 'cancelled' }, null, deps.now))
  }
  const moved = await deps.store.transitionVoiceSession(session.id, 'confirmed', 'mcp')
  if (!moved) {
    throw new McpTaskError(ERR_INVALID_PARAMS, 'voice request is no longer awaiting confirmation (already confirmed or cancelled)')
  }
  const confirmedAt = new Date(deps.now ?? Date.now()).toISOString()
  const confirmed: VoiceIntakeSessionRow = { ...session, status: 'confirmed', confirmed_by: 'mcp', confirmed_at: confirmedAt }
  const result = await deps.dispatch(confirmed)
  if (result.isError) {
    const task = voiceSessionToTask(confirmed, null, deps.now)
    task.status = 'failed'
    task.error = { code: -32000, message: result.content[0]?.text ?? 'dispatch failed' }
    return envelope(task)
  }
  const fixId = typeof result.structuredContent?.fixId === 'string' ? result.structuredContent.fixId : null
  const job = fixId ? await deps.store.getJob(fixId) : null
  return envelope(voiceSessionToTask(confirmed, job, deps.now))
}
