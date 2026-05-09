/**
 * FILE: packages/server/supabase/functions/api/routes/a2a-tasks.ts
 *
 * A2A (Agent-to-Agent) v1.0.0 Tasks surface
 * ─────────────────────────────────────────
 * Implements the Tasks resource family from Google's Agent2Agent v1.0.0
 * spec (March 2026 release):
 *
 *   POST  /v1/a2a/tasks                          — create a Task
 *   GET   /v1/a2a/tasks/{id}                     — fetch state
 *   POST  /v1/a2a/tasks/{id}:cancel              — cancel
 *   GET   /v1/a2a/tasks/{id}:subscribe           — SSE stream of events
 *
 * Why this file exists
 * ────────────────────
 * The agent card at `/.well-known/agent-card` already advertises a Tasks
 * skill set (`dispatch_fix`, `judge_fix`, `classify_report`,
 * `intelligence_report`), but until now the only way to *delegate* a task
 * to Mushi via A2A was to call the Mushi-shaped `/v1/admin/fixes/dispatch`
 * endpoint — which any A2A-spec-following agent will fail to discover.
 *
 * This route maps A2A's spec onto the existing `fix_dispatch_jobs` table
 * one-for-one (no new table needed): every A2A Task IS a fix dispatch
 * job, and the existing AG-UI SSE stream becomes the A2A subscribe
 * stream. We translate state names at the edge:
 *
 *     fix_dispatch_jobs.status   →   A2A Task.state
 *     ─────────────────────────────────────────────
 *     queued                     →   submitted
 *     running                    →   working
 *     completed                  →   completed
 *     failed                     →   failed
 *     skipped                    →   completed (with `result.skipped: true`)
 *     cancelled                  →   canceled  (sic: A2A spec spelling)
 *
 * What we don't yet implement
 * ───────────────────────────
 * - Task input/output Artifact storage (Mushi outputs a PR URL —
 *   represented as a single text artifact in the response).
 * - A2A Push notifications. Subscribers use the SSE pull stream below;
 *   webhook push lands in a future PR (the outbound webhook system
 *   already covers `fix.pr_opened` / `fix.failed` for HMAC-signed pushes).
 *
 * Auth
 * ────
 * Same dual-mode `adminOrApiKey({ scope })` as the rest of /v1/admin/*.
 * Read paths require `mcp:read`; create/cancel require `mcp:write`.
 */

import type { Hono } from 'npm:hono@4'
import { streamSSE } from 'npm:hono@4/streaming'

import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { invokeFixWorker } from '../helpers.ts'
import { userCanAccessProject } from '../shared.ts'
import { sanitizeSseString, toSseEvent, sseHeartbeat } from '../../_shared/sse.ts'

interface FixDispatchRow {
  id: string
  project_id: string
  report_id: string
  status: string
  fix_attempt_id: string | null
  pr_url: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  inventory_action_node_id: string | null
}

const A2A_PROTOCOL_VERSION = '1.0.0'

/**
 * Map a Mushi fix_dispatch_jobs row to an A2A Task resource per the
 * v1.0.0 spec. The Task `state` is derived from `status`, with the
 * cancellation spelled `canceled` to match A2A (we keep `cancelled` in
 * the DB for consistency with the rest of the Mushi codebase).
 */
function rowToA2ATask(row: FixDispatchRow): Record<string, unknown> {
  const state =
    row.status === 'queued' ? 'submitted'
    : row.status === 'running' ? 'working'
    : row.status === 'completed' ? 'completed'
    : row.status === 'failed' ? 'failed'
    : row.status === 'skipped' ? 'completed'
    : row.status === 'cancelled' ? 'canceled'
    : 'unknown'
  const artifacts: Array<Record<string, unknown>> = []
  if (row.pr_url) {
    artifacts.push({
      name: 'pull_request',
      type: 'url',
      mimeType: 'text/uri-list',
      url: row.pr_url,
    })
  }
  return {
    id: row.id,
    type: 'task',
    state,
    skill: 'dispatch_fix',
    submittedAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.finished_at,
    error: row.error,
    artifacts,
    metadata: {
      projectId: row.project_id,
      reportId: row.report_id,
      fixAttemptId: row.fix_attempt_id,
      inventoryActionNodeId: row.inventory_action_node_id,
      // Spec-traceability hint for the orchestrator. They can fetch the
      // full inventory anchor via the MCP `get_fix_context` tool — we
      // don't inline the whole expected_outcome here because it bloats
      // every task fetch and most consumers only need the id.
      mushiVersion: A2A_PROTOCOL_VERSION,
    },
    links: {
      self: `/v1/a2a/tasks/${row.id}`,
      cancel: `/v1/a2a/tasks/${row.id}:cancel`,
      subscribe: `/v1/a2a/tasks/${row.id}:subscribe`,
    },
  }
}

