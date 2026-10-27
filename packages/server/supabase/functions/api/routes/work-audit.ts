/**
 * FILE: packages/server/supabase/functions/api/routes/work-audit.ts
 * PURPOSE: The database side of the local worker's `audit` mode (ADR 0050),
 *          called from api/routes/work.ts (served by `api-ext`): the hourly
 *          audit cap, and filing one reproduced finding as a `code_audit`
 *          report, deduped race-proof by code_audit_keys, inside
 *          FILED_REPORTS_PER_HOUR and the plan quota. The rules (screen,
 *          dedupe key, report text) are in _shared/work-modes.ts.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { checkIngestQuota } from '../../_shared/quota.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { FILE_REPORT_RATE_SCOPE, FILED_REPORTS_PER_HOUR } from '../../_shared/report-file.ts'
import { enqueueReports } from '../../_shared/work-claims.ts'
import type { ModeLane } from '../../_shared/work-conflicts.ts'
import { AUDIT_FINDINGS_PER_HOUR, auditFindingRefusal, auditKey, auditKeyBlocks, auditReportText, type AuditFinding } from '../../_shared/work-modes.ts'

type Db = ReturnType<typeof getServiceClient>

const mlog = log.child('work-audit')

/** Code-audit findings this app filed in the last hour. `null` on a failed read. */
export async function auditFiledLastHour(db: Db, projectId: string, now: Date): Promise<number | null> {
  const { count, error } = await db
    .from('code_audit_keys')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('filed_at', new Date(now.getTime() - 3_600_000).toISOString())
  if (error) {
    mlog.warn('audit cap unreadable', { projectId, err: error.message })
    return null
  }
  return count ?? 0
}

export type FileFindingResult =
  | { ok: true; reportId: string; queuedLaneId: string | null }
  | { ok: false; code: 'REFUSED' | 'DUPLICATE' | 'AUDIT_CAP' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'DB_ERROR'; message: string; status: 409 | 422 | 429 | 402 | 503 | 500; reportId?: string }

/**
 * File one reproduced finding. In order, so a refused finding spends nothing:
 * the safety screen, the dedupe key (an open or dismissed report with the
 * same file + rule + evidence is never filed again), the audit's own hourly
 * cap, the app's FILED_REPORTS_PER_HOUR (shared with people), the plan quota;
 * then the key row (its unique constraint settles a race), the report, triage,
 * and the queue of a fix lane on the same machine for this app, when there is one.
 */
