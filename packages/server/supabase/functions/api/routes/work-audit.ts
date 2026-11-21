/**
 * FILE: packages/server/supabase/functions/api/routes/work-audit.ts
 * PURPOSE: The database side of the local worker's `audit` mode (ADR 0050,
 *          ADR 0063), called from api/routes/work.ts (served by `api-ext`):
 *          the hourly audit cap, the app's open cap, and filing one reproduced
 *          finding. A finding is, in order: an exact replay (code_audit_keys),
 *          a new screen for an open report with the same pattern key (added to
 *          its affected_screens), a regression of a fixed one (reopened), a
 *          wait in code_audit_deferred when the app is at its open cap, or a
 *          new `code_audit` report inside FILED_REPORTS_PER_HOUR and the plan
 *          quota. The rules (screen, keys, report text) are in
 *          _shared/work-modes.ts and _shared/audit-taxonomy.ts.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { postTeamNote } from '../../_shared/reporter-comms.ts'
import { checkIngestQuota } from '../../_shared/quota.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { FILE_REPORT_RATE_SCOPE, FILED_REPORTS_PER_HOUR } from '../../_shared/report-file.ts'
import { enqueueReports } from '../../_shared/work-claims.ts'
import type { ModeLane } from '../../_shared/work-conflicts.ts'
import { auditCategory, auditPatternKey } from '../../_shared/audit-taxonomy.ts'
import {
  appendAffectedScreen,
  AUDIT_FINDINGS_PER_HOUR,
  auditConfidenceRefusal,
  auditFindingRefusal,
  auditFindingScore,
  auditKey,
  auditKeyBlocks,
  auditReportText,
  CODE_AUDIT_OPEN_STATUSES,
  codeAuditOpenCap,
  DEFERRED_OVER_CAP,
  type AuditFinding,
} from '../../_shared/work-modes.ts'

type Db = ReturnType<typeof getServiceClient>

const mlog = log.child('work-audit')

/** Code-audit findings this app filed in the last hour. `null` on a failed read. */
export async function auditFiledLastHour(db: Db, projectId: string, now: Date): Promise<number | null> {
  const { count, error } = await db
    .from('code_audit_keys')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('merged', false)
    .gte('filed_at', new Date(now.getTime() - 3_600_000).toISOString())
  if (error) {
    mlog.warn('audit cap unreadable', { projectId, err: error.message })
    return null
  }
  return count ?? 0
}

/**
 * The app's open cap and how many code-audit pattern parents are open now
 * (ADR 0063). `null` on a failed read.
 */
export async function codeAuditBacklog(db: Db, projectId: string): Promise<{ open: number; cap: number } | null> {
  const [settings, open] = await Promise.all([
    db.from('project_settings').select('code_audit_open_cap').eq('project_id', projectId).maybeSingle(),
    db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('source', 'code_audit').is('parent_report_id', null).in('status', [...CODE_AUDIT_OPEN_STATUSES]),
  ])
  if (open.error) {
    mlog.warn('code-audit backlog unreadable', { projectId, err: open.error.message })
    return null
  }
  return { open: open.count ?? 0, cap: codeAuditOpenCap((settings.data as { code_audit_open_cap?: unknown } | null)?.code_audit_open_cap) }
}

/**
 * Keep a finding in code_audit_deferred (one row per app and pattern; a second
 * sighting counts). The finding a `--apply-cap` row holds keeps its report id,
 * so a recheck that finds it gone can close that report too.
 */
