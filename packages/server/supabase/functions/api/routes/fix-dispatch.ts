import type { Hono, Context } from 'npm:hono@4';
import { streamSSE } from 'npm:hono@4/streaming';

import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts';
import { AguiEmitter } from '../../_shared/agui.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reportError } from '../../_shared/sentry.ts';
import { apiKeyAuth, jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import {
  requireFeature,
  resolveActiveEntitlement,
  GATED_ROUTES,
  type FeatureFlag,
} from '../../_shared/entitlements.ts';
import { requireSuperAdmin } from '../../_shared/super-admin.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { currentRegion, lookupProjectRegion, regionEndpoint } from '../../_shared/region.ts';
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { reportSubmissionSchema } from '../../_shared/schemas.ts';
import { checkAntiGaming } from '../../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../../_shared/telemetry.ts';
import { awardPoints, getReputation } from '../../_shared/reputation.ts';
import { createNotification, buildNotificationMessage } from '../../_shared/notifications.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { getActivePlugins, dispatchPluginEvent } from '../../_shared/plugins.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds, userCanAccessProject } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerFixDispatchRoutes(app: Hono): void {
  // ============================================================
  // FIX DISPATCH (V5.3 §2.10) — admin-triggered, queue-based
  // ============================================================

  app.post('/v1/admin/fixes/dispatch', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    try {
      const userId = c.get('userId') as string;
      const body = (await c.req.json().catch(() => ({}))) as {
        reportId?: string;
        projectId?: string;
      };
      if (!body.reportId || !body.projectId) {
        return c.json(
          {
            ok: false,
            error: { code: 'MISSING_FIELDS', message: 'reportId and projectId required' },
          },
          400,
        );
      }

      const db = getServiceClient();

      // Authorisation chain (Teams v1):
      //   1. Direct project owner.
      //   2. Org-scoped membership (any role can dispatch — same gate as
      //      legacy project_members which didn't role-check either).
      //   3. Per-project membership (legacy multi-collaborator projects).
      // Centralised in userCanAccessProject so we don't drift from the
      // other dispatch / read endpoints.
      const access = await userCanAccessProject(db, userId, body.projectId);
      if (!access.allowed) {
        return c.json(
          { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
          403,
        );
      }

      const { data: settings, error: settingsErr } = await db
        .from('project_settings')
        .select('autofix_enabled')
        .eq('project_id', body.projectId)
        .maybeSingle();
      if (settingsErr) return dbError(c, settingsErr);
      if (!settings?.autofix_enabled) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'AUTOFIX_DISABLED',
              message: 'Enable Autofix in project settings first',
            },
          },
          400,
        );
      }

      // Scope the in-flight check to (project_id, report_id). Reports are
      // project-scoped, so two different projects must be allowed to dispatch
      // jobs concurrently even if their report_id values happen to coincide.
      const { data: existing } = await db
        .from('fix_dispatch_jobs')
        .select('id, status')
        .eq('project_id', body.projectId)
        .eq('report_id', body.reportId)
        .in('status', ['queued', 'running'])
        .limit(1);
      if (existing?.length) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'ALREADY_DISPATCHED',
              message: 'A fix dispatch is already in progress for this report',
              dispatchId: existing[0].id,
            },
          },
          409,
        );
      }

      const { data: job, error: insertErr } = await db
        .from('fix_dispatch_jobs')
        .insert({
          project_id: body.projectId,
          report_id: body.reportId,
          requested_by: userId,
          status: 'queued',
        })
        .select('id, status, created_at')
        .single();
      if (insertErr || !job) {
        return c.json(
          {
            ok: false,
            error: { code: 'DISPATCH_FAILED', message: insertErr?.message ?? 'Could not enqueue' },
          },
          500,
        );
      }

      // Fire-and-forget invoke of the fix-worker Edge Function. We deliberately
      // do not await — the SSE stream above is the channel the UI uses to track
      // progress. EdgeRuntime.waitUntil keeps the worker alive after the
      // dispatch response returns. If the worker invocation fails, the dispatch
      // row sits in 'queued' until a future cron-driven retry picks it up.
      invokeFixWorker(job.id).catch((err) => {
        console.warn('[fix-dispatch] worker invocation failed', {
          dispatchId: job.id,
          err: String(err),
        });
      });

      return c.json({
        ok: true,
        data: { dispatchId: job.id, status: job.status, createdAt: job.created_at },
      });
    } catch (err) {
      // Temporary: the dispatch endpoint was returning 500 via the Hono
      // onError path with no captured Sentry event (likely because the
      // error was a deep Deno primitive that didn't serialise). Log the
      // full message+stack here so we can see it in Supabase function
      // logs while we nail down the root cause, then bubble so the
      // standard Sentry handler still fires.
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : null;
      log.error('[fix-dispatch] unhandled error', { message: msg, stack });
      throw err;
    }
  });

  app.get('/v1/admin/fixes/dispatches', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    // Teams v1: include org-member projects (the previous project_members-only
    // filter showed "0 dispatches" to invited team members).
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { dispatches: [] } });
    const { data: dispatches } = await db
      .from('fix_dispatch_jobs')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(50);
    return c.json({ ok: true, data: { dispatches: dispatches ?? [] } });
  });

  app.get('/v1/admin/fixes/dispatch/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const dispatchId = c.req.param('id');
    const db = getServiceClient();
    const { data: job } = await db
      .from('fix_dispatch_jobs')
      .select('*, project:project_id(id, name)')
      .eq('id', dispatchId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    // Teams v1: owner / org-member / project-member can all read & cancel.
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    return c.json({ ok: true, data: job });
  });

  // Wave S (2026-04-23): the admin UI has had a "Cancel" button on inflight
  // dispatches since the PDCA drawer shipped, but the corresponding endpoint
  // was missing — the button 404'd every time. We now expose a safe
  // transition: only queued or running jobs can be cancelled, and the
  // caller must be a member of the owning project. The fix-worker polls on
  // `status = 'queued'` so a cancelled job will never be picked up; a
  // running job is allowed to flip to cancelled on a best-effort basis — the
  // worker's own CAS update (`status='running' -> 'completed'`) will race
  // against this flip, but since we write `status = 'cancelled'` at the end
  // of the job only when the worker sees the change, the realized end state
  // is always "cancelled wins if we got there first".
  app.post('/v1/admin/fixes/dispatches/:id/cancel', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const userEmail = (c.get('userEmail') as string | undefined) ?? null;
    const dispatchId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db
      .from('fix_dispatch_jobs')
      .select('id, project_id, status, fix_attempt_id')
      .eq('id', dispatchId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Teams v1: owner / org-member / project-member can all read & cancel.
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    // Terminal states can't be cancelled — return 409 so the UI can show a
    // precise message instead of hiding the button state-dependently.
    if (job.status !== 'queued' && job.status !== 'running') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Dispatch is already ${job.status}; cannot cancel.`,
          },
        },
        409,
      );
    }

    // CAS update — the worker does the inverse transition (queued -> running
    // -> completed/failed), so this guarded write prevents us from clobbering
    // a terminal state that landed between the read and the write.
    const { data: updated, error: updErr } = await db
      .from('fix_dispatch_jobs')
      .update({
        status: 'cancelled',
        finished_at: new Date().toISOString(),
        error:
          job.status === 'running'
            ? 'Cancelled by operator while running — worker may have partially completed work before noticing.'
            : 'Cancelled by operator before worker pickup.',
      })
      .eq('id', dispatchId)
      .in('status', ['queued', 'running'])
      .select('id, status, fix_attempt_id')
      .single();

    if (updErr || !updated) {
      // Re-read so the client gets the realized state — usually 'completed'
      // or 'failed' because the worker raced us to the finish line.
      const { data: reread } = await db
        .from('fix_dispatch_jobs')
        .select('status')
        .eq('id', dispatchId)
        .single();
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Dispatch finished before we could cancel (current: ${reread?.status ?? 'unknown'}).`,
          },
        },
        409,
      );
    }

    // Best-effort audit log. Failures here don't abort the cancel — the user
    // needs their cancel confirmed even if audit pipeline is having a bad day.
    db.from('audit_logs')
      .insert({
        project_id: job.project_id,
        actor_id: userId,
        actor_email: userEmail,
        action: 'fix_dispatch.cancelled',
        resource_type: 'fix_dispatch_job',
        resource_id: dispatchId,
        metadata: {
          previous_status: job.status,
          fix_attempt_id: job.fix_attempt_id,
        },
      })
      .then(({ error: auditErr }) => {
        if (auditErr) console.warn('[audit_logs] cancel insert failed:', auditErr.message);
      });

    return c.json({ ok: true, data: { id: updated.id, status: updated.status } });
  });

  // ------------------------------------------------------------
  // V5.3 §2.10 (M8): live status stream for a fix-dispatch job.
  // Uses Hono's streamSSE with deferred Bearer auth (the browser cannot send
  // Authorization on EventSource, so the client uses fetch + ReadableStream).
  // All payloads are JSON-encoded via toSseEvent so untrusted strings cannot
  // inject "event:"/"id:"/"data:"/"retry:" frames (CVE-2026-29085).
  // ------------------------------------------------------------
  app.get('/v1/admin/fixes/dispatch/:id/stream', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const dispatchId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db
      .from('fix_dispatch_jobs')
      .select('id, project_id, status, fix_attempt_id, pr_url, error')
      .eq('id', dispatchId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Teams v1: owner / org-member / project-member can all read & cancel.
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    // V5.3.2 §2.14, B3: AG-UI streaming protocol envelope.
    // The legacy `event: status` frame is still emitted for back-compat; new
    // clients should subscribe to the AG-UI event types (`run.*`).
    return streamSSE(c, async (stream) => {
      const agui = new AguiEmitter({
        runId: dispatchId,
        write: (frame) => stream.write(frame),
      });

      let lastStatus = '';
      let elapsed = 0;
      const HEARTBEAT_EVERY_MS = 15_000;
      const POLL_EVERY_MS = 1_500;
      const MAX_DURATION_MS = 10 * 60_000;

      await agui.started({
        resource: 'fix_dispatch',
        resourceId: dispatchId,
        attributes: { projectId: job.project_id },
      });

      while (elapsed < MAX_DURATION_MS && !stream.aborted) {
        const { data: latest } = await db
          .from('fix_dispatch_jobs')
          .select('status, fix_attempt_id, pr_url, error, started_at, finished_at')
          .eq('id', dispatchId)
          .single();
        if (!latest) {
          await agui.failed({ code: 'NOT_FOUND', message: 'Job disappeared' });
          await stream.write(toSseEvent({ code: 'NOT_FOUND' }, { event: 'error' }));
          break;
        }

        if (latest.status !== lastStatus) {
          lastStatus = latest.status;
          const sanitized = latest.error ? sanitizeForLog(latest.error) : null;

          await agui.status({
            status: latest.status,
            detail: sanitized ?? undefined,
          });

          await stream.write(
            toSseEvent(
              {
                status: latest.status,
                fixAttemptId: latest.fix_attempt_id,
                prUrl: latest.pr_url,
                startedAt: latest.started_at,
                finishedAt: latest.finished_at,
                error: sanitized,
              },
              { event: 'status', id: `${dispatchId}:${Date.now()}` },
            ),
          );
        }

        if (
          latest.status === 'completed' ||
          latest.status === 'failed' ||
          latest.status === 'cancelled'
        ) {
          if (latest.status === 'completed') {
            await agui.completed({
              output: { prUrl: latest.pr_url, fixAttemptId: latest.fix_attempt_id },
            });
          } else {
            await agui.failed({
              code: latest.status === 'cancelled' ? 'CANCELLED' : 'FIX_FAILED',
              message: latest.error ? sanitizeForLog(latest.error) : latest.status,
            });
          }
          await stream.write(toSseEvent({ done: true }, { event: 'done' }));
          break;
        }

        if (elapsed % HEARTBEAT_EVERY_MS < POLL_EVERY_MS) {
          await agui.heartbeat();
          await stream.write(sseHeartbeat());
        }

        await stream.sleep(POLL_EVERY_MS);
        elapsed += POLL_EVERY_MS;
      }

      if (elapsed >= MAX_DURATION_MS) {
        await agui.failed({
          code: 'STREAM_TIMEOUT',
          message: 'Reconnect to keep watching',
          retryable: true,
        });
        await stream.write(
          toSseEvent(
            { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' },
            { event: 'error' },
          ),
        );
      }
    });
  });

  function sanitizeForLog(s: string): string {
    // sanitizeSseString is for raw `data:` frames; for embedded JSON we just
    // strip control chars so the LLM/agent can't smuggle ANSI escapes.
    return sanitizeSseString(s)
      .replace(/^data:\s?/gm, '')
      .replace(/\n+$/, '')
      .slice(0, 500);
  }
}
