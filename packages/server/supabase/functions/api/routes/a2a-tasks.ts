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
 *   PushNotificationConfig                       — body.configuration on POST,
 *                                                  fan-out via the
 *                                                  `a2a-push-notify` edge
 *                                                  function fired by the
 *                                                  fix_dispatch_jobs trigger.
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
 *
 * Push notifications
 * ──────────────────
 * Clients pass `body.configuration.pushNotificationConfig = { url, token? }`
 * on POST. We persist it on the dispatch row; an AFTER-UPDATE trigger on
 * `fix_dispatch_jobs.status` invokes the `a2a-push-notify` edge function
 * which signs the Task envelope with Standard Webhooks headers
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature`) and POSTs it
 * to the configured URL. Pull subscribers can still use the SSE stream;
 * pull and push are both supported simultaneously.
 *
 * Auth
 * ────
 * Same dual-mode `adminOrApiKey({ scope })` as the rest of /v1/admin/*.
 * Read paths require `mcp:read`; create/cancel require `mcp:write`.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts'
import { streamSSE } from 'npm:hono@4/streaming';

import { adminOrApiKey } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { invokeFixWorker } from '../helpers.ts';
import { userCanAccessProject } from '../shared.ts';
import { sanitizeSseString, toSseEvent, sseHeartbeat } from '../../_shared/sse.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { childTraceparent, extractInboundTraceparent } from '../../_shared/trace.ts';
import { log } from '../../_shared/logger.ts';

interface FixDispatchRow {
  id: string;
  project_id: string;
  report_id: string;
  status: string;
  skill: string | null;
  fix_attempt_id: string | null;
  pr_url: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  inventory_action_node_id: string | null;
}

const A2A_PROTOCOL_VERSION = '1.0.0';

/**
 * Map a Mushi fix_dispatch_jobs row to an A2A Task resource per the
 * v1.0.0 spec. The Task `state` is derived from `status`, with the
 * cancellation spelled `canceled` to match A2A (we keep `cancelled` in
 * the DB for consistency with the rest of the Mushi codebase).
 */
function rowToA2ATask(row: FixDispatchRow): Record<string, unknown> {
  const state =
    row.status === 'queued'
      ? 'submitted'
      : row.status === 'running'
        ? 'working'
        : row.status === 'completed'
          ? 'completed'
          : row.status === 'failed'
            ? 'failed'
            : row.status === 'skipped'
              ? 'completed'
              : row.status === 'cancelled'
                ? 'canceled'
                : 'unknown';
  const skill = row.skill ?? 'dispatch_fix';
  const artifacts: Array<Record<string, unknown>> = [];
  if (row.pr_url) {
    artifacts.push({
      name: 'pull_request',
      type: 'url',
      mimeType: 'text/uri-list',
      url: row.pr_url,
    });
  }
  return {
    id: row.id,
    type: 'task',
    state,
    skill,
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
      mushiVersion: A2A_PROTOCOL_VERSION,
    },
    links: {
      self: `/v1/a2a/tasks/${row.id}`,
      cancel: `/v1/a2a/tasks/${row.id}:cancel`,
      subscribe: `/v1/a2a/tasks/${row.id}:subscribe`,
    },
  };
}

export function registerA2ATaskRoutes(app: Hono<{ Variables: Variables }>): void {
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
    return withIdempotency(c, async () => {
      const userId = c.get('userId') as string;
      const projectIdFromKey = c.get('projectId') as string | undefined;
      const body = (await c.req.json().catch(() => ({}))) as {
        skill?: string;
        input?: Record<string, unknown>;
        configuration?: {
          pushNotificationConfig?: {
            url?: string;
            token?: string;
          };
        };
      };

      // A2A v1.0.0 PushNotificationConfig (optional). When provided we persist
      // it on the dispatch row; the `trg_fix_dispatch_jobs_a2a_push` trigger
      // then invokes `a2a-push-notify` for every status transition.
      const pushConfigRaw = body.configuration?.pushNotificationConfig;
      let pushConfig: { url: string; token?: string } | null = null;
      if (pushConfigRaw && typeof pushConfigRaw.url === 'string') {
        let parsed: URL | null = null;
        try {
          parsed = new URL(pushConfigRaw.url);
        } catch {
          parsed = null;
        }
        if (!parsed || parsed.protocol !== 'https:') {
          return c.json(
            {
              error: {
                code: 'INVALID_PUSH_URL',
                message: 'configuration.pushNotificationConfig.url must be a valid https:// URL',
              },
            },
            400,
          );
        }
        pushConfig = { url: parsed.toString() };
        if (typeof pushConfigRaw.token === 'string' && pushConfigRaw.token.length > 0) {
          if (pushConfigRaw.token.length > 4096) {
            return c.json(
              {
                error: {
                  code: 'INVALID_PUSH_TOKEN',
                  message: 'configuration.pushNotificationConfig.token exceeds 4096 chars',
                },
              },
              400,
            );
          }
          pushConfig.token = pushConfigRaw.token;
        }
      }

      const skill = body.skill ?? 'dispatch_fix';
      if (skill !== 'dispatch_fix' && skill !== 'classify_report' && skill !== 'judge_fix') {
        return c.json(
          {
            error: {
              code: 'UNSUPPORTED_SKILL',
              message:
                `Skill "${skill}" is not implemented as an A2A Task. ` +
                `Supported: "dispatch_fix", "classify_report", "judge_fix". ` +
                `See /.well-known/agent-card for the full skill catalog.`,
            },
          },
          400,
        );
      }

      const input = (body.input ?? {}) as {
        reportId?: string;
        projectId?: string;
        inventoryActionNodeId?: string;
      };
      const reportId = input.reportId;
      const projectId = input.projectId ?? projectIdFromKey;
      if (typeof reportId !== 'string' || typeof projectId !== 'string') {
        return c.json(
          {
            error: {
              code: 'MISSING_INPUT',
              message: 'input.reportId and input.projectId are required',
            },
          },
          400,
        );
      }
      if (
        input.inventoryActionNodeId !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.inventoryActionNodeId,
        )
      ) {
        return c.json(
          { error: { code: 'INVALID_INVENTORY_ACTION_ID', message: 'must be a UUID' } },
          400,
        );
      }

      const db = getServiceClient();
      const access = await userCanAccessProject(db, userId, projectId);
      if (!access.allowed) {
        return c.json(
          { error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
          403,
        );
      }

      // For classify_report and judge_fix: verify the report exists and belongs to the project.
      if (skill === 'classify_report' || skill === 'judge_fix') {
        const { data: report } = await db
          .from('reports')
          .select('id')
          .eq('id', reportId)
          .eq('project_id', projectId)
          .single();
        if (!report) {
          return c.json(
            { error: { code: 'NOT_FOUND', message: 'Report not found in this project' } },
            404,
          );
        }

        // For judge_fix, a fix attempt must exist to judge against.
        if (skill === 'judge_fix') {
          const { data: attempt } = await db
            .from('fix_attempts')
            .select('id')
            .eq('report_id', reportId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (!attempt) {
            return c.json(
              {
                error: {
                  code: 'PRECONDITION_FAILED',
                  message: 'No fix attempts found for this report. Dispatch a fix first.',
                },
              },
              409,
            );
          }
        }

        // Guard against racing concurrent tasks of the same skill for the same report.
        const { data: existing } = await db
          .from('fix_dispatch_jobs')
          .select('id, status')
          .eq('project_id', projectId)
          .eq('report_id', reportId)
          .eq('skill', skill)
          .in('status', ['queued', 'running'])
          .limit(1);
        if (existing?.length) {
          return c.json(
            {
              error: {
                code: 'TASK_ALREADY_RUNNING',
                message: `A "${skill}" task is already in progress for this report`,
                taskId: existing[0].id,
              },
            },
            409,
          );
        }

        // Insert a tracking row so GET /tasks/:id and :subscribe work.
        const { data: job, error } = await db
          .from('fix_dispatch_jobs')
          .insert({
            project_id: projectId,
            report_id: reportId,
            requested_by: userId,
            status: 'running',
            skill,
            inventory_action_node_id: input.inventoryActionNodeId ?? null,
            started_at: new Date().toISOString(),
            push_notification_config: pushConfig,
          })
          .select('*')
          .single();
        if (error || !job) {
          return c.json(
            {
              error: { code: 'CREATE_FAILED', message: error?.message ?? 'Could not enqueue task' },
            },
            500,
          );
        }

        // Fire-and-forget: invoke the backing edge function.
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && serviceKey) {
          const fnName = skill === 'classify_report' ? 'fast-filter' : 'judge-batch';
          const fnBody =
            skill === 'classify_report'
              ? { reportId, projectId }
              : { projectId, reportIds: [reportId], trigger: 'a2a' };
          const trackingId = job.id;
          fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fnBody),
          })
            .then(async (res) => {
              const finalStatus = res.ok ? 'completed' : 'failed';
              const errMsg = res.ok ? null : `${fnName} returned ${res.status}`;
              await db
                .from('fix_dispatch_jobs')
                .update({
                  status: finalStatus,
                  finished_at: new Date().toISOString(),
                  error: errMsg,
                })
                .eq('id', trackingId);
            })
            .catch(async (err) => {
              await db
                .from('fix_dispatch_jobs')
                .update({
                  status: 'failed',
                  finished_at: new Date().toISOString(),
                  error: String(err),
                })
                .eq('id', trackingId);
            });
        }

        return c.json(rowToA2ATask(job as FixDispatchRow), 201);
      }

      // Same in-flight guard as POST /v1/admin/fixes/dispatch — we don't
      // want two A2A clients (or one A2A client + the admin UI) racing.
      const { data: existing } = await db
        .from('fix_dispatch_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('report_id', reportId)
        .in('status', ['queued', 'running'])
        .or('skill.is.null,skill.eq.dispatch_fix')
        .limit(1);
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
        );
      }

      const { data: job, error } = await db
        .from('fix_dispatch_jobs')
        .insert({
          project_id: projectId,
          report_id: reportId,
          requested_by: userId,
          status: 'queued',
          skill: 'dispatch_fix',
          inventory_action_node_id: input.inventoryActionNodeId ?? null,
          push_notification_config: pushConfig,
        })
        .select('*')
        .single();
      if (error || !job) {
        return c.json(
          { error: { code: 'CREATE_FAILED', message: error?.message ?? 'Could not enqueue task' } },
          500,
        );
      }

      invokeFixWorker(job.id).catch((err) => {
        log.warn('worker invocation failed', { scope: 'a2a-tasks', taskId: job.id, err: String(err) });
      });

      return c.json(rowToA2ATask(job as FixDispatchRow), 201);
    }); // withIdempotency
  });

  // ----------------------------------------------------------------
  // GET /v1/a2a/tasks/{id} — fetch state
  // ----------------------------------------------------------------
  app.get('/v1/a2a/tasks/:id', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const { data: row } = await db.from('fix_dispatch_jobs').select('*').eq('id', id).single();
    if (!row) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    const access = await userCanAccessProject(db, userId, row.project_id);
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403);
    return c.json(rowToA2ATask(row as FixDispatchRow));
  });

  // ----------------------------------------------------------------
  // POST /v1/a2a/tasks/{id}:cancel
  //
  // A2A spec uses the colon-delimited action suffix style for sub-resource
  // verbs. Hono's path parser would greedily eat the `:cancel` suffix into
  // the param, so we constrain `id` to anything that isn't a colon
  // (`[^:]+`) and pin the literal `:cancel` after it. Same CAS guard as
  // the admin cancel route.
  // ----------------------------------------------------------------
  app.post('/v1/a2a/tasks/:id{[^:]+}:cancel', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const { data: job } = await db
      .from('fix_dispatch_jobs')
      .select('id, project_id, status, fix_attempt_id')
      .eq('id', id)
      .single();
    if (!job) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403);
    if (job.status !== 'queued' && job.status !== 'running') {
      return c.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Task is already ${job.status}; cannot cancel.`,
          },
        },
        409,
      );
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
      .single();
    if (updErr || !updated) {
      return c.json(
        {
          error: { code: 'INVALID_STATE', message: 'Task finished before cancellation could land' },
        },
        409,
      );
    }
    return c.json(rowToA2ATask(updated as FixDispatchRow));
  });

  // ----------------------------------------------------------------
  // GET /v1/a2a/tasks/{id}:subscribe — SSE stream of state changes
  //
  // Frames are A2A-shaped: each event is a Task snapshot (same payload
  // as GET) wrapped in an `{event:"task.updated", data:{...}}` envelope.
  // We re-use the existing fix_dispatch_jobs polling pattern from the
  // AG-UI stream so the back-pressure and timeout semantics stay
  // identical across the two surfaces.
  // ----------------------------------------------------------------
  app.get('/v1/a2a/tasks/:id{[^:]+}:subscribe', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const { data: row } = await db.from('fix_dispatch_jobs').select('*').eq('id', id).single();
    if (!row) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    const access = await userCanAccessProject(db, userId, row.project_id);
    if (!access.allowed) return c.json({ error: { code: 'FORBIDDEN' } }, 403);

    const lastEventId = c.req.header('last-event-id') ?? c.req.header('Last-Event-ID') ?? null;

    return streamSSE(c, async (stream) => {
      const inboundTraceparent = extractInboundTraceparent(c.req.header('traceparent'));
      let lastStatus = '';
      let lastFixEventAt: string | null = null;
      let elapsed = 0;
      const HEARTBEAT_EVERY_MS = 15_000;
      const POLL_EVERY_MS = 1_500;
      const MAX_DURATION_MS = 10 * 60_000;

      // Last-Event-Id replay: replay any fix_events that occurred after
      // the last event the client acknowledged before the connection dropped.
      const lastEventPrefix = `${id}:fix:`;
      if (lastEventId && row.fix_attempt_id) {
        const lastFixEventId = lastEventId.startsWith(lastEventPrefix)
          ? lastEventId.slice(lastEventPrefix.length)
          : null;
        let replayQuery = db
          .from('fix_events')
          .select('id, kind, status, label, detail, at')
          .eq('fix_attempt_id', row.fix_attempt_id)
          .order('at', { ascending: true })
          .limit(100);
        if (lastFixEventId) {
          const { data: lastSeen } = await db
            .from('fix_events')
            .select('at')
            .eq('id', lastFixEventId)
            .single();
          if (lastSeen?.at) {
            replayQuery = replayQuery.gt('at', lastSeen.at);
          }
        }
        const { data: missed } = await replayQuery;
        if (missed && missed.length > 0) {
          for (const ev of missed) {
            await stream.write(
              toSseEvent(
                { kind: ev.kind, status: ev.status, label: ev.label, detail: ev.detail, at: ev.at },
                { event: 'fix.event', id: `${id}:fix:${ev.id}` },
              ),
            );
            lastFixEventAt = ev.at;
          }
        }
      }

      // Emit the current snapshot up-front so a late subscriber doesn't
      // wait the full poll interval to learn the task's state.
      await stream.write(
        toSseEvent(rowToA2ATask(row as FixDispatchRow), { event: 'task.updated', id: `${id}:0` }),
      );

      // Emit initial traceparent frame so consumers can attach to the trace.
      if (inboundTraceparent) {
        await stream.write(
          toSseEvent(
            { traceparent: childTraceparent(inboundTraceparent) },
            { event: 'trace.context', id: `${id}:trace` },
          ),
        );
      }

      while (elapsed < MAX_DURATION_MS && !stream.aborted) {
        const { data: latest } = await db
          .from('fix_dispatch_jobs')
          .select('*')
          .eq('id', id)
          .single();
        if (!latest) {
          await stream.write(toSseEvent({ code: 'NOT_FOUND' }, { event: 'task.error' }));
          break;
        }
        if (latest.status !== lastStatus) {
          lastStatus = latest.status;
          // Sanitise the error string before embedding so a hostile error
          // payload can't inject SSE control frames (CVE-2026-29085).
          const sanitized = latest.error ? sanitizeSseString(latest.error).slice(0, 500) : null;
          const task = rowToA2ATask({ ...(latest as FixDispatchRow), error: sanitized });
          await stream.write(
            toSseEvent(task, { event: 'task.updated', id: `${id}:${Date.now()}` }),
          );
        }

        // Stream any new fix_events since last poll (powers live timeline).
        if (latest.fix_attempt_id) {
          let feQuery = db
            .from('fix_events')
            .select('id, kind, status, label, detail, at')
            .eq('fix_attempt_id', latest.fix_attempt_id)
            .order('at', { ascending: true })
            .limit(20);
          if (lastFixEventAt) feQuery = feQuery.gt('at', lastFixEventAt);
          const { data: newFE } = await feQuery;
          if (newFE && newFE.length > 0) {
            for (const ev of newFE) {
              await stream.write(
                toSseEvent(
                  {
                    kind: ev.kind,
                    status: ev.status,
                    label: ev.label,
                    detail: ev.detail,
                    at: ev.at,
                  },
                  { event: 'fix.event', id: `${id}:fix:${ev.id}` },
                ),
              );
              lastFixEventAt = ev.at;
            }
          }
        }
        if (
          latest.status === 'completed' ||
          latest.status === 'failed' ||
          latest.status === 'cancelled' ||
          latest.status === 'skipped'
        ) {
          await stream.write(toSseEvent({ done: true }, { event: 'task.terminal' }));
          break;
        }
        if (elapsed % HEARTBEAT_EVERY_MS < POLL_EVERY_MS) {
          await stream.write(sseHeartbeat());
        }
        await stream.sleep(POLL_EVERY_MS);
        elapsed += POLL_EVERY_MS;
      }

      if (elapsed >= MAX_DURATION_MS) {
        await stream.write(
          toSseEvent(
            { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' },
            { event: 'task.error' },
          ),
        );
      }
    });
  });
}