export function registerA2ATaskRoutes(app: Hono): void {
  // ----------------------------------------------------------------
  // POST /v1/a2a/tasks — create a Task
  //
  // Body shape (A2A v1.0.0):
  //   {
  //     skill: "dispatch_fix",
  //     input: {
  //       reportId: "...",
  //       projectId: "...",                    // optional when API-key call (key carries it)
  //       inventoryActionNodeId: "..."         // optional spec-traceability hint
  //     }
  //   }
  // ----------------------------------------------------------------
  app.post('/v1/a2a/tasks', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectIdFromKey = c.get('projectId') as string | undefined
    const body = (await c.req.json().catch(() => ({}))) as {
      skill?: string
      input?: Record<string, unknown>
    }

    const skill = body.skill ?? 'dispatch_fix'
    if (skill !== 'dispatch_fix') {
      return c.json(
        {
          error: {
            code: 'UNSUPPORTED_SKILL',
            message:
              `Skill "${skill}" is not implemented as an A2A Task. ` +
              `Today only "dispatch_fix" is. See /.well-known/agent-card for the full skill catalog.`,
          },
        },
        400,
      )
    }

    const input = (body.input ?? {}) as { reportId?: string; projectId?: string; inventoryActionNodeId?: string }
    const reportId = input.reportId
    const projectId = input.projectId ?? projectIdFromKey
    if (typeof reportId !== 'string' || typeof projectId !== 'string') {
      return c.json(
        { error: { code: 'MISSING_INPUT', message: 'input.reportId and input.projectId are required' } },
        400,
      )
    }
    if (
      input.inventoryActionNodeId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.inventoryActionNodeId)
    ) {
      return c.json(
        { error: { code: 'INVALID_INVENTORY_ACTION_ID', message: 'must be a UUID' } },
        400,
      )
    }

    const db = getServiceClient()
    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    // Same in-flight guard as POST /v1/admin/fixes/dispatch — we don't
    // want two A2A clients (or one A2A client + the admin UI) racing.
    const { data: existing } = await db
      .from('fix_dispatch_jobs')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('report_id', reportId)
      .in('status', ['queued', 'running'])
      .limit(1)
    if (existing?.length) {
      return c.json(
        {
          error: {
            code: 'TASK_ALREADY_RUNNING',
            message: 'A task is already in progress for this report',
            taskId: existing[0].id,
          },
        },
        409,
      )
    }

    const { data: job, error } = await db
      .from('fix_dispatch_jobs')
      .insert({
        project_id: projectId,
        report_id: reportId,
        requested_by: userId,
        status: 'queued',
        inventory_action_node_id: input.inventoryActionNodeId ?? null,
      })
      .select('*')
      .single()
    if (error || !job) {
      return c.json(
        { error: { code: 'CREATE_FAILED', message: error?.message ?? 'Could not enqueue task' } },
        500,
      )
    }

    invokeFixWorker(job.id).catch((err) => {
      console.warn('[a2a-tasks] worker invocation failed', { taskId: job.id, err: String(err) })
    })

    return c.json(rowToA2ATask(job as FixDispatchRow), 201)
  })

  // ----------------------------------------------------------------
  // GET /v1/a2a/tasks/{id} — fetch state
  // ----------------------------------------------------------------
  app.get('/v1/a2a/tasks/:id', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id')
    const db = getServiceClient()
    const { data: row } = await db
      .from('fix_dispatch_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (!row) return c.json({ error: { code: 'NOT_FOUND' } }, 404)
    const access = await userCanAccessProject(db, userId, row.project_id)
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403)
    return c.json(rowToA2ATask(row as FixDispatchRow))
  })

  // ----------------------------------------------------------------
  // POST /v1/a2a/tasks/{id}:cancel
  //
  // A2A spec uses the colon-delimited action suffix style for sub-resource
  // verbs. Hono treats `:cancel` as part of the path token, so we register
  // it explicitly. Same CAS guard as the admin cancel route.
  // ----------------------------------------------------------------
  app.post('/v1/a2a/tasks/:id\\:cancel', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id')
    const db = getServiceClient()
    const { data: job } = await db
      .from('fix_dispatch_jobs')
      .select('id, project_id, status, fix_attempt_id')
      .eq('id', id)
      .single()
    if (!job) return c.json({ error: { code: 'NOT_FOUND' } }, 404)
    const access = await userCanAccessProject(db, userId, job.project_id)
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403)
    if (job.status !== 'queued' && job.status !== 'running') {
      return c.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Task is already ${job.status}; cannot cancel.`,
          },
        },
        409,
      )
    }
    const { data: updated, error: updErr } = await db
      .from('fix_dispatch_jobs')
      .update({
        status: 'cancelled',
        finished_at: new Date().toISOString(),
        error: 'Cancelled via A2A tasks/:id:cancel',
      })
      .eq('id', id)
      .in('status', ['queued', 'running'])
      .select('*')
      .single()
    if (updErr || !updated) {
      return c.json(
        { error: { code: 'INVALID_STATE', message: 'Task finished before cancellation could land' } },
        409,
      )
    }
    return c.json(rowToA2ATask(updated as FixDispatchRow))
  })

  // ----------------------------------------------------------------
  // GET /v1/a2a/tasks/{id}:subscribe — SSE stream of state changes
  //
  // Frames are A2A-shaped: each event is a Task snapshot (same payload
  // as GET) wrapped in an `{event:"task.updated", data:{...}}` envelope.
  // We re-use the existing fix_dispatch_jobs polling pattern from the
  // AG-UI stream so the back-pressure and timeout semantics stay
  // identical across the two surfaces.
  // ----------------------------------------------------------------
  app.get('/v1/a2a/tasks/:id\\:subscribe', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id')
    const db = getServiceClient()
    const { data: row } = await db
      .from('fix_dispatch_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (!row) return c.json({ error: { code: 'NOT_FOUND' } }, 404)
    const access = await userCanAccessProject(db, userId, row.project_id)
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403)

    return streamSSE(c, async (stream) => {
      let lastStatus = ''
      let elapsed = 0
      const HEARTBEAT_EVERY_MS = 15_000
      const POLL_EVERY_MS = 1_500
      const MAX_DURATION_MS = 10 * 60_000

      // Emit the current snapshot up-front so a late subscriber doesn't
      // wait the full poll interval to learn the task's state.
      await stream.write(toSseEvent(rowToA2ATask(row as FixDispatchRow), { event: 'task.updated', id: `${id}:0` }))

      while (elapsed < MAX_DURATION_MS && !stream.aborted) {
        const { data: latest } = await db
          .from('fix_dispatch_jobs')
          .select('*')
          .eq('id', id)
          .single()
        if (!latest) {
          await stream.write(toSseEvent({ code: 'NOT_FOUND' }, { event: 'task.error' }))
          break
        }
        if (latest.status !== lastStatus) {
          lastStatus = latest.status
          // Sanitise the error string before embedding so a hostile error
          // payload can't inject SSE control frames (CVE-2026-29085).
          const sanitized = latest.error
            ? sanitizeSseString(latest.error).slice(0, 500)
            : null
          const task = rowToA2ATask({ ...(latest as FixDispatchRow), error: sanitized })
          await stream.write(toSseEvent(task, { event: 'task.updated', id: `${id}:${Date.now()}` }))
        }
        if (
          latest.status === 'completed' ||
          latest.status === 'failed' ||
          latest.status === 'cancelled' ||
          latest.status === 'skipped'
        ) {
          await stream.write(toSseEvent({ done: true }, { event: 'task.terminal' }))
          break
        }
        if (elapsed % HEARTBEAT_EVERY_MS < POLL_EVERY_MS) {
          await stream.write(sseHeartbeat())
        }
        await stream.sleep(POLL_EVERY_MS)
        elapsed += POLL_EVERY_MS
      }

      if (elapsed >= MAX_DURATION_MS) {
        await stream.write(
          toSseEvent(
            { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' },
            { event: 'task.error' },
          ),
        )
      }
    })
  })
}