export async function fileAuditFinding(
  db: Db,
  f: AuditFinding,
  ctx: { lane: ModeLane; ownerUserId: string; now: Date },
): Promise<FileFindingResult> {
  const refusal = auditFindingRefusal(f)
  if (refusal) return { ok: false, code: 'REFUSED', message: refusal, status: 422 }
  const projectId = ctx.lane.project_id
  const key = await auditKey(f)

  const { data: existing, error: exErr } = await db.from('code_audit_keys').select('id, report_id').eq('project_id', projectId).eq('audit_key', key).maybeSingle()
  if (exErr) return { ok: false, code: 'DB_ERROR', message: 'Could not read earlier findings. Try again in a minute.', status: 503 }
  const prior = existing as { id: string; report_id: string | null } | null
  if (prior?.report_id) {
    const { data: rep, error: repErr } = await db.from('reports').select('status').eq('id', prior.report_id).maybeSingle()
    if (repErr) return { ok: false, code: 'DB_ERROR', message: 'Could not read the earlier report. Try again in a minute.', status: 503 }
    const status = (rep as { status?: string } | null)?.status ?? null
    if (auditKeyBlocks(status)) return { ok: false, code: 'DUPLICATE', message: `Already filed as report ${prior.report_id} (${status}).`, status: 409, reportId: prior.report_id }
  }

  const filed = await auditFiledLastHour(db, projectId, ctx.now)
  if (filed === null) return { ok: false, code: 'DB_ERROR', message: 'Could not read the audit\'s hourly count. Try again in a minute.', status: 503 }
  if (filed >= AUDIT_FINDINGS_PER_HOUR) return { ok: false, code: 'AUDIT_CAP', message: `This app already filed ${AUDIT_FINDINGS_PER_HOUR} code-audit findings in the last hour.`, status: 429 }

  const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: projectId,
    p_scope: FILE_REPORT_RATE_SCOPE,
    p_max_per_window: FILED_REPORTS_PER_HOUR,
    p_window: '1 hour',
  })
  if (rateErr) {
    const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
    return limited
      ? { ok: false, code: 'RATE_LIMITED', message: `This app already had ${FILED_REPORTS_PER_HOUR} reports filed in the last hour.`, status: 429 }
      : { ok: false, code: 'DB_ERROR', message: 'The finding was not filed. Retry in a moment.', status: 503 }
  }
  const quota = await checkIngestQuota(db, projectId)
  if (!quota.allowed) return { ok: false, code: 'QUOTA_EXCEEDED', message: `${quota.plan.display_name} plan quota of reports this month is used up.`, status: 402 }

  const nowIso = ctx.now.toISOString()
  // Take the key first: of two workers filing the same finding, one wins here.
  let keyId: string
  if (prior) {
    const q = db.from('code_audit_keys').update({ filed_at: nowIso, line: f.line, lane_id: ctx.lane.id }).eq('id', prior.id)
    const { data: took } = await (prior.report_id ? q.eq('report_id', prior.report_id) : q.is('report_id', null)).select('id')
    if (!took || (took as unknown[]).length === 0) return { ok: false, code: 'DUPLICATE', message: 'Another worker filed this finding a moment ago.', status: 409 }
    keyId = prior.id
  } else {
    const { data: ins, error: insErr } = await db
      .from('code_audit_keys')
      .insert({ project_id: projectId, audit_key: key, file: f.file, rule: f.rule, line: f.line, lane_id: ctx.lane.id, filed_at: nowIso })
      .select('id')
      .single()
    if (insErr?.code === '23505') return { ok: false, code: 'DUPLICATE', message: 'Another worker filed this finding a moment ago.', status: 409 }
    if (insErr || !ins) return { ok: false, code: 'DB_ERROR', message: 'The finding could not be recorded.', status: 500 }
    keyId = (ins as { id: string }).id
  }

  const reportId = crypto.randomUUID()
  const text = auditReportText(f, { laneName: ctx.lane.name })
  const { error: repErr } = await db.from('reports').insert({
    id: reportId,
    project_id: projectId,
    title: text.title,
    description: text.description,
    category: 'bug',
    user_category: 'bug',
    severity: f.severity,
    component: text.component,
    environment: { platform: 'code_audit' },
    custom_metadata: { source: 'code_audit', audit_key: key, file: f.file, line: f.line, rule: f.rule, check: f.check.kind, lane: ctx.lane.name },
    status: 'new',
    source: 'code_audit',
    reporter_token_hash: 'code-audit',
    reporter_user_id: ctx.ownerUserId,
    synced_at: nowIso,
    created_at: nowIso,
  })
  if (repErr) {
    // Give the key back, so the next pass can file it.
    await (prior ? db.from('code_audit_keys').update({ filed_at: new Date(0).toISOString() }).eq('id', keyId) : db.from('code_audit_keys').delete().eq('id', keyId))
    mlog.error('code audit report not stored', { projectId, err: repErr.message })
    return { ok: false, code: 'DB_ERROR', message: 'The report could not be stored.', status: 500 }
  }
  await db.from('code_audit_keys').update({ report_id: reportId }).eq('id', keyId)
  await queueReportClassification(db, reportId, projectId)
  await db.from('usage_events').insert({ project_id: projectId, event_name: 'reports_ingested', quantity: 1, metadata: { report_id: reportId, source: 'code_audit' } }).then(({ error }) => {
    if (error) mlog.warn('usage event insert failed', { reportId, err: error.message })
  })

  // Straight into a fix lane on the same machine for this app, when there is one.
  let queuedLaneId: string | null = null
  const { data: fixLanes } = await db.from('work_lanes').select('id, name').eq('host_id', ctx.lane.host_id).eq('project_id', projectId).eq('mode', 'fix').order('name', { ascending: true }).limit(1)
  const target = ((fixLanes ?? []) as Array<{ id: string }>)[0]
  if (target) {
    const q = await enqueueReports(db, { id: target.id, projectId, hostId: ctx.lane.host_id }, [reportId], { source: 'report_file', now: ctx.now })
    if ('error' in q) mlog.warn('audit finding not queued for its fix lane', { reportId, err: q.error })
    else queuedLaneId = target.id
  }
  return { ok: true, reportId, queuedLaneId }
}
