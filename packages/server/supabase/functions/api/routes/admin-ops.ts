import type { Hono } from 'npm:hono@4';

import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { currentRegion } from '../../_shared/region.ts';
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { logAntiGamingEvent } from '../../_shared/telemetry.ts';
import {
  createBillingPortalSession,
  createCheckoutSession,
  createCustomer,
  listInvoices,
  stripeFromEnv,
  type CheckoutLineItem,
} from '../../_shared/stripe.ts';
import { getPlan } from '../../_shared/plans.ts';
import { notifyOperator } from '../../_shared/operator-notify.ts';
import { SUPPORT_EMAIL, SUPPORT_URL } from '../../_shared/support.ts';
import { dbError, ownedProjectIds } from '../shared.ts';

const SUPPORT_CATEGORIES = ['billing', 'bug', 'feature', 'other'] as const;
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

interface ContactBody {
  project_id?: string | null;
  subject?: string;
  body?: string;
  category?: string;
}

const RATE_LIMIT_PER_HOUR = 5;

export function registerAdminOpsRoutes(app: Hono): void {
  app.get('/v1/admin/anti-gaming/devices', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { devices: [] } });

    const flagged = c.req.query('flagged') === 'true';
    let q = db
      .from('reporter_devices')
      .select('*')
      .in('project_id', projectIds)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (flagged) q = q.eq('flagged_as_suspicious', true);
    const { data, error } = await q;
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { devices: data ?? [] } });
  });

  app.get('/v1/admin/anti-gaming/events', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { events: [] } });

    const eventType = c.req.query('event_type');
    const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);

    let query = db
      .from('anti_gaming_events')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (eventType) query = query.eq('event_type', eventType);

    const { data, error } = await query;
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { events: data ?? [] } });
  });

  app.post('/v1/admin/anti-gaming/devices/:id/flag', jwtAuth, async (c) => {
    const id = c.req.param('id');
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const reason = (body.reason as string | undefined)?.trim() ?? 'Manual flag from admin console';
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404);

    const { data: device, error: fetchErr } = await db
      .from('reporter_devices')
      .select('project_id, device_fingerprint, reporter_tokens')
      .eq('id', id)
      .in('project_id', projectIds)
      .single();
    if (fetchErr || !device)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404);

    const { error } = await db
      .from('reporter_devices')
      .update({ flagged_as_suspicious: true, flag_reason: reason })
      .eq('id', id);
    if (error) return dbError(c, error);

    await logAntiGamingEvent(db, {
      projectId: device.project_id,
      reporterTokenHash: device.reporter_tokens?.[0] ?? 'unknown',
      deviceFingerprint: device.device_fingerprint,
      eventType: 'manual_flag',
      reason,
    });
    return c.json({ ok: true, data: { id, flagged: true } });
  });

  app.post('/v1/admin/anti-gaming/devices/:id/unflag', jwtAuth, async (c) => {
    const id = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404);

    const { data: device, error: fetchErr } = await db
      .from('reporter_devices')
      .select('project_id, device_fingerprint, reporter_tokens')
      .eq('id', id)
      .in('project_id', projectIds)
      .single();
    if (fetchErr || !device)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404);

    const { error } = await db
      .from('reporter_devices')
      .update({ flagged_as_suspicious: false, flag_reason: null, cross_account_flagged: false })
      .eq('id', id);
    if (error) return dbError(c, error);

    await logAntiGamingEvent(db, {
      projectId: device.project_id,
      reporterTokenHash: device.reporter_tokens?.[0] ?? 'unknown',
      deviceFingerprint: device.device_fingerprint,
      eventType: 'unflag',
      reason: 'Manual unflag from admin console',
    });
    return c.json({ ok: true, data: { id, unflagged: true } });
  });

  app.get('/v1/admin/notifications', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { notifications: [] } });

    const type = c.req.query('type');
    const onlyUnread = c.req.query('unread') === '1';
    const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);

    let query = db
      .from('reporter_notifications')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (type) query = query.eq('notification_type', type);
    if (onlyUnread) query = query.is('read_at', null);

    const { data, error } = await query;
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { notifications: data ?? [] } });
  });

  app.post('/v1/admin/notifications/:id/read', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const notifId = c.req.param('id');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No projects' } }, 404);

    const { error } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notifId)
      .in('project_id', projectIds);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  app.post('/v1/admin/notifications/read-all', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No projects' } }, 404);

    const { error, count } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() }, { count: 'exact' })
      .in('project_id', projectIds)
      .is('read_at', null);
    if (error) return dbError(c, error);
    await logAudit(db, projectIds[0], userId, 'settings.updated', 'notifications', undefined, {
      marked_read: count ?? 0,
    });
    return c.json({ ok: true, data: { marked_read: count ?? 0 } });
  });

  // ============================================================
  // SOC 2 Type 1
  // ============================================================
  app.get('/v1/admin/compliance/retention', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { policies: [] } });

    const { data, error } = await db
      .from('project_retention_policies')
      .select('*')
      .in('project_id', projectIds);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { policies: data ?? [] } });
  });

  app.put('/v1/admin/compliance/retention/:projectId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('projectId');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const updates: Record<string, unknown> = { project_id: projectId };
    for (const k of [
      'reports_retention_days',
      'audit_retention_days',
      'llm_traces_retention_days',
      'byok_audit_retention_days',
      'legal_hold',
      'legal_hold_reason',
    ]) {
      if (k in body) updates[k] = body[k];
    }

    const { error } = await db
      .from('project_retention_policies')
      .upsert(updates, { onConflict: 'project_id' });
    if (error) return dbError(c, error);
    await logAudit(
      db,
      projectId,
      userId,
      'compliance.retention.updated',
      'project_retention_policies',
      projectId,
      updates,
    ).catch(() => {});
    return c.json({ ok: true });
  });

  // ----------------------------------------------------------------
  // /v1/admin/retention-status — "when does the next sweep run, and
  // what would it delete from my projects right now?"
  //
  // Why this exists: the daily retention-sweep edge function actually
  // honors `pricing_plans.retention_days` (M2 from the QA report).
  // Customers need a self-service way to see (a) the resolved window
  // per project, (b) the last successful sweep time, (c) a preview
  // of how many `reports` rows are currently older than their cutoff.
  // The Billing/Settings page renders this so the SOC 2 reviewer or
  // a compliance auditor can confirm "yes, my 90-day plan is being
  // enforced".
  //
  // Read shape:
  //   {
  //     projects: [{
  //       project_id, retention_days, plan_id, source: 'override'|'plan'|'fallback',
  //       legal_hold, expired_count, oldest_at, last_swept_at, last_deleted_count
  //     }],
  //     next_sweep_at: ISO timestamp,
  //     last_run: { started_at, finished_at, status, rows_affected } | null,
  //   }
  // ----------------------------------------------------------------
  app.get('/v1/admin/retention-status', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { projects: [], next_sweep_at: null, last_run: null } });
    }

    const [{ data: policies }, { data: subs }, { data: plansList }, { data: lastRun }] =
      await Promise.all([
        db
          .from('project_retention_policies')
          .select('project_id, reports_retention_days, legal_hold, legal_hold_reason')
          .in('project_id', projectIds),
        db
          .from('billing_subscriptions')
          .select('project_id, status, plan_id, current_period_end')
          .in('project_id', projectIds)
          .in('status', ['active', 'trialing', 'past_due']),
        db.from('pricing_plans').select('id, display_name, retention_days'),
        db
          .from('cron_runs')
          .select('id, started_at, finished_at, status, rows_affected, metadata')
          .eq('job_name', 'retention-sweep')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const planById = new Map<
      string,
      { id: string; display_name: string; retention_days: number }
    >();
    for (const p of plansList ?? []) {
      planById.set(p.id, p as { id: string; display_name: string; retention_days: number });
    }
    const policyByProject = new Map<
      string,
      { reports_retention_days: number; legal_hold: boolean }
    >();
    for (const r of policies ?? []) {
      policyByProject.set(r.project_id, {
        reports_retention_days: r.reports_retention_days,
        legal_hold: r.legal_hold,
      });
    }
    const subByProject = new Map<string, { plan_id: string | null }>();
    for (const s of subs ?? []) {
      if (!subByProject.has(s.project_id)) {
        subByProject.set(s.project_id, { plan_id: s.plan_id });
      }
    }

    const HOBBY_FALLBACK_DAYS = planById.get('hobby')?.retention_days ?? 7;

    const now = Date.now();
    const result = await Promise.all(
      projectIds.map(async (pid) => {
        const policy = policyByProject.get(pid);
        const sub = subByProject.get(pid);
        const plan = planById.get(sub?.plan_id ?? 'hobby');

        let retention_days = HOBBY_FALLBACK_DAYS;
        let plan_id: string = 'hobby';
        let source: 'override' | 'plan' | 'fallback' = 'fallback';
        const legal_hold = policy?.legal_hold === true;

        if (legal_hold) {
          retention_days = policy!.reports_retention_days ?? HOBBY_FALLBACK_DAYS;
          plan_id = 'legal_hold';
          source = 'override';
        } else if (policy && policy.reports_retention_days) {
          retention_days = policy.reports_retention_days;
          plan_id = 'override';
          source = 'override';
        } else if (sub && plan) {
          retention_days = plan.retention_days ?? HOBBY_FALLBACK_DAYS;
          plan_id = plan.id;
          source = 'plan';
        }

        const cutoffIso = new Date(now - retention_days * 24 * 60 * 60 * 1000).toISOString();

        const [{ count: expiredCount }, { data: oldestRow }, { data: lastSweep }] =
          await Promise.all([
            db
              .from('reports')
              .select('id', { count: 'exact', head: true })
              .eq('project_id', pid)
              .lt('created_at', cutoffIso),
            db
              .from('reports')
              .select('created_at')
              .eq('project_id', pid)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle(),
            db
              .from('audit_logs')
              .select('created_at, metadata')
              .eq('project_id', pid)
              .eq('action', 'retention.sweep')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        const lastSweepMeta = (lastSweep?.metadata ?? null) as Record<string, unknown> | null;

        return {
          project_id: pid,
          retention_days,
          plan_id,
          source,
          legal_hold,
          expired_count: expiredCount ?? 0,
          oldest_at: oldestRow?.created_at ?? null,
          last_swept_at: lastSweep?.created_at ?? null,
          last_deleted_count:
            typeof lastSweepMeta?.deleted_count === 'number'
              ? (lastSweepMeta.deleted_count as number)
              : null,
        };
      }),
    );

    // Cron runs daily at 03:00 UTC — compute the next firing in absolute time
    // so the Billing UI can render "next sweep in 3h 12m" without doing the
    // cron math client-side.
    const next = new Date();
    next.setUTCHours(3, 0, 0, 0);
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);

    return c.json({
      ok: true,
      data: {
        projects: result,
        next_sweep_at: next.toISOString(),
        last_run: lastRun ?? null,
      },
    });
  });

  app.get('/v1/admin/compliance/dsars', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { requests: [] } });

    const { data, error } = await db
      .from('data_subject_requests')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { requests: data ?? [] } });
  });

  app.post('/v1/admin/compliance/dsars', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const body = await c.req.json().catch(() => ({}));
    const projectId = body.projectId as string | undefined;
    const requestType = body.request_type as string | undefined;
    const subjectEmail = body.subject_email as string | undefined;
    if (!projectId || !requestType || !subjectEmail) {
      return c.json(
        {
          ok: false,
          error: { code: 'VALIDATION', message: 'projectId, request_type, subject_email required' },
        },
        400,
      );
    }
    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } }, 403);
    }
    const { data, error } = await db
      .from('data_subject_requests')
      .insert({
        project_id: projectId,
        request_type: requestType,
        subject_email: subjectEmail,
        subject_id: body.subject_id ?? null,
        notes: body.notes ?? null,
      })
      .select('*')
      .single();
    if (error) return dbError(c, error);
    await logAudit(
      db,
      projectId,
      userId,
      'compliance.dsar.created',
      'data_subject_requests',
      data.id,
      { request_type: requestType, subject_email: subjectEmail },
    ).catch(() => {});
    return c.json({ ok: true, data: { request: data } });
  });

  app.patch('/v1/admin/compliance/dsars/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No projects' } }, 403);

    const body = await c.req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    for (const k of ['status', 'rejection_reason', 'evidence_url', 'notes']) {
      if (k in body) updates[k] = body[k];
    }
    if (body.status === 'completed') updates.fulfilled_at = new Date().toISOString();
    if (body.status === 'completed') updates.fulfilled_by = userId;

    const { data: updated, error } = await db
      .from('data_subject_requests')
      .update(updates)
      .eq('id', id)
      .in('project_id', projectIds)
      .select('project_id')
      .single();
    if (error) return dbError(c, error);
    if (updated?.project_id) {
      await logAudit(
        db,
        updated.project_id,
        userId,
        'compliance.dsar.updated',
        'data_subject_requests',
        id,
        updates,
      ).catch(() => {});
    }
    return c.json({ ok: true });
  });

  app.get('/v1/admin/compliance/evidence', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { evidence: [] } });

    const { data, error } = await db
      .from('soc2_evidence')
      .select('*')
      .in('project_id', projectIds)
      .order('generated_at', { ascending: false })
      .limit(500);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { evidence: data ?? [] } });
  });

  app.post('/v1/admin/compliance/evidence/refresh', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No projects' } }, 403);

    const fnUrl =
      (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '') + '/functions/v1/soc2-evidence';
    try {
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      const txt = await res.text();
      if (!res.ok) {
        return c.json(
          { ok: false, error: { code: 'EDGE_FUNCTION_ERROR', message: txt.slice(0, 200) } },
          502,
        );
      }
      await logAudit(
        db,
        projectIds[0],
        userId,
        'compliance.soc2.evidence_refreshed',
        'soc2_evidence',
        undefined,
        { project_count: projectIds.length },
      ).catch(() => {});
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: { code: 'NETWORK_ERROR', message: (err as Error).message } },
        500,
      );
    }
  });

  // ============================================================
  // C7: Data residency admin endpoints
  // ============================================================

  // List residency-pinned regions for the caller's projects.
  app.get('/v1/admin/residency', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      // Keep both shapes for backward-compat with any client that read the
      // top-level fields, plus the canonical `data` envelope apiFetch expects.
      return c.json({
        ok: true,
        projects: [],
        currentRegion: currentRegion(),
        data: { projects: [], currentRegion: currentRegion() },
      });
    }

    const { data, error } = await db
      .from('projects')
      .select('id, name, slug, data_residency_region, created_at')
      .in('id', projectIds);

    if (error) return dbError(c, error);
    return c.json({
      ok: true,
      projects: data ?? [],
      currentRegion: currentRegion(),
      data: { projects: data ?? [], currentRegion: currentRegion() },
    });
  });

  // Pin a project to a specific region. Pinning is one-way at runtime — flipping
  // regions on a project that already has data requires an export+restore on the
  // destination cluster (handled out-of-band by the support team for now).
  app.put('/v1/admin/residency/:projectId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('projectId');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const region = body.region as string | undefined;
    if (!region || !['us', 'eu', 'jp', 'self'].includes(region)) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_REGION', message: 'region must be one of us | eu | jp | self' },
        },
        400,
      );
    }

    // Refuse to repin a project that already lives elsewhere — would silently
    // orphan data. Surfaces a 409 so the UI can route the customer to support.
    const { data: existing } = await db
      .from('projects')
      .select('data_residency_region')
      .eq('id', projectId)
      .maybeSingle();
    if (existing?.data_residency_region && existing.data_residency_region !== region) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'REGION_LOCKED',
            message: `Project is pinned to ${existing.data_residency_region}. Contact support to migrate data between regions.`,
          },
        },
        409,
      );
    }

    const { error } = await db
      .from('projects')
      .update({ data_residency_region: region })
      .eq('id', projectId);
    if (error) return dbError(c, error);

    await logAudit(db, projectId, userId, 'settings.updated', 'project_residency', projectId, {
      region,
      previous: existing?.data_residency_region ?? null,
    }).catch(() => {});

    return c.json({ ok: true, region });
  });

  // ============================================================
  // C8: BYO Storage admin endpoints
  // ============================================================

  app.get('/v1/admin/storage', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      // Keep both shapes for backward-compat: top-level `settings` for any old
      // client, and the canonical `data` envelope that apiFetch expects.
      return c.json({ ok: true, settings: [], data: { settings: [], usage: [] } });
    }
    const { data, error } = await db
      .from('project_storage_settings')
      .select('*')
      .in('project_id', projectIds);
    if (error) return dbError(c, error);
    return c.json({ ok: true, settings: data ?? [], data: { settings: data ?? [] } });
  });

  // Per-project storage usage rollup Counts uploaded
  // artefacts (reports.screenshot_path IS NOT NULL is the only artefact kind we
  // track today) and the last write timestamp. Object-bytes is intentionally
  // omitted until we land a `screenshot_size_bytes` column — counting objects is
  // already enough to spot runaway buckets and stale projects.
  app.get('/v1/admin/storage/usage', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { usage: [] } });

    const usage = await Promise.all(
      projectIds.map(async (pid) => {
        const [{ count }, { data: latest }] = await Promise.all([
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', pid)
            .not('screenshot_path', 'is', null),
          db
            .from('reports')
            .select('created_at')
            .eq('project_id', pid)
            .not('screenshot_path', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return {
          project_id: pid,
          object_count: count ?? 0,
          last_write_at: latest?.created_at ?? null,
        };
      }),
    );

    return c.json({ ok: true, data: { usage } });
  });

  app.put('/v1/admin/storage/:projectId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('projectId');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.includes(projectId))
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const body = await c.req.json().catch(() => ({}));

    const allowed = [
      'provider',
      'bucket',
      'region',
      'endpoint',
      'path_prefix',
      'signed_url_ttl_secs',
      'use_signed_urls',
      'access_key_vault_ref',
      'secret_key_vault_ref',
      'service_account_vault_ref',
      'kms_key_id',
      'encryption_required',
    ];
    const patch: Record<string, unknown> = { project_id: projectId };
    for (const k of allowed) if (k in body) patch[k] = body[k];

    const { error } = await db
      .from('project_storage_settings')
      .upsert(patch, { onConflict: 'project_id' });
    if (error) return dbError(c, error);

    invalidateStorageCache(projectId);

    await logAudit(db, projectId, userId, 'settings.updated', 'storage_settings', projectId, {
      provider: patch.provider,
    }).catch(() => {});

    return c.json({ ok: true });
  });

  app.post('/v1/admin/storage/:projectId/health', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('projectId');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.includes(projectId))
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    invalidateStorageCache(projectId);
    const adapter = await getStorageAdapter(projectId);
    const result = await adapter.healthCheck();
    await db
      .from('project_storage_settings')
      .update({
        health_status: result.ok ? 'healthy' : 'failing',
        last_health_check_at: new Date().toISOString(),
        last_health_error: result.ok ? null : (result.error ?? null),
      })
      .eq('project_id', projectId);

    return c.json({ ok: true, health: result });
  });

  // ----------------------------------------------------------------
  // D5: Cloud billing endpoints
  //   * GET    /v1/admin/billing             — current customer + subscription state
  //                                             (defined earlier — aggregate per-owner)
  //   * POST   /v1/admin/billing/checkout    — create Stripe Checkout Session, return URL
  //   * POST   /v1/admin/billing/portal      — create Billing Portal session, return URL
  //   * GET    /v1/admin/billing/invoices    — list recent invoices for a project
  // All require JWT auth + project ownership.
  // ----------------------------------------------------------------
  app.post('/v1/admin/billing/checkout', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => null)) as {
      project_id?: string;
      email?: string;
      /** 'starter' | 'pro' — defaults to 'starter' so legacy clients still work. */
      plan_id?: string;
    } | null;
    if (!body?.project_id || !body?.email) {
      return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 400);
    }
    const db = getServiceClient();
    const owned = await ownedProjectIds(db, userId);
    if (!owned.includes(body.project_id))
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const cfg = stripeFromEnv();
    if (!cfg.secretKey) {
      return c.json({ ok: false, error: { code: 'STRIPE_NOT_CONFIGURED' } }, 503);
    }

    const planId = body.plan_id ?? 'starter';
    const plan = await getPlan(planId);
    if (plan.id === 'hobby') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PLAN_NOT_PURCHASABLE',
            message: 'Hobby is the default free tier — no checkout needed.',
          },
        },
        400,
      );
    }
    if (!plan.is_self_serve) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PLAN_SALES_LED',
            message: `${plan.display_name} requires contacting sales.`,
          },
        },
        400,
      );
    }
    if (!plan.base_price_lookup_key) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PLAN_NOT_CONFIGURED',
            message: `Plan ${plan.id} has no base_price_lookup_key — run scripts/stripe-bootstrap.mjs.`,
          },
        },
        503,
      );
    }

    // Resolve Stripe price IDs from env (set by stripe-bootstrap.mjs). We don't
    // hit Stripe's /prices/search on every request — env is faster and means
    // we fail closed if bootstrap hasn't been run.
    const priceMap: Record<string, { base?: string; overage?: string }> = {
      starter: {
        base: Deno.env.get('STRIPE_PRICE_STARTER_BASE') ?? cfg.defaultPriceId,
        overage: Deno.env.get('STRIPE_PRICE_STARTER_OVERAGE'),
      },
      pro: {
        base: Deno.env.get('STRIPE_PRICE_PRO_BASE'),
        overage: Deno.env.get('STRIPE_PRICE_PRO_OVERAGE'),
      },
    };
    const prices = priceMap[plan.id] ?? {};
    if (!prices.base) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PLAN_NOT_CONFIGURED',
            message: `Set STRIPE_PRICE_${plan.id.toUpperCase()}_BASE.`,
          },
        },
        503,
      );
    }

    const lineItems: CheckoutLineItem[] = [{ price: prices.base, quantity: 1 }];
    if (prices.overage) lineItems.push({ price: prices.overage });

    const { data: existing } = await db
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('project_id', body.project_id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id;
    if (!customerId) {
      const customer = await createCustomer(cfg, {
        email: body.email,
        projectId: body.project_id,
      });
      customerId = customer.id;
      await db.from('billing_customers').upsert({
        project_id: body.project_id,
        stripe_customer_id: customerId,
        email: body.email,
        default_payment_ok: false,
      });
    }

    const session = await createCheckoutSession(cfg, {
      customer: customerId,
      projectId: body.project_id,
      planId: plan.id,
      lineItems,
    });

    await logAudit(
      db,
      body.project_id,
      userId,
      'billing.checkout_started',
      'project',
      body.project_id,
      {
        stripe_customer_id: customerId,
        session_id: session.id,
        plan_id: plan.id,
        line_items: lineItems.length,
      },
    );

    // Wrap in `data` to match the admin-API envelope all other admin routes
    // use (`{ ok, data }`). The frontend reads `res.data.url`; returning `url`
    // at the top level previously caused the BillingPage checkout button to
    // silently no-op. .
    return c.json({ ok: true, data: { url: session.url, plan_id: plan.id } });
  });

  app.post('/v1/admin/billing/portal', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => null)) as { project_id?: string } | null;
    if (!body?.project_id) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 400);
    const db = getServiceClient();
    const owned = await ownedProjectIds(db, userId);
    if (!owned.includes(body.project_id))
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const { data: customer } = await db
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('project_id', body.project_id)
      .maybeSingle();
    if (!customer?.stripe_customer_id) {
      return c.json({ ok: false, error: { code: 'NO_STRIPE_CUSTOMER' } }, 404);
    }

    const cfg = stripeFromEnv();
    const session = await createBillingPortalSession(cfg, customer.stripe_customer_id);
    // Wrap in `data` for envelope parity. .
    return c.json({ ok: true, data: { url: session.url } });
  });

  // List Stripe invoices for a project. Wraps Stripe's /v1/invoices and
  // returns the trimmed view the UI needs (number, status, amount, links).
  // Returns an empty array — never an error — when Stripe isn't configured
  // or the project hasn't started billing yet, so the UI can render gracefully.
  app.get('/v1/admin/billing/invoices', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.query('project_id');
    if (!projectId) return c.json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED' } }, 400);
    const db = getServiceClient();
    const owned = await ownedProjectIds(db, userId);
    if (!owned.includes(projectId)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const { data: customer } = await db
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('project_id', projectId)
      .maybeSingle();
    if (!customer?.stripe_customer_id) {
      return c.json({ ok: true, data: { invoices: [] } });
    }

    const cfg = stripeFromEnv();
    if (!cfg.secretKey) {
      return c.json({ ok: true, data: { invoices: [] } });
    }

    try {
      const result = await listInvoices(cfg, customer.stripe_customer_id, 20);
      return c.json({ ok: true, data: { invoices: result.data } });
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: { code: 'STRIPE_ERROR', message: err instanceof Error ? err.message : 'unknown' },
        },
        502,
      );
    }
  });

  // ============================================================
  // Support inbox
  //
  // Goals:
  //   - Give paid customers a one-click "Talk to a human" channel from the
  //     admin console — no third-party support tool to integrate yet.
  //   - Operator gets a Slack/Discord push within seconds.
  //   - Searchable history per project (the audit log + `support_tickets`).
  //   - Cheap abuse defence: max 5 tickets/hour/user.
  //
  // Why a single payload-light endpoint vs an inbox UI? You ship faster, the
  // operator learns more from the first 10 customer conversations, and
  // adding categorised triage later (priority, owner, SLA) is one PR away.
  // ============================================================

  // Public-ish lookup: surface the support address so the marketing /admin
  // surfaces don't hardcode it. Auth-gated so we don't leak the SUPPORT_EMAIL
  // override that self-hosters set to a private inbox.
  app.get('/v1/admin/support/info', jwtAuth, (c) => {
    return c.json({
      ok: true,
      data: {
        email: SUPPORT_EMAIL,
        url: SUPPORT_URL,
        // Indicates whether operator notifications are wired up. Self-hosters
        // who haven't set the webhook see a "delivered to email only" hint
        // in the UI instead of an unconditional "we'll Slack you" promise.
        operator_notifications_enabled: Boolean(
          Deno.env.get('OPERATOR_SLACK_WEBHOOK_URL') ??
          Deno.env.get('OPERATOR_DISCORD_WEBHOOK_URL'),
        ),
      },
    });
  });

  app.post('/v1/support/contact', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const userEmail = (c.get('userEmail') as string | undefined) ?? '';
    if (!userEmail) {
      return c.json({ ok: false, error: { code: 'EMAIL_REQUIRED' } }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as ContactBody | null;
    if (!body) return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400);

    const subject = (body.subject ?? '').trim();
    const message = (body.body ?? '').trim();
    if (subject.length < 3 || subject.length > 200) {
      return c.json(
        { ok: false, error: { code: 'BAD_SUBJECT', message: 'Subject must be 3-200 chars.' } },
        400,
      );
    }
    if (message.length < 10 || message.length > 5000) {
      return c.json(
        { ok: false, error: { code: 'BAD_BODY', message: 'Body must be 10-5000 chars.' } },
        400,
      );
    }
    const category: SupportCategory = SUPPORT_CATEGORIES.includes(body.category as SupportCategory)
      ? (body.category as SupportCategory)
      : 'other';

    const db = getServiceClient();

    // Project ownership check (when project_id is supplied).
    let projectName: string | null = null;
    let planId: string | null = null;
    if (body.project_id) {
      const owned = await ownedProjectIds(db, userId);
      if (!owned.includes(body.project_id)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      const { data: project } = await db
        .from('projects')
        .select('name')
        .eq('id', body.project_id)
        .maybeSingle();
      projectName = project?.name ?? null;

      const { data: sub } = await db
        .from('billing_subscriptions')
        .select('plan_id, status')
        .eq('project_id', body.project_id)
        .maybeSingle();
      if (sub?.status === 'active' || sub?.status === 'trialing' || sub?.status === 'past_due') {
        planId = sub.plan_id ?? null;
      }
    }

    // Cheap rate limit. Counts COMPLETED inserts in the last 60 minutes.
    // Race-prone (two concurrent submits could both pass) but the worst case
    // is one extra ticket — acceptable for now.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Limit is ${RATE_LIMIT_PER_HOUR} tickets/hour. Email ${SUPPORT_EMAIL} for urgent issues.`,
          },
        },
        429,
      );
    }

    const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = c.req.header('user-agent')?.slice(0, 500) ?? null;

    const { data: ticket, error: insertErr } = await db
      .from('support_tickets')
      .insert({
        project_id: body.project_id ?? null,
        user_id: userId,
        user_email: userEmail,
        subject,
        body: message,
        category,
        plan_id: planId,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select('id, created_at')
      .single();

    if (insertErr || !ticket) {
      log.error('support_ticket_insert_failed', { err: insertErr?.message });
      return dbError(c, insertErr ?? { message: 'support_ticket_insert_failed' });
    }

    // audit_logs is per-project (FK). Tickets without a project are still
    // captured in `support_tickets` itself — no need to fabricate a
    // placeholder project_id just to satisfy the audit row.
    if (body.project_id) {
      await logAudit(
        db,
        body.project_id,
        userId,
        'support.ticket_created',
        'support_ticket',
        ticket.id,
        {
          category,
          plan_id: planId,
          subject,
        },
        { email: userEmail, ip: ipAddress ?? undefined, userAgent: userAgent ?? undefined },
      );
    }

    // Best-effort operator notification. We DO await it (rather than fire-
    // and-forget) so we can stamp `notified_at` to support a backfill cron
    // for self-hosters who set the webhook later.
    const sentCount = await notifyOperator({
      title: planId ? `Paid customer support ticket (${planId})` : 'Support ticket',
      body: `*${subject}*\n\n${message.slice(0, 800)}${message.length > 800 ? '\n…[truncated]' : ''}`,
      level: planId ? 'urgent' : 'warn',
      fields: [
        { label: 'From', value: userEmail },
        { label: 'Category', value: category },
        {
          label: 'Project',
          value: projectName ?? (body.project_id ? body.project_id.slice(0, 8) : 'no project'),
        },
        { label: 'Plan', value: planId ?? 'free' },
      ],
      footer: `ticket: ${ticket.id}`,
    });
    if (sentCount > 0) {
      await db
        .from('support_tickets')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', ticket.id);
    }

    return c.json({
      ok: true,
      data: {
        ticket_id: ticket.id,
        created_at: ticket.created_at,
        delivered_to_operator: sentCount > 0,
        support_email: SUPPORT_EMAIL,
      },
    });
  });

  // List the caller's own tickets (across all projects they own). Used by
  // the BillingPage history section so paid users can see which questions
  // are still open.
  app.get('/v1/admin/support/tickets', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? '20')));

    const { data, error } = await db
      .from('support_tickets')
      .select(
        'id, project_id, subject, category, status, plan_id, created_at, updated_at, resolved_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return dbError(c, error);
    }
    return c.json({ ok: true, data: { tickets: data ?? [] } });
  });
}
