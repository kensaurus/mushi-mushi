/**
 * FILE: packages/server/supabase/functions/mcp/tasks.test.ts
 * PURPOSE: The io.modelcontextprotocol/tasks extension and the voice
 *          confirmation gate (_shared/mcp-tasks.ts) against a mocked task
 *          store: job-status mapping, the declare → task → tasks/get flow,
 *          tasks/cancel, and the MRTR retry matrix (valid / invalid /
 *          expired / replayed requestState). No DB, no env, no network.
 */

import { assert, assertEquals, assertRejects, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { createRequestStateCodec, REQUEST_STATE_TTL_MS, type ElicitResult } from '../_shared/mcp-mrtr.ts'
import {
  McpTaskError,
  TASK_POLL_INTERVAL_MS,
  buildVoiceConfirmMessage,
  createTaskResultForJob,
  evaluateVoiceGate,
  handleTasksCancel,
  handleTasksGet,
  handleTasksUpdate,
  jobToTask,
  legacyVoiceGateResult,
  mapJobStatus,
  readVoiceDecision,
  type CallToolResult,
  type FixDispatchJobRow,
  type McpTaskStore,
  type VoiceGatePayload,
  type VoiceIntakeSessionRow,
} from '../_shared/mcp-tasks.ts'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPORT = '22222222-2222-4222-8222-222222222222'
const JOB_ID = '33333333-3333-4333-8333-333333333333'
const SESSION_ID = '44444444-4444-4444-8444-444444444444'
const NOW = Date.parse('2026-09-12T10:00:00.000Z')

function job(overrides: Partial<FixDispatchJobRow> = {}): FixDispatchJobRow {
  return {
    id: JOB_ID,
    project_id: PROJECT,
    report_id: REPORT,
    status: 'queued',
    pr_url: null,
    error: null,
    created_at: '2026-09-12T09:59:00.000Z',
    started_at: null,
    finished_at: null,
    fix_attempt_id: null,
    ...overrides,
  }
}

function session(overrides: Partial<VoiceIntakeSessionRow> = {}): VoiceIntakeSessionRow {
  return {
    id: SESSION_ID,
    project_id: PROJECT,
    report_id: REPORT,
    source: 'ios_shortcut',
    status: 'awaiting_confirm',
    transcript: 'the checkout button does nothing on mobile',
    transcript_sha256: 'abc123',
    action: 'open_draft_pr',
    summary: null,
    expires_at: new Date(NOW + 5 * 60_000).toISOString(),
    confirmed_at: null,
    confirmed_by: null,
    created_at: '2026-09-12T09:58:00.000Z',
    ...overrides,
  }
}

/** In-memory store standing in for fix_dispatch_jobs + voice_intake_sessions. */
function mockStore(seed: { jobs?: FixDispatchJobRow[]; sessions?: VoiceIntakeSessionRow[] } = {}) {
  const jobs = new Map((seed.jobs ?? []).map((j) => [j.id, { ...j }]))
  const sessions = new Map((seed.sessions ?? []).map((s) => [s.id, { ...s }]))
  const calls: string[] = []
  const store: McpTaskStore = {
    getJob: (id) => {
      calls.push(`getJob:${id}`)
      return Promise.resolve(jobs.get(id) ?? null)
    },
    cancelJob: (id, reason) => {
      calls.push(`cancelJob:${id}`)
      const j = jobs.get(id)
      if (!j || (j.status !== 'queued' && j.status !== 'running')) return Promise.resolve(null)
      Object.assign(j, { status: 'cancelled', error: reason, finished_at: new Date(NOW).toISOString() })
      return Promise.resolve({ ...j })
    },
    getVoiceSession: (id) => {
      calls.push(`getVoiceSession:${id}`)
      return Promise.resolve(sessions.get(id) ?? null)
    },
    findAwaitingVoiceSession: (projectId, reportId) => {
      calls.push(`findAwaiting:${reportId}`)
      const s = [...sessions.values()].find(
        (x) => x.project_id === projectId && x.report_id === reportId && x.status === 'awaiting_confirm',
      )
      return Promise.resolve(s ? { ...s } : null)
    },
    transitionVoiceSession: (id, to, confirmedBy) => {
      calls.push(`transition:${id}:${to}`)
      const s = sessions.get(id)
      if (!s || s.status !== 'awaiting_confirm') return Promise.resolve(false)
      s.status = to
      if (to === 'confirmed') {
        s.confirmed_by = confirmedBy
        s.confirmed_at = new Date(NOW).toISOString()
      }
      return Promise.resolve(true)
    },
    latestJobForReport: (projectId, reportId) => {
      calls.push(`latestJob:${reportId}`)
      const j = [...jobs.values()]
        .filter((x) => x.project_id === projectId && x.report_id === reportId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
      return Promise.resolve(j ? { ...j } : null)
    },
  }
  return { store, jobs, sessions, calls }
}

const codec = () => createRequestStateCodec<VoiceGatePayload>({ secret: 'test-secret' })

const accept: ElicitResult = { action: 'accept', content: { confirm: true } }
const decline: ElicitResult = { action: 'decline' }

// ── Status mapping ───────────────────────────────────────────────────────────

Deno.test('mapJobStatus: every fix_dispatch_jobs status lands on a task status', () => {
  assertEquals(mapJobStatus('queued'), 'working')
  assertEquals(mapJobStatus('running'), 'working')
  assertEquals(mapJobStatus('completed'), 'completed')
  assertEquals(mapJobStatus('completed_no_pr'), 'completed')
  assertEquals(mapJobStatus('failed'), 'failed')
  assertEquals(mapJobStatus('skipped'), 'failed')
  assertEquals(mapJobStatus('skipped_no_sandbox'), 'failed')
  assertEquals(mapJobStatus('cancelled'), 'cancelled')
})

Deno.test('jobToTask: completed carries the CallToolResult the sync path would have returned', () => {
  const t = jobToTask(job({ status: 'completed', pr_url: 'https://github.com/x/y/pull/1', finished_at: '2026-09-12T10:05:00.000Z' }))
  assertEquals(t.taskId, JOB_ID)
  assertEquals(t.status, 'completed')
  assertEquals(t.lastUpdatedAt, '2026-09-12T10:05:00.000Z')
  assertEquals(t.ttlMs, null)
  assertEquals(t.pollIntervalMs, TASK_POLL_INTERVAL_MS)
  assert(t.result)
  assertEquals(t.result.structuredContent, { fixId: JOB_ID, status: 'completed', prUrl: 'https://github.com/x/y/pull/1' })
  assertEquals(t.result.content[0].type, 'text')
  assertStrictEquals(t.error, undefined)
})

Deno.test('jobToTask: failed carries error; cancelled carries statusMessage', () => {
  const f = jobToTask(job({ status: 'failed', error: 'sandbox exploded' }))
  assertEquals(f.status, 'failed')
  assertEquals(f.error?.message, 'sandbox exploded')
  const c = jobToTask(job({ status: 'cancelled', error: 'Cancelled by operator before worker pickup.' }))
  assertEquals(c.status, 'cancelled')
  assertEquals(c.statusMessage, 'Cancelled by operator before worker pickup.')
})

Deno.test('createTaskResultForJob: CreateTaskResult wire shape', () => {
  assertEquals(createTaskResultForJob(job()), {
    resultType: 'task',
    taskId: JOB_ID,
    status: 'working',
    createdAt: '2026-09-12T09:59:00.000Z',
    lastUpdatedAt: '2026-09-12T09:59:00.000Z',
    ttlMs: null,
    pollIntervalMs: 5000,
  })
})

// ── Tasks flow: declare → task → tasks/get working → completed ──────────────

Deno.test('tasks flow: tasks/get follows the job from working to completed', async () => {
  const { store, jobs } = mockStore({ jobs: [job()] })
  const deps = { store, dispatch: () => Promise.reject(new Error('not used')), now: NOW }

  const working = await handleTasksGet(deps, { taskId: JOB_ID })
  assertEquals(working.resultType, 'complete')
  assertEquals(working.task.status, 'working')
  assertEquals(working.task.taskId, JOB_ID)

  Object.assign(jobs.get(JOB_ID)!, { status: 'running', started_at: '2026-09-12T10:01:00.000Z' })
  const running = await handleTasksGet(deps, { taskId: JOB_ID })
  assertEquals(running.task.status, 'working')
  assertEquals(running.task.statusMessage, 'dispatch running')

  Object.assign(jobs.get(JOB_ID)!, { status: 'completed', finished_at: '2026-09-12T10:09:00.000Z', pr_url: 'https://github.com/x/y/pull/2' })
  const done = await handleTasksGet(deps, { taskId: JOB_ID })
  assertEquals(done.task.status, 'completed')
  assertEquals(done.task.result?.structuredContent?.prUrl, 'https://github.com/x/y/pull/2')
})

Deno.test('tasks/get: unknown taskId ⇒ -32602; missing taskId ⇒ -32602', async () => {
  const { store } = mockStore()
  const deps = { store, dispatch: () => Promise.reject(new Error('not used')) }
  const err = await assertRejects(() => handleTasksGet(deps, { taskId: 'nope' }), McpTaskError)
  assertEquals(err.code, -32602)
  const missing = await assertRejects(() => handleTasksGet(deps, {}), McpTaskError)
  assertEquals(missing.code, -32602)
})

Deno.test('tasks/cancel: queued job is cancelled cooperatively; terminal job reports its current state', async () => {
  const { store, jobs } = mockStore({ jobs: [job(), job({ id: 'done', status: 'completed', finished_at: '2026-09-12T10:09:00.000Z' })] })
  const deps = { store, dispatch: () => Promise.reject(new Error('not used')) }
  const cancelled = await handleTasksCancel(deps, { taskId: JOB_ID })
  assertEquals(cancelled.task.status, 'cancelled')
  assertEquals(jobs.get(JOB_ID)!.status, 'cancelled')

  const terminal = await handleTasksCancel(deps, { taskId: 'done' })
  assertEquals(terminal.task.status, 'completed')
  assertEquals(jobs.get('done')!.status, 'completed')
})

Deno.test('tasks/update: a plain job task is not awaiting input ⇒ -32602', async () => {
  const { store } = mockStore({ jobs: [job()] })
  const deps = { store, dispatch: () => Promise.reject(new Error('not used')) }
  const err = await assertRejects(() => handleTasksUpdate(deps, { taskId: JOB_ID, inputResponses: { confirm: accept } }), McpTaskError)
  assertEquals(err.code, -32602)
})

// ── Voice gate — MRTR (non-task client) ──────────────────────────────────────

Deno.test('voice gate: first call ⇒ input_required with the verbatim transcript and a requestState', async () => {
  const { store } = mockStore({ sessions: [session()] })
  const out = await evaluateVoiceGate({
    session: session(),
    projectId: PROJECT,
    reportId: REPORT,
    params: { name: 'dispatch_fix', arguments: { reportId: REPORT } },
    codec: codec(),
    store,
    taskClient: false,
    now: NOW,
  })
  assert(out.kind === 'respond')
  const r = out.result
  assertEquals(r.resultType, 'input_required')
  assert(typeof r.requestState === 'string' && r.requestState.length > 0)
  const req = (r as { inputRequests: Record<string, { method: string; params: { message: string; requestedSchema: unknown } }> }).inputRequests.confirm
  assertEquals(req.method, 'elicitation/create')
  assertEquals(
    req.params.message,
    'Voice request (verbatim): the checkout button does nothing on mobile\n\nAction: open a draft PR for report ' + REPORT + '. Confirm?',
  )
  assertEquals(req.params.requestedSchema, { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] })
  assertEquals(buildVoiceConfirmMessage('x', 'r'), 'Voice request (verbatim): x\n\nAction: open a draft PR for report r. Confirm?')
})

Deno.test('voice gate: retry with a valid requestState + accept ⇒ proceed, session confirmed by mcp', async () => {
  const { store, sessions, calls } = mockStore({ sessions: [session()] })
  const c = codec()
  const first = await evaluateVoiceGate({ session: session(), projectId: PROJECT, reportId: REPORT, params: {}, codec: c, store, taskClient: false, now: NOW })
  assert(first.kind === 'respond')
  const state = first.result.requestState as string

  const second = await evaluateVoiceGate({
    session: session(),
    projectId: PROJECT,
    reportId: REPORT,
    params: { inputResponses: { confirm: accept }, requestState: state },
    codec: c,
    store,
    taskClient: false,
    now: NOW + 1000,
  })
  assertEquals(second.kind, 'proceed')
  const s = sessions.get(SESSION_ID)!
  assertEquals(s.status, 'confirmed')
  assertEquals(s.confirmed_by, 'mcp')
  assert(s.confirmed_at)
  assert(calls.includes(`transition:${SESSION_ID}:confirmed`))
})

Deno.test('voice gate: retry with decline (or confirm:false) ⇒ session cancelled, isError result', async () => {
  for (const answer of [decline, { action: 'cancel' } as ElicitResult, { action: 'accept', content: { confirm: false } } as ElicitResult]) {
    const { store, sessions } = mockStore({ sessions: [session()] })
    const c = codec()
    const first = await evaluateVoiceGate({ session: session(), projectId: PROJECT, reportId: REPORT, params: {}, codec: c, store, taskClient: false, now: NOW })
    assert(first.kind === 'respond')
    const out = await evaluateVoiceGate({
      session: session(),
      projectId: PROJECT,
      reportId: REPORT,
      params: { inputResponses: { confirm: answer }, requestState: first.result.requestState },
      codec: c,
      store,
      taskClient: false,
      now: NOW,
    })
    assert(out.kind === 'declined', JSON.stringify(answer))
    assertEquals(out.result.isError, true)
    assertEquals(sessions.get(SESSION_ID)!.status, 'cancelled')
  }
})

Deno.test('voice gate: invalid / expired / replayed / foreign requestState ⇒ -32602 and no state change', async () => {
  const { store, sessions } = mockStore({ sessions: [session()] })
  const c = codec()
  const first = await evaluateVoiceGate({ session: session(), projectId: PROJECT, reportId: REPORT, params: {}, codec: c, store, taskClient: false, now: NOW })
  assert(first.kind === 'respond')
  const state = first.result.requestState as string
  const run = (requestState: unknown, now = NOW) =>
    evaluateVoiceGate({
      session: session(),
      projectId: PROJECT,
      reportId: REPORT,
      params: { inputResponses: { confirm: accept }, requestState },
      codec: c,
      store,
      taskClient: false,
      now,
    })

  // Tampered signature.
  const tampered = await run(state.slice(0, -2) + 'zz')
  assert(tampered.kind === 'error' && tampered.code === -32602)
  // Garbage.
  const garbage = await run('not-a-token')
  assert(garbage.kind === 'error' && garbage.code === -32602)
  // Expired (10 minutes later).
  const expired = await run(state, NOW + REQUEST_STATE_TTL_MS + 1)
  assert(expired.kind === 'error' && expired.code === -32602 && expired.message.includes('expired'))
  assertEquals(sessions.get(SESSION_ID)!.status, 'awaiting_confirm')

  // A state minted for a different report must not re-arm this one.
  const foreign = await c.sign({ kind: 'voice_confirm', sessionId: SESSION_ID, projectId: PROJECT, reportId: 'other-report', transcriptSha256: 'abc123', action: 'open_draft_pr' }, NOW)
  const mismatch = await run(foreign)
  assert(mismatch.kind === 'error' && mismatch.code === -32602)
  assertEquals(sessions.get(SESSION_ID)!.status, 'awaiting_confirm')

  // Valid once…
  const ok = await run(state)
  assertEquals(ok.kind, 'proceed')
  // …then replayed: rejected, and the CAS already moved the session anyway.
  const replay = await run(state)
  assert(replay.kind === 'error' && replay.code === -32602)
  assertEquals(sessions.get(SESSION_ID)!.status, 'confirmed')
})

Deno.test('voice gate: partial inputResponses re-issue input_required with a fresh requestState', async () => {
  const { store, sessions } = mockStore({ sessions: [session()] })
  const c = codec()
  const first = await evaluateVoiceGate({ session: session(), projectId: PROJECT, reportId: REPORT, params: {}, codec: c, store, taskClient: false, now: NOW })
  assert(first.kind === 'respond')
  const again = await evaluateVoiceGate({
    session: session(),
    projectId: PROJECT,
    reportId: REPORT,
    params: { inputResponses: {}, requestState: first.result.requestState },
    codec: c,
    store,
    taskClient: false,
    now: NOW,
  })
  assert(again.kind === 'respond')
  assertEquals(again.result.resultType, 'input_required')
  assert(again.result.requestState !== first.result.requestState)
  assertEquals(sessions.get(SESSION_ID)!.status, 'awaiting_confirm')
})

Deno.test('voice gate: legacy clients get an isError result naming the pending confirmation', () => {
  const r = legacyVoiceGateResult(session(), REPORT)
  assertEquals(r.isError, true)
  const body = JSON.parse(r.content[0].text) as Record<string, unknown>
  assertEquals(body.code, 'VOICE_CONFIRM_REQUIRED')
  assertEquals(body.voiceSessionId, SESSION_ID)
})

// ── Voice gate — tasks client ────────────────────────────────────────────────

Deno.test('voice gate (tasks client): task in input_required, then tasks/update accept ⇒ dispatch ⇒ working', async () => {
  const { store, sessions, jobs, calls } = mockStore({ sessions: [session()] })
  const out = await evaluateVoiceGate({ session: session(), projectId: PROJECT, reportId: REPORT, params: {}, codec: codec(), store, taskClient: true, now: NOW })
  assert(out.kind === 'respond')
  assertEquals(out.result.resultType, 'task')
  assertEquals(out.result.taskId, SESSION_ID)
  assertEquals(out.result.status, 'input_required')
  assert((out.result as { inputRequests?: Record<string, unknown> }).inputRequests?.confirm)

  let dispatched: VoiceIntakeSessionRow | null = null
  const dispatch = (s: VoiceIntakeSessionRow): Promise<CallToolResult> => {
    dispatched = s
    // The normal dispatch path inserted the job row and returned { fixId }.
    jobs.set(JOB_ID, job())
    return Promise.resolve({ content: [{ type: 'text', text: '{}' }], structuredContent: { fixId: JOB_ID, status: 'queued' } })
  }
  const deps = { store, dispatch, now: NOW }

  // tasks/get while awaiting: input_required with the same inputRequests.
  const pending = await handleTasksGet(deps, { taskId: SESSION_ID })
  assertEquals(pending.task.status, 'input_required')
  assert(pending.task.inputRequests?.confirm)

  // Partial answer leaves it pending.
  const partial = await handleTasksUpdate(deps, { taskId: SESSION_ID, inputResponses: {} })
  assertEquals(partial.task.status, 'input_required')
  assertStrictEquals(dispatched, null)

  const updated = await handleTasksUpdate(deps, { taskId: SESSION_ID, inputResponses: { confirm: accept } })
  assertEquals(updated.task.taskId, SESSION_ID)
  assertEquals(updated.task.status, 'working')
  assert(dispatched !== null)
  assertEquals((dispatched as VoiceIntakeSessionRow).status, 'confirmed')
  assertEquals(sessions.get(SESSION_ID)!.status, 'confirmed')
  assertEquals(sessions.get(SESSION_ID)!.confirmed_by, 'mcp')
  assert(calls.includes(`transition:${SESSION_ID}:confirmed`))

  // A second accept cannot re-arm the gate.
  const again = await assertRejects(() => handleTasksUpdate(deps, { taskId: SESSION_ID, inputResponses: { confirm: accept } }), McpTaskError)
  assertEquals(again.code, -32602)

  // tasks/get keeps the session id and follows the job.
  Object.assign(jobs.get(JOB_ID)!, { status: 'completed', finished_at: '2026-09-12T10:09:00.000Z', pr_url: 'https://github.com/x/y/pull/3' })
  const done = await handleTasksGet(deps, { taskId: SESSION_ID })
  assertEquals(done.task.taskId, SESSION_ID)
  assertEquals(done.task.status, 'completed')
  assertEquals(done.task.result?.structuredContent?.prUrl, 'https://github.com/x/y/pull/3')
})

Deno.test('voice gate (tasks client): tasks/update decline ⇒ cancelled, dispatch never runs; tasks/cancel cancels a pending gate', async () => {
  const { store, sessions } = mockStore({ sessions: [session()] })
  let dispatchCalls = 0
  const deps = {
    store,
    dispatch: () => {
      dispatchCalls++
      return Promise.resolve({ content: [{ type: 'text' as const, text: '{}' }] })
    },
    now: NOW,
  }
  const declined = await handleTasksUpdate(deps, { taskId: SESSION_ID, inputResponses: { confirm: decline } })
  assertEquals(declined.task.status, 'cancelled')
  assertEquals(sessions.get(SESSION_ID)!.status, 'cancelled')
  assertEquals(dispatchCalls, 0)

  const { store: store2, sessions: sessions2 } = mockStore({ sessions: [session()] })
  const cancelled = await handleTasksCancel({ ...deps, store: store2 }, { taskId: SESSION_ID })
  assertEquals(cancelled.task.status, 'cancelled')
  assertEquals(sessions2.get(SESSION_ID)!.status, 'cancelled')
})

Deno.test('voice gate (tasks client): dispatch failure after confirmation surfaces as a failed task', async () => {
  const { store } = mockStore({ sessions: [session()] })
  const deps = {
    store,
    dispatch: () => Promise.resolve({ content: [{ type: 'text' as const, text: '{"error":"AUTOFIX_DISABLED"}' }], isError: true }),
    now: NOW,
  }
  const r = await handleTasksUpdate(deps, { taskId: SESSION_ID, inputResponses: { confirm: accept } })
  assertEquals(r.task.status, 'failed')
  assert(r.task.error?.message.includes('AUTOFIX_DISABLED'))
})

Deno.test('readVoiceDecision: accept needs confirm:true; everything else answered is a rejection', () => {
  assertEquals(readVoiceDecision({ confirm: accept }), 'accept')
  assertEquals(readVoiceDecision({ confirm: { action: 'accept', content: { confirm: false } } }), 'reject')
  assertEquals(readVoiceDecision({ confirm: { action: 'accept' } }), 'reject')
  assertEquals(readVoiceDecision({ confirm: decline }), 'reject')
  assertEquals(readVoiceDecision({}), 'missing')
})
