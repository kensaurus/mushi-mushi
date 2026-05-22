import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts'

import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { currentRegion } from '../../_shared/region.ts';
import { getStorageAdapter, getStorageAdapterForHealthCheck, invalidateStorageCache } from '../../_shared/storage.ts';
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
import { dbError, ownedProjectIds, resolveOwnedProject } from '../shared.ts';
import { requireSuperAdmin } from '../../_shared/super-admin.ts';
import { resolveActiveEntitlement } from '../../_shared/entitlements.ts';

const SUPPORT_CATEGORIES = ['billing', 'bug', 'feature', 'other'] as const;
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

interface ContactBody {
  project_id?: string | null;
  subject?: string;
  body?: string;
  category?: string;
}

const RATE_LIMIT_PER_HOUR = 5;

export function registerAdminOpsRoutes(app: Hono<{ Variables: Variables }>): void {
  // GET /v1/admin/anti-gaming/stats — AntiGamingStatusBanner posture data.
  app.get('/v1/admin/anti-gaming/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasIngest: false,
      trackedDevices: 0,
      flaggedDevices: 0,
      crossAccountDevices: 0,
      totalReports: 0,
      eventsLast24h: 0,
      velocityEvents24h: 0,
      multiAccountEvents24h: 0,
      manualFlags24h: 0,
      lastEventAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project' | 'cross_account' | 'flagged' | 'velocity' | 'waiting' | 'clean',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await ownedProjectIds(db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    // Use the first owned project as the active context.
    const projectRes = await db
      .from('projects')
      .select('id, project_name')
      .in('id', projectIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const pid = projectRes.data?.id ?? projectIds[0]
    const projectName = projectRes.data?.project_name ?? null

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [devicesRes, events24hRes, lastEventRes, reportsRes] = await Promise.all([
      db.from('reporter_devices')
        .select('id, flagged_as_suspicious, cross_account_flagged, report_count')
        .eq('project_id', pid)
        .limit(1000),
      db.from('anti_gaming_events')
        .select('id, event_type')
        .eq('project_id', pid)
        .gte('created_at', since24h),
      db.from('anti_gaming_events')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid),
    ])

    const devices = devicesRes.data ?? []
    const events24h = events24hRes.data ?? []
    const flaggedDevices = devices.filter((d) => d.flagged_as_suspicious).length
    const crossAccountDevices = devices.filter((d) => d.cross_account_flagged).length
    const totalReports = reportsRes.count ?? 0
    const velocityEvents24h = events24h.filter((e) => e.event_type === 'velocity_anomaly').length
    const multiAccountEvents24h = events24h.filter((e) => e.event_type === 'multi_account').length
    const manualFlags24h = events24h.filter((e) => e.event_type === 'manual_flag').length
    const lastEventAt = lastEventRes.data?.created_at ?? null

    let topPriority: typeof empty.topPriority = 'clean'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (crossAccountDevices > 0) {
      topPriority = 'cross_account'
      topPriorityLabel = `${crossAccountDevices} device${crossAccountDevices === 1 ? '' : 's'} flagged for cross-account abuse — review now.`
      topPriorityTo = '/anti-gaming?filter=flagged'
    } else if (flaggedDevices > 0) {
      topPriority = 'flagged'
      topPriorityLabel = `${flaggedDevices} suspicious device${flaggedDevices === 1 ? '' : 's'} flagged — review before unflagging.`
      topPriorityTo = '/anti-gaming?filter=flagged'
    } else if (velocityEvents24h > 0) {
      topPriority = 'velocity'
      topPriorityLabel = `${velocityEvents24h} velocity anomaly${velocityEvents24h === 1 ? '' : 'ies'} in the last 24h.`
      topPriorityTo = '/anti-gaming?tab=events'
    } else if (devices.length === 0) {
      topPriority = 'waiting'
      topPriorityLabel = 'No devices tracked yet — install the SDK to begin anti-gaming monitoring.'
      topPriorityTo = '/onboarding'
    } else {
      topPriorityLabel = `${devices.length} device${devices.length === 1 ? '' : 's'} tracked — no abuse patterns detected.`
      topPriorityTo = '/anti-gaming'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName,
        projectCount: projectIds.length,
        hasIngest: totalReports > 0,
        trackedDevices: devices.length,
        flaggedDevices,
        crossAccountDevices,
        totalReports,
        eventsLast24h: events24h.length,
        velocityEvents24h,
        multiAccountEvents24h,
        manualFlags24h,
        lastEventAt,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/anti-gaming/devices', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    const flagged = c.req.query('flagged') === 'true';
    // count_only=1 powers the sidebar badge — the Layout only needs the
    // number of flagged devices, not the full row payload. Skipping the
    // 200-row select trims sidebar refresh cost from ~30 KB to a single
    // count() round-trip per project group.
    const countOnly = c.req.query('count_only') === '1';

    if (projectIds.length === 0) {
      return countOnly
        ? c.json({ ok: true, data: { count: 0 } })
        : c.json({ ok: true, data: { devices: [] } });
    }

    if (countOnly) {
      let cq = db
        .from('reporter_devices')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds);
      if (flagged) cq = cq.eq('flagged_as_suspicious', true);
      const { count, error: countErr } = await cq;
      if (countErr) return dbError(c, countErr);
      return c.json({ ok: true, data: { count: count ?? 0 } });
    }

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

  app.get('/v1/admin/notifications/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      total: 0,
      unread: 0,
      last24h: 0,
      lastNotificationAt: null as string | null,
      daysSinceLastNotification: null as number | null,
      byType: {} as Record<string, number>,
      notificationsEnabled: false,
      fixFailedCount: 0,
      topPriority: 'no_project' as
        | 'no_project'
        | 'disabled'
        | 'unread_backlog'
        | 'no_messages'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: settings }, { data: rows, error }] = await Promise.all([
      db
        .from('project_settings')
        .select('reporter_notifications_enabled')
        .eq('project_id', project.id)
        .maybeSingle(),
      db
        .from('reporter_notifications')
        .select('notification_type, read_at, created_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    if (error) return dbError(c, error);

    const list = rows ?? [];
    const byType: Record<string, number> = {};
    let unread = 0;
    let last24h = 0;
    let fixFailedCount = 0;
    for (const row of list) {
      const t = row.notification_type as string;
      byType[t] = (byType[t] ?? 0) + 1;
      if (t === 'fix_failed') fixFailedCount += 1;
      if (!row.read_at) unread += 1;
      if ((row.created_at as string) >= since24h) last24h += 1;
    }

    const lastNotificationAt = (list[0]?.created_at as string | undefined) ?? null;
    const daysSinceLastNotification = lastNotificationAt
      ? Math.floor((Date.now() - new Date(lastNotificationAt).getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const notificationsEnabled = !!(settings as { reporter_notifications_enabled?: boolean } | null)
      ?.reporter_notifications_enabled;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!notificationsEnabled) {
      topPriority = 'disabled';
      topPriorityLabel =
        'reporter_notifications_enabled is off — the SDK widget will not poll outbound messages until you turn it on in Settings.';
      topPriorityTo = '/settings';
    } else if (unread > 0) {
      topPriority = 'unread_backlog';
      topPriorityLabel = `${unread} unread message${unread === 1 ? '' : 's'} — expand payloads in Inbox to debug whether the reporter SDK stopped polling.`;
      topPriorityTo = '/notifications?tab=inbox&show=unread';
    } else if (list.length === 0) {
      topPriority = 'no_messages';
      topPriorityLabel =
        'No outbound messages yet — classify or fix a report; a message should land here when reporter_notifications_enabled is on.';
      topPriorityTo = '/notifications?tab=setup';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${list.length} total · ${last24h} in 24h · all read · last message ${daysSinceLastNotification === 0 ? 'today' : daysSinceLastNotification != null ? `${daysSinceLastNotification}d ago` : '—'}.`;
      topPriorityTo = '/notifications?tab=inbox';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: project.id as string,
        projectName: (project.name as string | null) ?? null,
        total: list.length,
        unread,
        last24h,
        lastNotificationAt,
        daysSinceLastNotification,
        byType,
        notificationsEnabled,
        fixFailedCount,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/notifications', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const type = c.req.query('type');
    const onlyUnread = c.req.query('unread') === '1';
    const countOnly = c.req.query('count_only') === '1';

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: countOnly ? { unread_count: 0 } : { notifications: [] },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    if (countOnly) {
      let countQuery = db
        .from('reporter_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id);
      if (type) countQuery = countQuery.eq('notification_type', type);
      if (onlyUnread) countQuery = countQuery.is('read_at', null);
      const { count, error } = await countQuery;
      if (error) return dbError(c, error);
      return c.json({ ok: true, data: { unread_count: count ?? 0 } });
    }

    const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);
    let query = db
      .from('reporter_notifications')
      .select('*')
      .eq('project_id', project.id)
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
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { error } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notifId)
      .eq('project_id', project.id);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  app.post('/v1/admin/notifications/read-all', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { error, count } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() }, { count: 'exact' })
      .eq('project_id', project.id)
      .is('read_at', null);
    if (error) return dbError(c, error);
    await logAudit(db, project.id, userId, 'settings.updated', 'notifications', undefined, {
      marked_read: count ?? 0,
    });
    return c.json({ ok: true, data: { marked_read: count ?? 0 } });
  });

  // ============================================================
  // SOC 2 Type 1
  // ============================================================
  app.get('/v1/admin/compliance/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const GDPR_SLA_DAYS = 30;
    const OVERDUE_THRESHOLD_DAYS = GDPR_SLA_DAYS - 9;

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      soc2Entitlement: false,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      projectCount: 0,
      controlsTotal: 0,
      controlsPass: 0,
      controlsWarn: 0,
      controlsFail: 0,
      openDsars: 0,
      overdueDsars: 0,
      atRiskDsars: 0,
      legalHoldCount: 0,
      policiesCount: 0,
      latestEvidenceAt: null as string | null,
      evidenceNeverGenerated: true,
      currentRegion: currentRegion(),
      activeProjectRegion: null as string | null,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const entitlement = await resolveActiveEntitlement(c);
    const plan = entitlement?.plan;
    const soc2Entitlement = entitlement?.hasFeature('soc2') ?? false;

    const projectIds = await ownedProjectIds(db, userId);

    const [{ data: evidenceRows }, { data: dsarRows }, { data: policyRows }, { data: residencyRow }] =
      await Promise.all([
        db
          .from('soc2_evidence')
          .select('project_id, control, status, generated_at')
          .in('project_id', projectIds)
          .order('generated_at', { ascending: false })
          .limit(500),
        db
          .from('data_subject_requests')
          .select('status, created_at')
          .in('project_id', projectIds),
        db
          .from('project_retention_policies')
          .select('project_id, legal_hold')
          .in('project_id', projectIds),
        db
          .from('projects')
          .select('data_residency_region')
          .eq('id', project.id)
          .maybeSingle(),
      ]);

    const latestByControl = new Map<string, { status: string; generated_at: string }>();
    for (const row of evidenceRows ?? []) {
      const key = `${row.project_id}:${row.control}`;
      const existing = latestByControl.get(key);
      if (!existing || existing.generated_at < row.generated_at) {
        latestByControl.set(key, {
          status: row.status as string,
          generated_at: row.generated_at as string,
        });
      }
    }

    let controlsPass = 0;
    let controlsWarn = 0;
    let controlsFail = 0;
    let latestEvidenceAt: string | null = null;
    for (const ev of latestByControl.values()) {
      if (ev.status === 'pass') controlsPass += 1;
      else if (ev.status === 'warn') controlsWarn += 1;
      else if (ev.status === 'fail') controlsFail += 1;
      if (!latestEvidenceAt || ev.generated_at > latestEvidenceAt) {
        latestEvidenceAt = ev.generated_at;
      }
    }

    const now = Date.now();
    const daysSince = (iso: string) =>
      Math.max(0, Math.floor((now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));

    let openDsars = 0;
    let overdueDsars = 0;
    let atRiskDsars = 0;
    for (const d of dsarRows ?? []) {
      const status = d.status as string;
      if (status === 'completed' || status === 'rejected') continue;
      openDsars += 1;
      const age = daysSince(d.created_at as string);
      if (age >= OVERDUE_THRESHOLD_DAYS) overdueDsars += 1;
      else if (age >= 14) atRiskDsars += 1;
    }

    const policies = policyRows ?? [];
    const legalHoldCount = policies.filter((p) => p.legal_hold).length;

    return c.json({
      ok: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        soc2Entitlement,
        planId: plan?.id ?? 'hobby',
        planDisplayName: plan?.display_name ?? 'Hobby',
        projectCount: projectIds.length,
        controlsTotal: latestByControl.size,
        controlsPass,
        controlsWarn,
        controlsFail,
        openDsars,
        overdueDsars,
        atRiskDsars,
        legalHoldCount,
        policiesCount: policies.length,
        latestEvidenceAt,
        evidenceNeverGenerated: latestByControl.size === 0,
        currentRegion: currentRegion(),
        activeProjectRegion: (residencyRow?.data_residency_region as string | null) ?? null,
      },
    });
  });

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

  app.get('/v1/admin/storage/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      projectCount: 0,
      configuredCount: 0,
      unconfiguredCount: 0,
      healthyCount: 0,
      degradedCount: 0,
      failingCount: 0,
      unknownCount: 0,
      neverProbedCount: 0,
      totalObjects: 0,
      activeProjectObjects: 0,
      activeProjectLastWrite: null as string | null,
      activeProjectHealthStatus: 'unknown' as string,
      activeProjectProvider: 'supabase' as string,
      activeProjectConfigured: false,
      lastHealthCheckAt: null as string | null,
      latestFailureError: null as string | null,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const entitlement = await resolveActiveEntitlement(c);
    const plan = entitlement?.plan;
    const projectIds = await ownedProjectIds(db, userId);

    const [{ data: settingsRows }, usageRows] = await Promise.all([
      db
        .from('project_storage_settings')
        .select(
          'project_id, provider, health_status, last_health_check_at, last_health_error',
        )
        .in('project_id', projectIds),
      Promise.all(
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
      ),
    ]);

    const settings = settingsRows ?? [];
    const settingsByProject = new Map(settings.map((s) => [s.project_id, s]));
    let healthyCount = 0;
    let degradedCount = 0;
    let failingCount = 0;
    let unknownCount = 0;
    let neverProbedCount = 0;
    for (const row of settings) {
      const status = row.health_status as string;
      if (status === 'healthy') healthyCount += 1;
      else if (status === 'degraded') degradedCount += 1;
      else if (status === 'failing') failingCount += 1;
      else unknownCount += 1;
      if (!row.last_health_check_at) neverProbedCount += 1;
    }

    const configuredCount = settings.length;
    const unconfiguredCount = Math.max(projectIds.length - configuredCount, 0);
    let totalObjects = 0;
    let activeProjectObjects = 0;
    let activeProjectLastWrite: string | null = null;
    for (const u of usageRows) {
      totalObjects += u.object_count;
      if (u.project_id === project.id) {
        activeProjectObjects = u.object_count;
        activeProjectLastWrite = u.last_write_at;
      }
    }

    const activeSetting = settingsByProject.get(project.id);
    const activeProjectConfigured = Boolean(activeSetting);
    const activeProjectHealthStatus = (activeSetting?.health_status as string) ?? 'unknown';
    const activeProjectProvider = (activeSetting?.provider as string) ?? 'supabase';

    return c.json({
      ok: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        planId: plan?.id ?? 'hobby',
        planDisplayName: plan?.display_name ?? 'Hobby',
        projectCount: projectIds.length,
        configuredCount,
        unconfiguredCount,
        healthyCount,
        degradedCount,
        failingCount,
        unknownCount,
        neverProbedCount,
        totalObjects,
        activeProjectObjects,
        activeProjectLastWrite,
        activeProjectHealthStatus,
        activeProjectProvider,
        activeProjectConfigured,
        lastHealthCheckAt: (activeSetting?.last_health_check_at as string | undefined) ?? null,
        latestFailureError: (activeSetting?.last_health_error as string | undefined) ?? null,
      },
    });
  });

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

    const tTotal = Date.now();
    const { adapter, prefixDebug } = await getStorageAdapterForHealthCheck(projectId);
    const probeResult = await adapter.healthCheck();
    const totalMs = Date.now() - tTotal;

    // Merge vault-resolution prefix steps with the adapter-level probe steps
    const fullDebug = [
      ...prefixDebug,
      ...probeResult.debug,
      { step: 'total', ok: probeResult.ok, ms: totalMs },
    ];

    await db
      .from('project_storage_settings')
      .update({
        health_status: probeResult.ok ? 'healthy' : 'failing',
        last_health_check_at: new Date().toISOString(),
        last_health_error: probeResult.ok ? null : (probeResult.error ?? null),
        last_health_debug: fullDebug,
      })
      .eq('project_id', projectId);

    // Outer `ok` reflects the probe outcome — callers check `res.ok` to know
    // whether the bucket is reachable, not just whether the HTTP request succeeded.
    return c.json(
      {
        ok: probeResult.ok,
        data: {
          healthy: probeResult.ok,
          error: probeResult.error ?? null,
          debug: fullDebug,
        },
      },
      probeResult.ok ? 200 : 424,
    );
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
    const { data: projectRef } = await db
      .from('projects')
      .select('id, organization_id')
      .eq('id', body.project_id)
      .maybeSingle();
    const organizationId = projectRef?.organization_id ?? null;

    // Refuse to push a complimentary org through Stripe Checkout — they're
    // already on a comp tier server-side, and creating a real Stripe customer
    // here would silently dual-bill them once a card is attached. The FE
    // hides the upgrade CTA for these orgs, so reaching this branch means
    // either a forged request or an out-of-date client.
    if (organizationId) {
      const { data: orgPosture } = await db
        .from('organizations')
        .select('billing_mode, plan_id')
        .eq('id', organizationId)
        .maybeSingle();
      if (orgPosture?.billing_mode === 'complimentary') {
        return c.json(
          {
            ok: false,
            error: {
              code: 'COMPLIMENTARY_ACCOUNT',
              message: `This organization is on a complimentary ${orgPosture.plan_id} plan — no checkout is needed. Contact an operator to convert it to self-serve billing.`,
            },
          },
          400,
        );
      }
    }

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

    // Guard: test-fixture IDs (cus_test_*) must never block billing for real
    // projects in production. If the row in billing_customers holds a stale
    // fixture ID (e.g. seeded by a QA script), treat it as absent so Stripe
    // creates a real customer instead of surfacing a resource_missing 400.
    const isProd = (Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('DENO_ENV') ?? 'production') === 'production';
    if (customerId && isProd && customerId.startsWith('cus_test_')) {
      log.warn('billing.stale_test_customer_id_ignored', {
        projectId: body.project_id,
        staleCustomerId: customerId,
      });
      customerId = undefined;
    }

    if (!customerId) {
      const customer = await createCustomer(cfg, {
        email: body.email,
        projectId: body.project_id,
      });
      customerId = customer.id;
      await db.from('billing_customers').upsert({
        project_id: body.project_id,
        organization_id: organizationId,
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
        organization_id: organizationId,
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

    // Short-circuit for complimentary orgs (Mushi staff / sponsored / beta):
    // they intentionally have no Stripe customer, so calling Stripe would
    // 400 with `resource_missing`. Surface a friendly note instead so the
    // BillingPage can render an "Invoices not applicable on a comp account"
    // empty state without a red error banner.
    const { data: project } = await db
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle();
    if (project?.organization_id) {
      const { data: org } = await db
        .from('organizations')
        .select('billing_mode')
        .eq('id', project.organization_id)
        .maybeSingle();
      if (org?.billing_mode === 'complimentary') {
        return c.json({
          ok: true,
          data: {
            invoices: [],
            billing_mode: 'complimentary',
            note: 'Complimentary account — invoices are not issued for this org.',
          },
        });
      }
    }

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
      // Defense in depth: if Stripe says "no such customer" the local
      // billing_customers row is stale (cleanup task lagging, manual DB edit,
      // etc.). Returning 200 + empty list is better UX than the red 502
      // banner — the user can still see their plan + usage, and the
      // upstream Sentry breadcrumb tells operators to reconcile the row.
      const message = err instanceof Error ? err.message : 'unknown';
      const isMissingCustomer =
        /resource_missing|no such customer/i.test(message);
      if (isMissingCustomer) {
        return c.json({
          ok: true,
          data: {
            invoices: [],
            note: 'Stripe does not recognise the customer record for this project. An operator needs to reconcile billing_customers.',
            stale_customer_id: customer.stripe_customer_id,
          },
        });
      }
      return c.json(
        {
          ok: false,
          error: { code: 'STRIPE_ERROR', message },
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

  // Lightweight posture for the My feedback shell — banner, KPI strip, tabs.
  app.get('/v1/admin/feedback/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      totalTickets: 0,
      activeTickets: 0,
      awaitingReply: 0,
      shippedTickets: 0,
      bugTickets: 0,
      featureTickets: 0,
      billingTickets: 0,
      resolvedTickets: 0,
      lastSubmittedAt: null as string | null,
      lastShippedAt: null as string | null,
      latestReplyAt: null as string | null,
      topTicketId: null as string | null,
      topTicketSubject: null as string | null,
      topTicketCategory: null as string | null,
      topPriority: 'first_submit' as 'reply' | 'active' | 'clear' | 'first_submit',
      topPriorityLabel: null as string | null,
    };

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const activeProject = resolvedProject.project;

    const { data, error } = await db
      .from('support_tickets')
      .select(
        'id, subject, category, status, admin_response, admin_responded_at, shipped_in_release_id, shipped_at, created_at, updated_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return dbError(c, error);

    const rows = data ?? [];
    let activeTickets = 0;
    let awaitingReply = 0;
    let shippedTickets = 0;
    let bugTickets = 0;
    let featureTickets = 0;
    let billingTickets = 0;
    let resolvedTickets = 0;
    let lastSubmittedAt: string | null = rows[0]?.created_at ?? null;
    let lastShippedAt: string | null = null;
    let latestReplyAt: string | null = null;
    let topReplyTicket: (typeof rows)[number] | null = null;

    for (const t of rows) {
      const status = String(t.status ?? '');
      const category = String(t.category ?? '');
      if (status === 'open' || status === 'in_progress') activeTickets += 1;
      if (category === 'bug') bugTickets += 1;
      else if (category === 'feature') featureTickets += 1;
      else if (category === 'billing') billingTickets += 1;
      if (status === 'resolved' || status === 'closed') resolvedTickets += 1;
      if (t.shipped_in_release_id) {
        shippedTickets += 1;
        const shippedAt = t.shipped_at ?? t.updated_at ?? t.created_at;
        if (shippedAt && (!lastShippedAt || new Date(String(shippedAt)).getTime() > new Date(lastShippedAt).getTime())) {
          lastShippedAt = String(shippedAt);
        }
      }
      const hasReply =
        (status === 'open' || status === 'in_progress') &&
        typeof t.admin_response === 'string' &&
        t.admin_response.trim().length > 0;
      if (hasReply) {
        awaitingReply += 1;
        const repliedAt = t.admin_responded_at ?? t.updated_at ?? t.created_at;
        if (
          repliedAt &&
          (!latestReplyAt || new Date(String(repliedAt)).getTime() > new Date(String(latestReplyAt)).getTime())
        ) {
          latestReplyAt = String(repliedAt);
          topReplyTicket = t;
        }
      }
    }

    let topPriority: 'reply' | 'active' | 'clear' | 'first_submit' = 'first_submit';
    let topPriorityLabel: string | null = null;
    let topTicketId: string | null = null;
    let topTicketSubject: string | null = null;
    let topTicketCategory: string | null = null;

    if (rows.length === 0) {
      topPriority = 'first_submit';
      topPriorityLabel = 'Send your first bug report or feature request';
    } else if (topReplyTicket) {
      topPriority = 'reply';
      topPriorityLabel = `Team replied on “${topReplyTicket.subject}”`;
      topTicketId = topReplyTicket.id;
      topTicketSubject = topReplyTicket.subject;
      topTicketCategory = topReplyTicket.category;
    } else if (activeTickets > 0) {
      topPriority = 'active';
      topPriorityLabel = `${activeTickets} submission${activeTickets === 1 ? '' : 's'} awaiting triage`;
      const firstActive = rows.find((t) => t.status === 'open' || t.status === 'in_progress') ?? null;
      if (firstActive) {
        topTicketId = firstActive.id;
        topTicketSubject = firstActive.subject;
        topTicketCategory = firstActive.category;
      }
    } else {
      topPriority = 'clear';
      topPriorityLabel =
        shippedTickets > 0
          ? `${shippedTickets} idea${shippedTickets === 1 ? '' : 's'} shipped in releases`
          : 'No active submissions — inbox clear';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: activeProject.id,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        totalTickets: rows.length,
        activeTickets,
        awaitingReply,
        shippedTickets,
        bugTickets,
        featureTickets,
        billingTickets,
        resolvedTickets,
        lastSubmittedAt,
        lastShippedAt,
        latestReplyAt,
        topTicketId,
        topTicketSubject,
        topTicketCategory,
        topPriority,
        topPriorityLabel,
      },
    });
  });

  // Lightweight counts for sidebar badge + dashboard strip.
  app.get('/v1/admin/support/tickets/summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data, error } = await db
      .from('support_tickets')
      .select('status, admin_response, shipped_in_release_id')
      .eq('user_id', userId);
    if (error) return dbError(c, error);
    const rows = data ?? [];
    const active = rows.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
    const withReply = rows.filter(
      (t) =>
        (t.status === 'open' || t.status === 'in_progress') &&
        typeof t.admin_response === 'string' &&
        t.admin_response.trim().length > 0,
    ).length;
    const shipped = rows.filter((t) => t.shipped_in_release_id != null).length;
    return c.json({
      ok: true,
      data: { total: rows.length, active, with_reply: withReply, shipped },
    });
  });

  // Tickets eligible to credit in a release draft (project-scoped).
  app.get('/v1/admin/projects/:projectId/support-tickets/linkable', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('projectId');
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED' } }, 400);
    }
    const db = getServiceClient();
    const owned = await ownedProjectIds(db, userId);
    if (!owned.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '50')));
    const { data, error } = await db
      .from('support_tickets')
      .select('id, subject, category, status, user_email, created_at, shipped_in_release_id')
      .eq('project_id', projectId)
      .in('category', ['bug', 'feature'])
      .neq('status', 'cancelled')
      .is('shipped_in_release_id', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { tickets: data ?? [] } });
  });

  // List the caller's own tickets (across all projects they own). Used by
  // the BillingPage history section so paid users can see which questions
  // are still open. We include `body` and `admin_response` here (small
  // strings) so the detail modal opens without a second round trip — the
  // list is capped at 50 rows so the payload stays bounded.
  app.get('/v1/admin/support/tickets', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? '20')));
    const category = (c.req.query('category') ?? '').trim();
    const shippedOnly = c.req.query('shipped') === '1';

    let query = db
      .from('support_tickets')
      .select(
        'id, project_id, subject, body, category, status, plan_id, admin_response, admin_responded_at, created_at, updated_at, resolved_at, cancelled_at, shipped_in_release_id, shipped_at, shipped_note, release:releases!support_tickets_shipped_in_release_id_fkey(id, version, title, status, published_at)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (SUPPORT_CATEGORIES.includes(category as SupportCategory)) {
      query = query.eq('category', category);
    }
    if (shippedOnly) {
      query = query.not('shipped_in_release_id', 'is', null);
    }

    const { data, error } = await query;

    if (error) {
      return dbError(c, error);
    }
    return c.json({ ok: true, data: { tickets: data ?? [] } });
  });

  // Detail fetch — used as a defensive fallback if a ticket id is opened
  // from a deep link or arrives via a future realtime payload that didn't
  // include `body`/`admin_response`. Same auth model as the list (caller
  // must own the ticket).
  app.get('/v1/admin/support/tickets/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const ticketId = c.req.param('id');
    if (!ticketId) {
      return c.json({ ok: false, error: { code: 'TICKET_ID_REQUIRED' } }, 400);
    }
    // Guard against non-UUID path segments (e.g. "summary") bleeding in from
    // a route-precedence mismatch between /summary and /:id in production.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(ticketId)) {
      return c.json({ ok: false, error: { code: 'INVALID_TICKET_ID' } }, 400);
    }
    const db = getServiceClient();
    const { data, error } = await db
      .from('support_tickets')
      .select(
        'id, project_id, user_id, subject, body, category, status, plan_id, admin_response, admin_responded_at, created_at, updated_at, resolved_at, cancelled_at, shipped_in_release_id, shipped_at, shipped_note, release:releases!support_tickets_shipped_in_release_id_fkey(id, version, title, status, published_at)',
      )
      .eq('id', ticketId)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    if (data.user_id !== userId) {
      // Don't leak existence — return 404 for "not yours" so a brute-force
      // probe can't enumerate ticket ids belonging to other tenants.
      return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ ok: true, data: { ticket: data } });
  });

  // Customer-side cancel. Allowed only while the ticket is still actionable
  // (open / in_progress). Once the operator has resolved or closed it the
  // record is read-only — flipping a "resolved" ticket back to "cancelled"
  // would falsify the history view used for SLA reporting.
  app.post('/v1/admin/support/tickets/:id/cancel', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const ticketId = c.req.param('id');
    if (!ticketId) {
      return c.json({ ok: false, error: { code: 'TICKET_ID_REQUIRED' } }, 400);
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(ticketId)) {
      return c.json({ ok: false, error: { code: 'INVALID_TICKET_ID' } }, 400);
    }
    const db = getServiceClient();

    const { data: ticket, error: readErr } = await db
      .from('support_tickets')
      .select('id, user_id, project_id, status, subject')
      .eq('id', ticketId)
      .maybeSingle();
    if (readErr) return dbError(c, readErr);
    if (!ticket || ticket.user_id !== userId) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    }

    if (ticket.status === 'cancelled') {
      // Idempotent — return success so a double-click doesn't surface as
      // a confusing error.
      return c.json({ ok: true, data: { ticket_id: ticket.id, status: 'cancelled' } });
    }
    if (ticket.status !== 'open' && ticket.status !== 'in_progress') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'TICKET_NOT_CANCELLABLE',
            message: `Tickets in '${ticket.status}' state can no longer be cancelled.`,
          },
        },
        409,
      );
    }

    const { error: updateErr } = await db
      .from('support_tickets')
      .update({ status: 'cancelled' })
      .eq('id', ticket.id);
    if (updateErr) return dbError(c, updateErr);

    if (ticket.project_id) {
      await logAudit(
        db,
        ticket.project_id,
        userId,
        'support.ticket_cancelled',
        'support_ticket',
        ticket.id,
        { subject: ticket.subject },
      );
    }

    return c.json({ ok: true, data: { ticket_id: ticket.id, status: 'cancelled' } });
  });

  // Operator triage — link ticket to a published release + optional customer note.
  app.patch('/v1/super-admin/support/tickets/:id', jwtAuth, requireSuperAdmin, async (c) => {
    const ticketId = c.req.param('id');
    if (!ticketId) {
      return c.json({ ok: false, error: { code: 'TICKET_ID_REQUIRED' } }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as {
      status?: string;
      admin_response?: string;
      shipped_in_release_id?: string | null;
      shipped_note?: string | null;
      operator_notes?: string;
    } | null;
    if (!body) return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400);

    const db = getServiceClient();
    const patch: Record<string, unknown> = {};

    const allowedStatuses = ['open', 'in_progress', 'resolved', 'closed', 'cancelled'];
    if (body.status && allowedStatuses.includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.admin_response === 'string') {
      patch.admin_response = body.admin_response.trim() || null;
      patch.admin_responded_at = new Date().toISOString();
    }
    if (typeof body.operator_notes === 'string') {
      patch.operator_notes = body.operator_notes.trim() || null;
    }
    if (body.shipped_note !== undefined) {
      patch.shipped_note = body.shipped_note?.trim() || null;
    }

    if (body.shipped_in_release_id !== undefined) {
      if (body.shipped_in_release_id === null) {
        patch.shipped_in_release_id = null;
        patch.shipped_at = null;
      } else {
        const { data: release } = await db
          .from('releases')
          .select('id, status, published_at')
          .eq('id', body.shipped_in_release_id)
          .maybeSingle();
        if (!release) {
          return c.json({ ok: false, error: { code: 'RELEASE_NOT_FOUND' } }, 404);
        }
        if (release.status !== 'published') {
          return c.json(
            {
              ok: false,
              error: {
                code: 'RELEASE_NOT_PUBLISHED',
                message: 'Only published releases can be linked to shipped tickets.',
              },
            },
            409,
          );
        }
        patch.shipped_in_release_id = release.id;
        patch.shipped_at = release.published_at ?? new Date().toISOString();
        if (!patch.status) {
          patch.status = 'resolved';
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ ok: false, error: { code: 'NO_CHANGES' } }, 400);
    }

    const { data, error } = await db
      .from('support_tickets')
      .update(patch)
      .eq('id', ticketId)
      .select(
        'id, status, admin_response, admin_responded_at, shipped_in_release_id, shipped_at, shipped_note',
      )
      .maybeSingle();

    if (error) return dbError(c, error);
    if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    return c.json({ ok: true, data: { ticket: data } });
  });
}