async function deferFinding(
  db: Db,
  a: { projectId: string; patternKey: string; key: string; f: AuditFinding; laneId: string | null; nowIso: string },
): Promise<FileFindingResult> {
  const { data: waiting } = await db.from('code_audit_deferred').select('id, seen_count, finding').eq('project_id', a.projectId).eq('pattern_key', a.patternKey).maybeSingle()
  const w = waiting as { id: string; seen_count: number; finding?: Record<string, unknown> | null } | null
  const keep = w?.finding?.collapse_report_id ? { collapse_report_id: w.finding.collapse_report_id, collapse_tag: w.finding.collapse_tag } : {}
  const row = { finding: { ...(a.f as unknown as Record<string, unknown>), ...keep }, audit_key: a.key, score: auditFindingScore(a.f), lane_id: a.laneId, updated_at: a.nowIso }
  const { error: defErr } = w
    ? await db.from('code_audit_deferred').update({ ...row, seen_count: (w.seen_count || 1) + 1 }).eq('id', w.id)
    : await db.from('code_audit_deferred').insert({ project_id: a.projectId, pattern_key: a.patternKey, ...row })
  if (defErr && defErr.code !== '23505') return { ok: false, code: 'DB_ERROR', message: 'The finding could not be set aside.', status: 500 }
  return { ok: true, outcome: 'deferred', reportId: null, queuedLaneId: null }
}

/** What filing a finding did: a new report, a screen added to an open one, a fixed one reopened, or a wait for an open slot. */
export type FileFindingOutcome = 'filed' | 'merged' | 'regressed' | 'restored' | 'deferred'

export type FileFindingResult =
  | { ok: true; outcome: Exclude<FileFindingOutcome, 'deferred'>; reportId: string; queuedLaneId: string | null }
  | { ok: true; outcome: 'deferred'; reportId: null; queuedLaneId: null }
  | { ok: false; code: 'REFUSED' | 'DUPLICATE' | 'AUDIT_CAP' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'DB_ERROR'; message: string; status: 409 | 422 | 429 | 402 | 503 | 500; reportId?: string }

/**
 * File one reproduced finding. In order, so a refused finding spends nothing:
 * the safety screen and the confidence floor; the exact key (an open or
 * dismissed report with the same file + rule + evidence is never filed
 * again); the pattern key (category + root, ADR 0063): an open report with it
 * gains this screen, a fixed one is reopened as a regression; the app's open
 * cap (over it the finding waits in code_audit_deferred); the audit's own
 * hourly cap, the app's FILED_REPORTS_PER_HOUR (shared with people), the plan
 * quota; then the key row (its unique constraint settles a race), the report,
 * triage, and the queue of a fix lane on the same machine for this app.
 */
