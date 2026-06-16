import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { dbError, callerProjectIds } from '../shared.ts';
import { ingestReport, triggerClassification } from '../helpers.ts';

export function registerQueueRoutes(app: Hono<{ Variables: Variables }>): void {
  // DLQ admin endpoints

  // GET /v1/admin/queue/stats — QueueStatusBanner posture data.
  app.get('/v1/admin/queue/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      deadLetter: 0,
      reportsQueued: 0,
      strandedReports: 0,
      oldestPendingMinutes: null as number | null,
      topStage: null as string | null,
      topStageDeadLetter: 0,
      todayCreated: 0,
      todayCompleted: 0,
      todayFailed: 0,
      topPriority: 'no_project' as
        | 'no_project' | 'dead_letter' | 'failed' | 'circuit_breaker' | 'stalled' | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    const projectRes = await db
      .from('projects')
      .select('id, project_name')
      .in('id', projectIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const pid = projectRes.data?.id ?? projectIds[0]
    const projectName = projectRes.data?.project_name ?? null

    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [queueRes, reportsQueuedRes] = await Promise.all([
      db.from('process_queue')
        .select('id, status, stage, created_at, started_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(500),
      db.from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .eq('status', 'queued'),
    ])

    const items = queueRes.data ?? []
    const pending = items.filter((i) => i.status === 'pending').length
    const running = items.filter((i) => i.status === 'running').length
    const completed = items.filter((i) => i.status === 'completed').length
    const failed = items.filter((i) => i.status === 'failed').length
    const deadLetter = items.filter((i) => i.status === 'dead_letter').length
    const reportsQueued = reportsQueuedRes.count ?? 0

    const todayItems = items.filter((i) => i.created_at >= todayStart.toISOString())
    const todayCreated = todayItems.length
    const todayCompleted = todayItems.filter((i) => i.status === 'completed').length
    const todayFailed = todayItems.filter((i) => i.status === 'failed').length

    const oldestPendingItem = items.filter((i) => i.status === 'pending').at(-1)
    const oldestPendingMinutes = oldestPendingItem
      ? Math.floor((Date.now() - new Date(oldestPendingItem.created_at).getTime()) / 60000)
      : null

    const stageCounts = new Map<string, number>()
    for (const i of items.filter((it) => it.status === 'dead_letter')) {
      const s = i.stage ?? 'unknown'
      stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1)
    }
    const topEntry = [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]

    let topPriority: typeof empty.topPriority = 'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (deadLetter > 0) {
      topPriority = 'dead_letter'
      topPriorityLabel = `${deadLetter} dead-letter job${deadLetter === 1 ? '' : 's'} — inspect and republish.`
      topPriorityTo = '/queue?status=dead_letter'
    } else if (failed > 0) {
      topPriority = 'failed'
      topPriorityLabel = `${failed} job${failed === 1 ? '' : 's'} failed — retry or quarantine.`
      topPriorityTo = '/queue?status=failed'
    } else if (reportsQueued > 0) {
      topPriority = 'circuit_breaker'
      topPriorityLabel = `${reportsQueued} report${reportsQueued === 1 ? '' : 's'} queued behind circuit breaker — flush when ready.`
      topPriorityTo = '/queue'
    } else if (oldestPendingMinutes !== null && oldestPendingMinutes > 15) {
      topPriority = 'stalled'
      topPriorityLabel = `Oldest pending job is ${oldestPendingMinutes}m old — possible stall.`
      topPriorityTo = '/queue?status=pending'
    } else {
      topPriorityLabel = `${running} running · ${pending} pending — pipeline nominal.`
      topPriorityTo = '/queue'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName,
        projectCount: projectIds.length,
        pending,
        running,
        completed,
        failed,
        deadLetter,
        reportsQueued,
        strandedReports: 0,
        oldestPendingMinutes,
        topStage: topEntry?.[0] ?? null,
        topStageDeadLetter: topEntry?.[1] ?? 0,
        todayCreated,
        todayCompleted,
        todayFailed,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/queue', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 50 } });
    }

    const status = c.req.query('status') ?? 'dead_letter';
    const stage = c.req.query('stage');
    const page = Math.max(1, Number(c.req.query('page') ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(c.req.query('pageSize') ?? 25)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db
      .from('processing_queue')
      .select('*, reports(description, user_category, created_at)', { count: 'exact' })
      .in('project_id', projectIds)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (stage) query = query.eq('stage', stage);

    const { data: items, count } = await query;
    return c.json({
      ok: true,
      data: { items: items ?? [], total: count ?? 0, page, pageSize },
    });
  });

  // Counts per stage/status so the queue page can show "where is the
  // backlog" at a glance without paginating through everything.
  app.get('/v1/admin/queue/summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { byStatus: {}, byStage: {}, stages: [] } });
    }
    const { data } = await db
      .from('processing_queue')
      .select('stage, status')
      .in('project_id', projectIds)
      .limit(5000);
    const byStatus: Record<string, number> = {};
    const byStage: Record<string, Record<string, number>> = {};
    for (const r of data ?? []) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byStage[r.stage] ??= {};
      byStage[r.stage][r.status] = (byStage[r.stage][r.status] ?? 0) + 1;
    }
    return c.json({
      ok: true,
      data: { byStatus, byStage, stages: Object.keys(byStage).sort() },
    });
  });

  // 14-day daily throughput across all stages — Pending/Completed/Failed.
  // Drives the sparkline at the top of the queue page.
  app.get('/v1/admin/queue/throughput', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { days: [] } });
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const { data } = await db
      .from('processing_queue')
      .select('status, created_at, completed_at')
      .in('project_id', projectIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(5000);
    const days: { day: string; created: number; completed: number; failed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push({ day: d.toISOString().slice(0, 10), created: 0, completed: 0, failed: 0 });
    }
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const r of data ?? []) {
      const k = String(r.created_at).slice(0, 10);
      const bucket = byDay.get(k);
      if (!bucket) continue;
      bucket.created++;
      if (r.status === 'completed') bucket.completed++;
      if (r.status === 'failed' || r.status === 'dead_letter') bucket.failed++;
    }
    return c.json({ ok: true, data: { days } });
  });

  app.post('/v1/admin/queue/:id/retry', jwtAuth, async (c) => {
    const queueId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);

    const { data: item } = await db
      .from('processing_queue')
      .select(
        'id, report_id, project_id, stage, status, attempts, max_attempts, last_error, scheduled_at, started_at, completed_at, created_at',
      )
      .eq('id', queueId)
      .in('project_id', projectIds)
      .single();

    if (!item)
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Queue item not found' } },
        404,
      );

    await db
      .from('processing_queue')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null,
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', queueId);

    triggerClassification(item.report_id, item.project_id);
    return c.json({ ok: true });
  });

  // v2.2: bulk flush for circuit-breaker queued reports.
  // When `checkCircuitBreaker` trips, ingestReport sets `reports.status='queued'`
  // and skips the per-report fast-filter invoke. Once the breaker clears, those
  // reports stay queued until manually rerun. This endpoint replays them in a
  // single click. Bounded at 50/call to avoid runaway invocations.
  app.post('/v1/admin/queue/flush-queued', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { flushed: 0, scanned: 0 } });
    }

    const { data: queued, error } = await db
      .from('reports')
      .select('id, project_id')
      .in('project_id', projectIds)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      return dbError(c, error);
    }

    const items = queued ?? [];
    for (const r of items) {
      await db.from('reports').update({ status: 'new' }).eq('id', r.id);
      triggerClassification(r.id, r.project_id);
    }

    for (const projectId of [...new Set(items.map((i) => i.project_id))]) {
      await logAudit(db, projectId, userId, 'settings.updated', 'queue', undefined, {
        kind: 'flush_queued',
        flushed: items.filter((i) => i.project_id === projectId).length,
      }).catch(() => {});
    }

    return c.json({ ok: true, data: { flushed: items.length, scanned: items.length } });
  });

  // Pipeline recovery: broader scope than flush-queued. Re-fires fast-filter
  // for `status IN ('new','queued')` reports older than 5min that never got
  // past stage1, plus pending queue items past their SLA, plus failed queue
  // items with attempts left. Mirrors what the `mushi-pipeline-recovery-5m`
  // pg_cron does, but scoped to the requesting admin's projects.
  app.post('/v1/admin/queue/recover', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { reports: 0, queue: 0, reconciled: 0 } });
    }

    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: stranded } = await db
      .from('reports')
      .select('id, project_id, status')
      .in('project_id', projectIds)
      .in('status', ['new', 'queued'])
      .lt('created_at', cutoff)
      .lt('processing_attempts', 3)
      .order('created_at', { ascending: true })
      .limit(50);

    const items = stranded ?? [];
    for (const r of items) {
      if (r.status === 'queued') {
        await db.from('reports').update({ status: 'new' }).eq('id', r.id);
      }
      triggerClassification(r.id, r.project_id);
    }

    const { data: failed } = await db
      .from('processing_queue')
      .select('id, report_id, project_id, attempts, max_attempts')
      .in('project_id', projectIds)
      .eq('status', 'failed')
      .order('created_at', { ascending: true })
      .limit(50);

    const retryable = (failed ?? []).filter((f) => (f.attempts ?? 0) < (f.max_attempts ?? 3));
    for (const q of retryable) {
      await db
        .from('processing_queue')
        .update({
          status: 'pending',
          scheduled_at: new Date().toISOString(),
        })
        .eq('id', q.id);
      triggerClassification(q.report_id, q.project_id);
    }

    const { data: stale } = await db
      .from('processing_queue')
      .select('id, reports!inner(status)')
      .in('project_id', projectIds)
      .eq('status', 'pending')
      .in('reports.status', ['classified', 'dispatched', 'completed'])
      .limit(100);

    const reconcileIds = (stale ?? []).map((s) => s.id);
    if (reconcileIds.length > 0) {
      await db
        .from('processing_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .in('id', reconcileIds);
    }

    for (const projectId of [...new Set(items.map((i) => i.project_id))]) {
      await logAudit(db, projectId, userId, 'settings.updated', 'queue', undefined, {
        kind: 'recover_stranded',
        reports: items.filter((i) => i.project_id === projectId).length,
        queue: retryable.length,
      }).catch(() => {});
    }

    return c.json({
      ok: true,
      data: {
        reports: items.length,
        queue: retryable.length,
        reconciled: reconcileIds.length,
      },
    });
  });

}