export async function fileAuditFinding(
  db: Db,
  f: AuditFinding,
  ctx: { lane: ModeLane; ownerUserId: string; now: Date },
): Promise<FileFindingResult> {
  const refusal = auditFindingRefusal(f) ?? auditConfidenceRefusal(f)
  if (refusal) return { ok: false, code: 'REFUSED', message: refusal, status: 422 }
  const projectId = ctx.lane.project_id
  const key = await auditKey(f)
  const category = auditCategory({ rule: f.rule, title: f.title, userImpact: f.userImpact })
  const patternKey = auditPatternKey(category, f.rootFile, f.rule)
  const nowIso = ctx.now.toISOString()
  const screen = { screen: f.screen, file: f.file, line: f.line, title: f.title, at: nowIso }

  const { data: existing, error: exErr } = await db.from('code_audit_keys').select('id, report_id').eq('project_id', projectId).eq('audit_key', key).maybeSingle()
  if (exErr) return { ok: false, code: 'DB_ERROR', message: 'Could not read earlier findings. Try again in a minute.', status: 503 }
  const prior = existing as { id: string; report_id: string | null } | null
  if (prior?.report_id) {
    const { data: rep, error: repErr } = await db.from('reports').select('status, closed_reason').eq('id', prior.report_id).maybeSingle()
    if (repErr) return { ok: false, code: 'DB_ERROR', message: 'Could not read the earlier report. Try again in a minute.', status: 503 }
    const status = (rep as { status?: string } | null)?.status ?? null
    if (auditKeyBlocks(status, (rep as { closed_reason?: string | null } | null)?.closed_reason ?? null)) return { ok: false, code: 'DUPLICATE', message: `Already filed as report ${prior.report_id} (${status}).`, status: 409, reportId: prior.report_id }
  }

  // The newest report with this pattern: open → one more screen; fixed → a regression (Sentry's model).
  const { data: patRows, error: patErr } = await db
    .from('reports')
    .select('id, status, closed_reason, affected_screens, custom_metadata')
    .eq('project_id', projectId)
    .eq('source', 'code_audit')
    .eq('pattern_key', patternKey)
    .is('parent_report_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (patErr) return { ok: false, code: 'DB_ERROR', message: 'Could not read open findings. Try again in a minute.', status: 503 }
  const parent = ((patRows ?? []) as Array<{ id: string; status: string; closed_reason?: string | null; affected_screens: unknown; custom_metadata: Record<string, unknown> | null }>)[0]
  // Set aside over the open cap (`--apply-cap`): restored when a slot is free, otherwise it keeps waiting.
  if (parent?.status === 'dismissed' && parent.closed_reason === DEFERRED_OVER_CAP) {
    const backlog = await codeAuditBacklog(db, projectId)
    if (!backlog) return { ok: false, code: 'DB_ERROR', message: 'Could not read the open code-audit count. Try again in a minute.', status: 503 }
    if (backlog.open >= backlog.cap) return await deferFinding(db, { projectId, patternKey, key, f, laneId: ctx.lane.id, nowIso })
    const meta = parent.custom_metadata ?? {}
    const cap = (meta.cap ?? {}) as { from_status?: string; tag?: string }
    const back = cap.from_status && (CODE_AUDIT_OPEN_STATUSES as readonly string[]).includes(cap.from_status) && cap.from_status !== 'fixing' ? cap.from_status : 'classified'
    const rest: Record<string, unknown> = { ...meta }
    delete rest.cap
    const { data: moved } = await db
      .from('reports')
      .update({
        status: back,
        closed_reason: null,
        affected_screens: appendAffectedScreen(parent.affected_screens, screen),
        custom_metadata: { ...rest, occurrences: (Number(meta.occurrences) || 1) + 1, cap_restored: { at: nowIso, tag: cap.tag ?? null, lane: ctx.lane.name } },
        updated_at: nowIso,
      })
      .eq('id', parent.id)
      .eq('status', 'dismissed')
      .select('id')
    if (!moved || (moved as unknown[]).length === 0) return { ok: false, code: 'DUPLICATE', message: 'That report changed a moment ago; the next pass files this again.', status: 409 }
    await db.from('code_audit_deferred').delete().eq('project_id', projectId).eq('pattern_key', patternKey)
    return { ok: true, outcome: 'restored', reportId: parent.id, queuedLaneId: null }
  }
  const parentOpen = !!parent && (CODE_AUDIT_OPEN_STATUSES as readonly string[]).includes(parent.status)
  const parentFixed = !!parent && ['fixed', 'verified', 'resolved'].includes(parent.status)
  // A person dismissed this pattern (false alarm, won't fix…): it stays dismissed, like an ignored Sentry issue.
  if (parent?.status === 'dismissed') return { ok: false, code: 'DUPLICATE', message: `This pattern was dismissed as report ${parent.id}.`, status: 409, reportId: parent.id }
  if (parent && (parentOpen || parentFixed)) {
    const meta = parent.custom_metadata ?? {}
    const patch: Record<string, unknown> = {
      affected_screens: appendAffectedScreen(parent.affected_screens, screen),
      custom_metadata: {
        ...meta,
        occurrences: (Number(meta.occurrences) || 1) + 1,
        ...(parentFixed ? { regressed: { at: nowIso, from_status: parent.status, file: f.file, line: f.line, lane: ctx.lane.name } } : {}),
      },
      updated_at: nowIso,
      ...(parentFixed ? { status: 'reopened' } : {}),
    }
    const { data: moved, error: upErr } = await db.from('reports').update(patch).eq('id', parent.id).eq('status', parent.status).select('id')
    if (upErr) return { ok: false, code: 'DB_ERROR', message: 'The open report could not take this screen.', status: 500 }
    if (!moved || (moved as unknown[]).length === 0) return { ok: false, code: 'DUPLICATE', message: 'That report changed a moment ago; the next pass files this again.', status: 409 }
    // The key, so an exact replay is a duplicate; `merged` keeps it out of the hourly cap.
    const keyRow = { report_id: parent.id, pattern_key: patternKey, merged: true, filed_at: nowIso, line: f.line, lane_id: ctx.lane.id }
    const { error: keyErr } = prior
      ? await db.from('code_audit_keys').update(keyRow).eq('id', prior.id)
      : await db.from('code_audit_keys').insert({ project_id: projectId, audit_key: key, file: f.file, rule: f.rule, ...keyRow })
    if (keyErr && keyErr.code !== '23505') mlog.warn('audit key not stored for a merged finding', { projectId, err: keyErr.message })
    return { ok: true, outcome: parentFixed ? 'regressed' : 'merged', reportId: parent.id, queuedLaneId: null }
  }

  // At the open cap the finding waits outside every count; the best of them is filed when a slot frees.
  const backlog = await codeAuditBacklog(db, projectId)
  if (!backlog) return { ok: false, code: 'DB_ERROR', message: 'Could not read the open code-audit count. Try again in a minute.', status: 503 }
  if (backlog.open >= backlog.cap) return await deferFinding(db, { projectId, patternKey, key, f, laneId: ctx.lane.id, nowIso })

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

  // Take the key first: of two workers filing the same finding, one wins here.
  let keyId: string
  if (prior) {
    const q = db.from('code_audit_keys').update({ filed_at: nowIso, line: f.line, lane_id: ctx.lane.id, pattern_key: patternKey, merged: false }).eq('id', prior.id)
    const { data: took } = await (prior.report_id ? q.eq('report_id', prior.report_id) : q.is('report_id', null)).select('id')
    if (!took || (took as unknown[]).length === 0) return { ok: false, code: 'DUPLICATE', message: 'Another worker filed this finding a moment ago.', status: 409 }
    keyId = prior.id
  } else {
    const { data: ins, error: insErr } = await db
      .from('code_audit_keys')
      .insert({ project_id: projectId, audit_key: key, file: f.file, rule: f.rule, line: f.line, lane_id: ctx.lane.id, filed_at: nowIso, pattern_key: patternKey, merged: false })
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
    custom_metadata: { source: 'code_audit', audit_key: key, file: f.file, line: f.line, rule: f.rule, check: f.check.kind, lane: ctx.lane.name, category, root: f.rootFile, pattern_key: patternKey, confidence: f.confidence, occurrences: 1 },
    pattern_key: patternKey,
    affected_screens: [screen],
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
    // reports_code_audit_open_pattern_uniq: another worker opened this pattern a moment ago; the next pass adds the screen.
    if (repErr.code === '23505') return { ok: false, code: 'DUPLICATE', message: 'Another worker filed this pattern a moment ago.', status: 409 }
    mlog.error('code audit report not stored', { projectId, err: repErr.message })
    return { ok: false, code: 'DB_ERROR', message: 'The report could not be stored.', status: 500 }
  }
  await db.from('code_audit_keys').update({ report_id: reportId }).eq('id', keyId)
  // Filed: it no longer waits.
  await db.from('code_audit_deferred').delete().eq('project_id', projectId).eq('pattern_key', patternKey)
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
  return { ok: true, outcome: 'filed', reportId, queuedLaneId }
}

// ── The audit lane's recheck sweep (ADR 0063) ──────────────────────────────

/** Statuses a recheck may close: open ones, never one a person closed or one in fixing with a live PR. */
const RECHECK_CLOSES = ['new', 'classified', 'grouped', 'triaged', 'reopened'] as const
/** A report whose fix was rejected this many times stays with a person; a recheck no longer queues it. */
export const FIX_REJECTED_REQUEUE_LIMIT = 2
const RECHECK_MAX_ROWS = 2000

export interface RecheckRow {
  id: string
  status: string
  severity: string | null
  title: string | null
  description: string | null
  created_at: string
  custom_metadata: Record<string, unknown> | null
  pattern_key: string | null
}

/**
 * What an audit lane rechecks: every open code-audit report of its app (a fix
 * in flight is left alone), and the best deferred findings that fit the free
 * open slots. `null` on a failed read.
 */
export async function recheckList(db: Db, projectId: string): Promise<{ reports: RecheckRow[]; deferred: Array<{ id: string; finding: unknown; score: number }>; backlog: { open: number; cap: number } } | null> {
  const { data, error } = await db
    .from('reports')
    .select('id, status, severity, title, description, created_at, custom_metadata, pattern_key')
    .eq('project_id', projectId)
    .eq('source', 'code_audit')
    .in('status', [...RECHECK_CLOSES])
    .order('created_at', { ascending: true })
    .limit(RECHECK_MAX_ROWS)
  if (error) return null
  const backlog = await codeAuditBacklog(db, projectId)
  if (!backlog) return null
  const free = Math.max(0, backlog.cap - backlog.open)
  let deferred: Array<{ id: string; finding: unknown; score: number }> = []
  if (free > 0) {
    const { data: rows, error: dErr } = await db
      .from('code_audit_deferred')
      .select('id, finding, score')
      .eq('project_id', projectId)
      .order('score', { ascending: false })
      .order('deferred_at', { ascending: true })
      .limit(free)
    if (dErr) return null
    deferred = (rows ?? []) as typeof deferred
  }
  return { reports: (data ?? []) as RecheckRow[], deferred, backlog }
}

export interface RecheckBody {
  sha: string
  base: string
  results: Array<{ reportId: string; gone: boolean; reason: string }>
  /** Deferred findings whose check no longer reproduces on the default branch. */
  deferredGone: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g

/** Parse a worker's recheck result; every field is checked. */
export function parseRecheckBody(raw: unknown): { ok: true; value: RecheckBody } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send the recheck as a JSON object.' }
  const b = raw as Record<string, unknown>
  if (typeof b.sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(b.sha)) return { ok: false, message: 'sha must be the commit the recheck read.' }
  if (typeof b.base !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(b.base)) return { ok: false, message: 'base must be the branch the recheck read.' }
  if (!Array.isArray(b.results) || b.results.length > RECHECK_MAX_ROWS) return { ok: false, message: `results must be a list of at most ${RECHECK_MAX_ROWS}.` }
  const results: RecheckBody['results'] = []
  for (const r of b.results as Array<Record<string, unknown>>) {
    if (!r || typeof r.reportId !== 'string' || !UUID.test(r.reportId) || typeof r.gone !== 'boolean') return { ok: false, message: 'Each result needs reportId and gone.' }
    const reason = typeof r.reason === 'string' ? r.reason.replace(CONTROL, ' ').trim().slice(0, 600) : ''
    if (r.gone && reason.length < 3) return { ok: false, message: 'A gone result needs its reason.' }
    results.push({ reportId: r.reportId, gone: r.gone, reason })
  }
  const deferredGone = Array.isArray(b.deferredGone) ? (b.deferredGone as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 500) : []
  return { ok: true, value: { sha: b.sha, base: b.base, results, deferredGone } }
}

/**
 * Apply a recheck: a report whose check no longer reproduces on the default
 * branch is closed as fixed with the commit seen (Sentry's "resolved"; the
 * same pattern later is a regression, fileAuditFinding). A report whose fix
 * was rejected and still reproduces goes back to the queue, at most
 * FIX_REJECTED_REQUEUE_LIMIT times. Only this app's open code_audit reports move.
 */
export async function applyRecheck(
  db: Db,
  ctx: { projectId: string; laneId: string; laneName: string; now: Date },
  body: RecheckBody,
): Promise<{ closed: number; requeued: number; deferredDropped: number }> {
  const nowIso = ctx.now.toISOString()
  const ids = body.results.map((r) => r.reportId)
  type Row = { id: string; status: string; custom_metadata: Record<string, unknown> | null }
  const rows = new Map<string, Row>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('reports').select('id, status, custom_metadata').eq('project_id', ctx.projectId).eq('source', 'code_audit').in('id', ids.slice(i, i + 200))
    for (const r of (data ?? []) as Row[]) rows.set(r.id, r)
  }
  let closed = 0
  let requeued = 0
  for (const res of body.results) {
    const r = rows.get(res.reportId)
    if (!r || !(RECHECK_CLOSES as readonly string[]).includes(r.status)) continue
    const meta = r.custom_metadata ?? {}
    const rechecked = { sha: body.sha, base: body.base, at: nowIso, lane: ctx.laneName }
    if (res.gone) {
      const { data: moved } = await db
        .from('reports')
        .update({ status: 'fixed', fixed_at: nowIso, updated_at: nowIso, custom_metadata: { ...meta, resolution: { kind: 'recheck_not_reproduced', reason: res.reason, ...rechecked } } })
        .eq('id', r.id)
        .eq('status', r.status)
        .select('id')
      if (!moved || (moved as unknown[]).length === 0) continue
      closed++
      const note = await postTeamNote(db, {
        projectId: ctx.projectId,
        reportId: r.id,
        authorName: 'Local worker',
        body: `Closed by the audit lane recheck: ${res.reason} (checked on ${body.base} at ${body.sha.slice(0, 9)}). If the same problem comes back, this report reopens as a regression.`,
      })
      if (!note.ok) mlog.warn('recheck note not saved', { reportId: r.id, err: note.error })
      continue
    }
    const rejected = meta.fix_rejected as { count?: number; rechecked?: unknown } | undefined
    if (r.status === 'triaged' && rejected && !rejected.rechecked && (Number(rejected.count) || 1) < FIX_REJECTED_REQUEUE_LIMIT) {
      const { data: moved } = await db
        .from('reports')
        .update({ status: 'classified', updated_at: nowIso, custom_metadata: { ...meta, fix_rejected: { ...rejected, rechecked } } })
        .eq('id', r.id)
        .eq('status', 'triaged')
        .select('id')
      if (moved && (moved as unknown[]).length > 0) requeued++
    }
  }
  let deferredDropped = 0
  if (body.deferredGone.length) {
    const { data } = await db.from('code_audit_deferred').delete().eq('project_id', ctx.projectId).in('id', body.deferredGone).select('id, finding')
    const dropped = (data ?? []) as Array<{ id: string; finding?: Record<string, unknown> | null }>
    deferredDropped = dropped.length
    // A report the cap set aside (`--apply-cap`) whose check is gone is fixed, not left dismissed.
    const setAside = dropped.map((d) => d.finding?.collapse_report_id).filter((x): x is string => typeof x === 'string' && UUID.test(x))
    for (const id of setAside) {
      const { data: rep } = await db.from('reports').select('id, custom_metadata').eq('id', id).eq('project_id', ctx.projectId).eq('status', 'dismissed').eq('closed_reason', DEFERRED_OVER_CAP).maybeSingle()
      if (!rep) continue
      const meta = ((rep as { custom_metadata?: Record<string, unknown> | null }).custom_metadata ?? {})
      const { data: moved } = await db
        .from('reports')
        .update({ status: 'fixed', closed_reason: null, fixed_at: nowIso, updated_at: nowIso, custom_metadata: { ...meta, resolution: { kind: 'recheck_not_reproduced', reason: 'its check no longer reproduces while it waited over the open cap', sha: body.sha, base: body.base, at: nowIso, lane: ctx.laneName } } })
        .eq('id', id)
        .eq('status', 'dismissed')
        .select('id')
      if (moved && (moved as unknown[]).length > 0) closed++
    }
  }
  await db.from('work_lanes').update({ audit_rechecked_at: nowIso }).eq('id', ctx.laneId)
  return { closed, requeued, deferredDropped }
}
